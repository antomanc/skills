import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ratchet', 'scripts')
const RATCHET = path.join(scripts, 'ratchet.mjs')
const CHECK = path.join(scripts, 'ratchet-check.mjs')
const FOUNDATION = path.join(scripts, 'foundation.mjs')

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-test-'))
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
const state = (rules) => ({ '.ratchet/state.json': { version: 1, rules, declined: [], history: [] } })
const clockRule = (canary) => ({ id: 'clock', message: 'read time from the clock helper', check: 'node ' + CHECK, probe: { pattern: 'Date\\.now\\(', include: ['src/**'] }, canary })

test('two matches on one line count as two', () => {
  const dir = repo({ 'src/a.ts': 'const a = Date.now()\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  run(dir, RATCHET, 'baseline', 'clock')
  write(dir, 'src/a.ts', 'const a = Date.now(); Date.now()\n')
  assert.equal(run(dir, CHECK).code, 1)
})

test('verify exits 1 on a violation and 0 when everything holds', () => {
  const dir = repo({ 'src/a.ts': 'const a = Date.now()\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  run(dir, RATCHET, 'baseline', 'clock')
  assert.equal(run(dir, RATCHET, 'verify').code, 0)
  write(dir, 'src/b.ts', 'Date.now()\n')
  const r = run(dir, RATCHET, 'verify')
  assert.equal(r.code, 1)
  assert.equal(r.json.ok, false)
})

test('a canary only fires when the failure names the rule and the canary', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([clockRule({ path: 'src/c.ts', content: 'unrelated\n', check: 'test ! -e src/c.ts || (echo "src/c.ts: syntax error"; exit 1)' })]) })
  const r = run(dir, RATCHET, 'verify')
  assert.match(r.json.rules[0].canary, /FAILS FOR ANOTHER REASON/)
  assert.equal(r.code, 1)
})

test('a canary is not trusted when the check already fails without it', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n', check: 'false' })]) })
  assert.match(run(dir, RATCHET, 'verify').json.rules[0].canary, /SKIPPED: the check fails without the canary/)
})

test('a canary that breaks the rule fires', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  const r = run(dir, RATCHET, 'verify')
  assert.equal(r.json.rules[0].canary, 'fires')
  assert.equal(r.code, 0)
})

test('a rule without check, probe or canary fails verify', () => {
  const dir = repo({ ...state([{ id: 'prose-only', message: 'be nice' }]) })
  const r = run(dir, RATCHET, 'verify')
  assert.equal(r.code, 1)
  assert.match(r.json.rules[0].incomplete, /nothing enforces/)
})

test('verify without state exits 1', () => {
  assert.equal(run(repo({ 'a.txt': 'x' }), RATCHET, 'verify').code, 1)
})

test('snapshots: .ratchet-only commits are no change; CI, prose and source changes are', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([]) })
  run(dir, RATCHET, 'snapshot'); commit(dir, 'snap')
  assert.equal(run(dir, RATCHET, 'snapshot').json.unchanged, true)
  for (const [f, s] of [['.github/workflows/ci.yml', 'name: CI\n'], ['AGENTS.md', 'Never do x\n'], ['src/b.ts', 'y\n']]) {
    write(dir, f, s); commit(dir, f)
    assert.notEqual(run(dir, RATCHET, 'snapshot').json.unchanged, true, f + ' should count as a change')
    commit(dir, 'snap')
  }
})

test('snapshot --before keeps the old state of the code as the first entry', () => {
  const dir = repo({ 'src/a.ts': 'Date.now()\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  const before = git(dir, 'rev-parse', '--short', 'HEAD').trim()
  write(dir, 'src/a.ts', 'x\n'); commit(dir, 'fix')
  run(dir, RATCHET, 'snapshot')
  const r = run(dir, RATCHET, 'snapshot', '--before', before)
  assert.equal(r.json.phase, 'before')
  assert.equal(run(dir, RATCHET, 'report').json.rules.clock.from, 1)
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1)
})

test('tighten only lowers, and a raise needs a reason', () => {
  const dir = repo({ 'src/a.ts': 'Date.now()\nDate.now()\n', ...state([clockRule({ path: 'src/c.ts', content: 'Date.now()\n' })]) })
  run(dir, RATCHET, 'baseline', 'clock')
  write(dir, 'src/a.ts', 'Date.now()\n')
  assert.deepEqual(run(dir, RATCHET, 'tighten').json.tightened, { clock: { from: 2, to: 1 } })
  write(dir, 'src/a.ts', 'Date.now()\nDate.now()\nDate.now()\n')
  assert.equal(run(dir, RATCHET, 'tighten').json.tightened.clock, undefined)
  assert.equal(run(dir, RATCHET, 'baseline', 'clock', '--raise').code, 1)
  assert.equal(run(dir, RATCHET, 'baseline', 'clock', '--raise', '--reason', 'legacy import').code, 0)
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.ratchet/state.json'), 'utf8'))
  assert.equal(s.rules[0].raised[0].reason, 'legacy import')
})

test('a multi-line diagnostic counts when the rule is named anywhere in its block', () => {
  const rustc = 'printf "error: used unwrap() on an Option value\\n --> src/c.rs:3:20\\n  |\\n3 | x.unwrap()\\n  = help: see #unwrap_used\\n\\nerror: could not compile\\n"; exit 1'
  const dir = repo({ 'src/a.rs': 'x\n', ...state([{ id: 'no-unwrap', message: 'm', check: 'test ! -e src/c.rs || { ' + rustc + '; }', canary: { path: 'src/c.rs', content: 'x', expect: 'unwrap_used' } }]) })
  assert.equal(run(dir, RATCHET, 'verify').json.rules[0].canary, 'fires')
})

test('a diagnostic in another block does not count', () => {
  const out = 'printf "src/c.rs:1: syntax error\\n\\nother.rs: unwrap_used\\n"; exit 1'
  const dir = repo({ 'src/a.rs': 'x\n', ...state([{ id: 'no-unwrap', message: 'm', check: 'test ! -e src/c.rs || { ' + out + '; }', canary: { path: 'src/c.rs', content: 'x', expect: 'unwrap_used' } }]) })
  assert.match(run(dir, RATCHET, 'verify').json.rules[0].canary, /FAILS FOR ANOTHER REASON/)
})

test('a canary in a folder that does not exist yet gets it, and the folder is removed after', () => {
  const dir = repo({ 'src/a.ts': 'x\n', ...state([clockRule({ path: 'src/bin/deep/c.ts', content: 'Date.now()\n' })]) })
  assert.equal(run(dir, RATCHET, 'verify').json.rules[0].canary, 'fires')
  assert.equal(fs.existsSync(path.join(dir, 'src/bin')), false)
})

const INTENTS = ['strict-compiler', 'escape-hatches', 'nuance-apis', 'dead-code', 'tests', 'no-inline-disables']

for (const [stack, files] of [['rust', { 'Cargo.toml': '[package]\nname = "x"\n', 'src/main.rs': 'fn main() {}\n' }], ['go', { 'go.mod': 'module x\n', 'main.go': 'package main\n' }], ['js/ts', { 'package.json': '{"name":"x"}' }], ['swift', { 'Package.swift': '// swift-tools-version:6.0\n' }]]) {
  test('foundation on a new ' + stack + ' project: contract missing, then --apply is idempotent and tool-free', () => {
    const dir = repo(files)
    const before = run(dir, FOUNDATION)
    assert.equal(before.code, 1)
    assert.deepEqual(before.json.stacks, [stack])
    assert.deepEqual(INTENTS.filter((i) => before.json.intents[i].status === 'missing'), INTENTS)
    run(dir, FOUNDATION, '--verify', 'make check')
    const first = run(dir, FOUNDATION, '--apply')
    assert.ok(first.json.changed.includes('scripts/ratchet-check.mjs'))
    assert.equal(first.json.intents['no-inline-disables'].status, 'covered')
    assert.deepEqual(run(dir, FOUNDATION, '--apply').json.changed, [])
    assert.ok(!fs.existsSync(path.join(dir, '.oxlintrc.json')), 'no tool-specific config is written')
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /make check/)
  })
}

test('the no-inline-disables probe knows every language and keeps existing suppressions as a ceiling', () => {
  const dir = repo({ 'a.rs': '#[allow(dead_code)]\n', 'b.go': '//nolint\n', 'c.swift': '// swiftlint:disable force_cast\n', 'd.kt': '@Suppress("X")\n', 'e.py': 'x = 1  # noqa\n', 'f.ts': '// @ts-ignore\n', 'g.cs': '#pragma warning disable CS1\n', 'h.dart': '// ignore: x\n', 'README.md': '// nolint in docs is fine\n' })
  run(dir, FOUNDATION, '--apply')
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.ratchet/state.json'), 'utf8'))
  assert.equal(Object.keys(s.rules[0].baseline).length, 8)
  assert.equal(run(dir, CHECK).code, 0)
  write(dir, 'i.rb', '# rubocop:disable Style/X\n')
  assert.equal(run(dir, CHECK).code, 1)
})

test('the contract holds when every intent is covered or declined, verify is recorded and CI runs it', () => {
  const rule = (intent) => ({ id: intent, intent, check: 'true', canary: { path: 'c-' + intent, content: 'x' } })
  const dir = repo({
    '.ratchet/state.json': { version: 1, verify: 'make check', rules: ['strict-compiler', 'escape-hatches', 'nuance-apis', 'tests', 'no-inline-disables'].map(rule), declined: [{ intent: 'dead-code', reason: 'the compiler already rejects unused code' }], history: [] },
    '.github/workflows/ci.yml': 'jobs:\n  v:\n    steps:\n      - run: make check\n',
    'AGENTS.md': '<!-- ratchet:start -->\n<!-- ratchet:end -->\n'
  })
  const r = run(dir, FOUNDATION)
  assert.equal(r.code, 0, r.out)
  assert.equal(r.json.intents['dead-code'].status, 'declined')
  assert.equal(r.json.ci, 'runs verify')
})
