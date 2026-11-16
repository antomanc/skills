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

for (const ui of ['react', 'svelte', 'vue', null]) {
  test('foundation --apply is idempotent (' + (ui ?? 'node') + ')', () => {
    const dir = repo({ 'package.json': { name: 'x', dependencies: ui ? { [ui]: '*' } : {}, devDependencies: { typescript: '*' } }, 'src/main.ts': 'export {}\n' })
    const first = run(dir, FOUNDATION, '--apply')
    assert.equal(first.code, 0)
    assert.ok(first.json.changed.includes('.oxlintrc.json'))
    const second = run(dir, FOUNDATION, '--apply')
    assert.deepEqual(second.json.changed, [])
    const s = JSON.parse(fs.readFileSync(path.join(dir, '.ratchet/state.json'), 'utf8'))
    assert.equal(s.rules.some((r) => r.id === 'effects-in-helpers'), ui !== null)
    for (const r of s.rules) assert.ok(r.canary && (r.check || r.probe), r.id + ' must be complete')
  })
}

test('foundation never overwrites an existing linter config or workflow', () => {
  const dir = repo({ 'package.json': { name: 'x', dependencies: { react: '*' } }, 'eslint.config.js': 'export default []\n', '.github/workflows/ci.yml': 'name: mine\n' })
  const r = run(dir, FOUNDATION, '--apply')
  assert.equal(fs.readFileSync(path.join(dir, 'eslint.config.js'), 'utf8'), 'export default []\n')
  assert.equal(fs.readFileSync(path.join(dir, '.github/workflows/ci.yml'), 'utf8'), 'name: mine\n')
  assert.ok(r.json.manual.some((m) => m.includes('add the bans')))
  assert.ok(r.json.manual.some((m) => m.includes('CI exists')))
})
