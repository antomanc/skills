import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'wellkept', 'scripts')
const CLI = path.join(scripts, 'wellkept.mjs')
const CHECK = path.join(scripts, 'wellkept-check.mjs')
const FOUNDATION = path.join(scripts, 'foundation.mjs')

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wellkept-test-'))
  for (const [f, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    fs.writeFileSync(path.join(dir, f), typeof content === 'string' ? content : JSON.stringify(content, null, 1))
  }
  git(dir, 'init', '-q')
  commit(dir, 'init')
  return dir
}
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
const commit = (dir, msg) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg, '--allow-empty') }
const run = (dir, script, ...a) => {
  const r = spawnSync(process.execPath, [script, ...a], { cwd: dir, encoding: 'utf8' })
  let json = null
  try { json = JSON.parse(r.stdout) } catch {}
  return { code: r.status, out: r.stdout + r.stderr, json }
}
const write = (dir, f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s) }
const state = (rules) => ({ '.wellkept/state.json': { version: 1, rules, declined: [], history: [] } })
const clockRule = (canary) => ({ id: 'clock', message: 'read time from the clock helper', check: 'node ' + CHECK, probe: { pattern: 'Date\\.now\\(', include: ['src/**'] }, canary })

test('two matches on one line count as two', () => {
  const dir = repo({ 'src/a.ts': 'const a = Date.now()\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  run(dir, CLI, 'baseline', 'clock')
  write(dir, 'src/a.ts', 'const a = Date.now(); Date.now()\n')
  assert.equal(run(dir, CHECK).code, 1)
})

test('verify exits 1 on a violation and 0 when everything holds', () => {
  const dir = repo({ 'src/a.ts': 'const a = Date.now()\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  run(dir, CLI, 'baseline', 'clock')
  assert.equal(run(dir, CLI, 'verify').code, 0)
  write(dir, 'src/b.ts', 'Date.now()\n')
  const r = run(dir, CLI, 'verify')
  assert.equal(r.code, 1)
  assert.equal(r.json.ok, false)
})

test('a canary only fires when the failure names the rule and the canary', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([clockRule({ path: 'src/c.ts', content: 'unrelated\n', check: 'test ! -e src/c.ts || (echo "src/c.ts: syntax error"; exit 1)' })]) })
  const r = run(dir, CLI, 'verify')
  assert.match(r.json.rules[0].canary, /FAILS FOR ANOTHER REASON/)
  assert.equal(r.code, 1)
})

test('a canary is not trusted when the check already fails without it', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n', check: 'false' })]) })
  assert.match(run(dir, CLI, 'verify').json.rules[0].canary, /SKIPPED: the check fails without the canary/)
})

test('a canary that breaks the rule fires', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  const r = run(dir, CLI, 'verify')
  assert.equal(r.json.rules[0].canary, 'fires')
  assert.equal(r.code, 0)
})

test('a rule without check, probe or canary fails verify', () => {
  const dir = repo({ ...state([{ id: 'prose-only', message: 'be nice' }]) })
  const r = run(dir, CLI, 'verify')
  assert.equal(r.code, 1)
  assert.match(r.json.rules[0].incomplete, /nothing enforces/)
})

test('verify without state exits 1', () => {
  assert.equal(run(repo({ 'a.txt': 'x' }), CLI, 'verify').code, 1)
})

test('snapshots: .wellkept-only commits are no change; CI, prose and source changes are', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([]) })
  run(dir, CLI, 'snapshot'); commit(dir, 'snap')
  assert.equal(run(dir, CLI, 'snapshot').json.unchanged, true)
  for (const [f, s] of [['.github/workflows/ci.yml', 'name: CI\n'], ['AGENTS.md', 'Never do x\n'], ['src/b.ts', 'y\n']]) {
    write(dir, f, s); commit(dir, f)
    assert.notEqual(run(dir, CLI, 'snapshot').json.unchanged, true, f + ' should count as a change')
    commit(dir, 'snap')
  }
})

test('snapshot --before keeps the old state of the code as the first entry', () => {
  const dir = repo({ 'src/a.ts': 'Date.now()\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  const before = git(dir, 'rev-parse', '--short', 'HEAD').trim()
  write(dir, 'src/a.ts', 'x\n'); commit(dir, 'fix')
  run(dir, CLI, 'snapshot')
  const r = run(dir, CLI, 'snapshot', '--before', before)
  assert.equal(r.json.phase, 'before')
  assert.equal(run(dir, CLI, 'report').json.rules.clock.from, 1)
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1)
})

test('tighten only lowers, and a raise needs a reason', () => {
  const dir = repo({ 'src/a.ts': 'Date.now()\nDate.now()\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  run(dir, CLI, 'baseline', 'clock')
  write(dir, 'src/a.ts', 'Date.now()\n')
  assert.deepEqual(run(dir, CLI, 'tighten').json.tightened, { clock: { from: 2, to: 1 } })
  write(dir, 'src/a.ts', 'Date.now()\nDate.now()\nDate.now()\n')
  assert.equal(run(dir, CLI, 'tighten').json.tightened.clock, undefined)
  assert.equal(run(dir, CLI, 'baseline', 'clock', '--raise').code, 1)
  assert.equal(run(dir, CLI, 'baseline', 'clock', '--raise', '--reason', 'legacy import').code, 0)
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.wellkept/state.json'), 'utf8'))
  assert.equal(s.rules[0].raised[0].reason, 'legacy import')
})

test('a multi-line diagnostic counts when the rule is named anywhere in its block', () => {
  const rustc = 'printf "error: used unwrap() on an Option value\\n --> src/c.rs:3:20\\n  |\\n3 | x.unwrap()\\n  = help: see #unwrap_used\\n\\nerror: could not compile\\n"; exit 1'
  const dir = repo({ 'src/a.rs': 'x\n', ...state([{ id: 'no-unwrap', message: 'm', check: 'test ! -e src/c.rs || { ' + rustc + '; }', canary: { path: 'src/c.rs', content: 'x', expect: 'unwrap_used' } }]) })
  assert.equal(run(dir, CLI, 'verify').json.rules[0].canary, 'fires')
})

test('a diagnostic in another block does not count', () => {
  const out = 'printf "src/c.rs:1: syntax error\\n\\nother.rs: unwrap_used\\n"; exit 1'
  const dir = repo({ 'src/a.rs': 'x\n', ...state([{ id: 'no-unwrap', message: 'm', check: 'test ! -e src/c.rs || { ' + out + '; }', canary: { path: 'src/c.rs', content: 'x', expect: 'unwrap_used' } }]) })
  assert.match(run(dir, CLI, 'verify').json.rules[0].canary, /FAILS FOR ANOTHER REASON/)
})

test('a canary in a folder that does not exist yet gets it, and the folder is removed after', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([clockRule({ path: 'src/bin/deep/c.ts', content: 'Date.now()\n' })]) })
  assert.equal(run(dir, CLI, 'verify').json.rules[0].canary, 'fires')
  assert.equal(fs.existsSync(path.join(dir, 'src/bin')), false)
})

const INTENTS = ['compiler', 'escape-hatches', 'nuance-apis', 'dead-code', 'tests', 'suppressions']

for (const [stack, files] of [['rust', { 'Cargo.toml': '[package]\nname = "x"\n', 'src/main.rs': 'fn main() {}\n' }], ['go', { 'go.mod': 'module x\n', 'main.go': 'package main\n' }], ['js/ts', { 'package.json': '{"name":"x"}' }], ['swift', { 'Package.swift': '// swift-tools-version:6.0\n' }]]) {
  test('foundation on a new ' + stack + ' project: contract missing, then --apply is idempotent and tool-free', () => {
    const dir = repo(files)
    const before = run(dir, FOUNDATION)
    assert.equal(before.code, 1)
    assert.deepEqual(before.json.stacks, [stack])
    assert.deepEqual(INTENTS.filter((i) => before.json.intents[i].status === 'undecided'), INTENTS)
    run(dir, FOUNDATION, '--verify', 'make check')
    const first = run(dir, FOUNDATION, '--apply')
    assert.ok(first.json.changed.includes('scripts/wellkept-check.mjs'))
    assert.equal(first.json.intents['suppressions'].status, 'covered')
    assert.deepEqual(run(dir, FOUNDATION, '--apply').json.changed, [])
    assert.ok(!fs.existsSync(path.join(dir, '.oxlintrc.json')), 'no tool-specific config is written')
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /make check/)
  })
}

test('suppressions without a reason fail in every language; explained ones pass; old ones are a ceiling', () => {
  const dir = repo({ 'a.rs': '#[allow(dead_code)]\n', 'b.go': '//nolint\n', 'c.swift': '// swiftlint:disable force_cast\n', 'd.kt': '@Suppress("X")\n', 'e.py': 'x = 1  # noqa\n', 'f.ts': '// @ts-ignore\n', 'g.cs': '#pragma warning disable CS1\n', 'h.dart': '// ignore: x\n', 'README.md': '// nolint in docs is fine\n' })
  run(dir, FOUNDATION, '--apply')
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.wellkept/state.json'), 'utf8'))
  assert.equal(Object.keys(s.rules[0].baseline).length, 8)
  assert.equal(run(dir, CHECK).code, 0)
  write(dir, 'i.rs', '#[expect(dead_code, reason = "kept for the FFI table")]\nfn f() {}\n')
  write(dir, 'j.go', 'x() //nolint:errcheck // flushed in Close\n')
  write(dir, 'k.ts', '// @ts-expect-error -- upstream types miss the overload\n')
  assert.equal(run(dir, CHECK).code, 0, 'explained exceptions pass')
  write(dir, 'l.rs', '#[expect(dead_code)]\n')
  assert.equal(run(dir, CHECK).code, 1, 'an unexplained expect fails')
})

test('the contract holds when every area is decided, verify is recorded, CI runs the exact command and AGENTS.md says so', () => {
  const rule = (intent) => ({ id: intent, intent, check: 'true', canary: { path: 'c-' + intent, content: 'x' } })
  const files = {
    '.wellkept/state.json': { version: 1, verify: 'make lint && make test', rules: ['compiler', 'escape-hatches', 'nuance-apis', 'tests', 'suppressions'].map(rule), declined: [{ intent: 'dead-code', reason: 'the compiler already rejects unused code' }], history: [] },
    '.github/workflows/ci.yml': 'jobs:\n  v:\n    steps:\n      - run: make lint &&   make test\n',
    'AGENTS.md': '<!-- wellkept:start -->\n<!-- wellkept:end -->\n'
  }
  const dir = repo(files)
  const r = run(dir, FOUNDATION)
  assert.equal(r.code, 0, r.out)
  assert.equal(r.json.intents['dead-code'].status, 'declined')
  write(dir, '.github/workflows/ci.yml', 'jobs:\n  v:\n    steps:\n      - run: make lint\n')
  const partial = run(dir, FOUNDATION)
  assert.equal(partial.code, 1, 'CI running part of verify is not enough')
  assert.match(partial.json.ci, /does not run the exact verify command/)
  write(dir, '.github/workflows/ci.yml', files['.github/workflows/ci.yml'])
  fs.rmSync(path.join(dir, 'AGENTS.md'))
  assert.equal(run(dir, FOUNDATION).code, 1, 'a missing AGENTS block fails the contract')
})

test('verify --aggregate proves the verify command runs each rule', () => {
  const dir = repo({ 'src/a.ts': 'x\n', 'Makefile': 'check:\n\tnode ' + CHECK + '\nskip:\n\ttrue\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  const set = (verify) => { const s = JSON.parse(fs.readFileSync(path.join(dir, '.wellkept/state.json'), 'utf8')); s.verify = verify; fs.writeFileSync(path.join(dir, '.wellkept/state.json'), JSON.stringify(s)) }
  set('make -s check')
  let r = run(dir, CLI, 'verify', '--aggregate')
  assert.equal(r.json.rules[0].canary, 'fires, also through verify')
  assert.equal(r.code, 0)
  set('make -s skip')
  r = run(dir, CLI, 'verify', '--aggregate')
  assert.match(r.json.rules[0].canary, /VERIFY DOES NOT RUN IT/)
  assert.equal(r.code, 1)
})

test('a canary whose expected text is in its own source is not proof', () => {
  const dir = repo({ 'test/a.test.js': "import { test } from 'node:test'\ntest('ok', () => {})\n", ...state([{ id: 'tests-run', message: 'm', check: 'node --test', canary: { path: 'test/canary.test.js', content: "import { test } from 'node:test'\ntest('ratchet canary', () => { throw new Error('ratchet canary' }\n", expect: 'ratchet canary' } }]) })
  const r = run(dir, CLI, 'verify')
  assert.match(r.json.rules[0].canary, /INVALID CANARY/)
  assert.equal(r.code, 1)
})

test('an allow canary must pass: a rule that blocks the sanctioned path fails verify', () => {
  const rule = (allowContent) => ({ id: 'clock', kind: 'api', message: 'use now() from src/time.ts', check: 'node ' + CHECK, probe: { pattern: 'Date\\.now\\(', include: ['src/**'], exclude: ['src/time.ts'] }, canary: { path: 'src/c.ts', content: 'Date.now()\n' }, allow: { path: 'src/ok.ts', content: allowContent } })
  const good = repo({ 'src/time.ts': 'export const now = () => Date.now()\n', ...state([rule("import { now } from './time'\nexport const t = now()\n")]) })
  assert.equal(run(good, CLI, 'verify').json.rules[0].allow, 'passes')
  const blocked = repo({ 'src/time.ts': 'export const now = () => Date.now()\n', ...state([rule('export const t = Date.now()\n')]) })
  const r = run(blocked, CLI, 'verify')
  assert.match(r.json.rules[0].allow, /BLOCKS THE SANCTIONED PATH/)
  assert.equal(r.code, 1)
})

test('an api rule without an allow canary is incomplete', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([{ ...clockRule({ path: 'src/c.ts', content: 'Date.now()\n' }), kind: 'api' }]) })
  const r = run(dir, CLI, 'verify')
  assert.match(r.json.rules[0].allow, /MISSING/)
  assert.equal(r.code, 1)
})

test('--against fails on weakened enforcement unless the commit declares it', () => {
  const dir = repo({ 'src/a.ts': 'Date.now()\n', '.oxlintrc.json': '{}\n', '.wellkept/state.json': { version: 1, rules: [clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })], protected: ['.oxlintrc.json'], history: [] } })
  run(dir, CLI, 'baseline', 'clock'); commit(dir, 'baseline')
  git(dir, 'tag', 'main')
  write(dir, 'src/b.ts', 'Date.now()\n')
  run(dir, CLI, 'baseline', 'clock', '--raise', '--reason', 'x'); commit(dir, 'raise')
  let r = run(dir, CHECK, '--against', 'main')
  assert.equal(r.code, 1)
  assert.match(r.out, /ceiling raised for src\/b\.ts/)
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'Allow the clock in b\n\nWellkept-Change: b.ts is the clock module now')
  r = run(dir, CHECK, '--against', 'main')
  assert.equal(r.code, 0, r.out)
  write(dir, '.oxlintrc.json', '{"rules":{}}\n'); commit(dir, 'loosen lint')
  r = run(dir, CHECK, '--against', 'main')
  assert.equal(r.code, 1)
  assert.match(r.out, /protected file changed: \.oxlintrc\.json/)
})

test('a boundary rule without an allow canary is incomplete', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([{ ...clockRule({ path: 'src/c.ts', content: 'Date.now()\n' }), kind: 'boundary' }]) })
  assert.match(run(dir, CLI, 'verify').json.rules[0].allow, /MISSING: a boundary rule needs an allow canary/)
})

test('a declined finding whose revisitProbe matches is reported as due, not left stale', () => {
  const declined = [{ id: 'clock-reads', reason: 'the app reads no time', revisitWhen: 'a feature reads the clock', revisitProbe: { pattern: 'Date\\.now\\(', include: ['src/**'] } }]
  const dir = repo({ 'src/a.ts': 'x\n', '.wellkept/state.json': { version: 1, rules: [], declined, history: [] } })
  assert.equal(run(dir, CLI, 'verify').code, 0)
  assert.doesNotMatch(run(dir, CHECK).out, /due for review/)
  write(dir, 'src/recent.ts', 'export const now = () => Date.now()\n')
  const v = run(dir, CLI, 'verify')
  assert.equal(v.code, 1)
  assert.deepEqual(v.json.declined.map((d) => [d.id, d.at]), [['clock-reads', ['src/recent.ts:1']]])
  const c = run(dir, CHECK)
  assert.equal(c.code, 0, 'a due decline warns in CI but does not block unrelated work')
  assert.match(c.out, /declined \[clock-reads\] is due for review/)
})
