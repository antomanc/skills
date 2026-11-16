#!/usr/bin/env node
// ratchet: the deterministic half of the ratchet skill. Prints JSON for the agent.
//   inventory            stack, guardrail tools, CI steps, verification setup, prose rules
//   measure              hotspot probes and rule counts at HEAD
//   snapshot             measure + git metrics, saved in .ratchet/state.json history (one entry per commit)
//   snapshot --before <commit>  measure the project as it was before the changes, kept as the first snapshot
//   verify [--no-checks] run each rule's check, prove each canary fails for its own reason; exits 1 on any failure
//   tighten              lower every rule's per-file baseline to today's counts (never raises)
//   baseline <rule-id>   set a new rule's baseline to today's counts
//   report               before/after: probes since the first snapshot, git metrics in equal windows around it
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { repoRoot, listFiles, readText, matchProbe, loadState, statePath, ratchet, globToRegExp } from './ratchet-check.mjs'

const root = repoRoot()
const [cmd, ...args] = process.argv.slice(2)
const flag = (name) => args.includes('--' + name)

const SKIP = [
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/.gradle/**', '**/vendor/**', '**/target/**',
  '.agents/**', '.claude/**', '.codex/**', '.cursor/**', '.github/**', '.ratchet/**', '**/*.min.js', '**/*.lock', '**/*-lock.*',
  '**/generated/**', '**/*.g.dart', '**/*.pb.go'
]
const TEST = ['**/test/**', '**/tests/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/androidTest/**', '**/e2e/**', '**/*_test.go', '**/test_*.py', '**/testFixtures/**', '**/screenshotTest/**']
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue|kt|kts|java|swift|py|go|rs|dart|rb|cs|cpp|cc|c|h|hpp|ino)$/

const skipRe = SKIP.map(globToRegExp)
const testRe = TEST.map(globToRegExp)
const isSkipped = (f) => skipRe.some((r) => r.test(f))
const isTest = (f) => testRe.some((r) => r.test(f))

const git = (a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
const head = () => { try { return git(['rev-parse', '--short', 'HEAD']).trim() } catch { return 'none' } }

// Probes: where agents need nuance, so where they produce slop. Counts, not verdicts.
const WEB = /\.(ts|tsx|js|jsx|mjs|svelte|vue)$/
const PROBES = [
  { id: 'timers', ext: /\.(ts|tsx|js|jsx|mjs|svelte|vue|kt|java|swift|py|dart)$/, re: /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback|postDelayed|Thread\.sleep|time\.sleep|asyncio\.sleep)\s*\(|\bdelay\(\s*\d/ },
  { id: 'clock-reads', ext: SOURCE_EXT, re: /\bDate\.now\(\)|new Date\(\)|Instant\.now\(\)|LocalDate(Time)?\.now\(\)|System\.currentTimeMillis|Clock\.system|datetime\.(now|utcnow)\(|time\.Now\(\)/ },
  { id: 'escape-hatches', ext: WEB, re: /\bas any\b|as unknown as|:\s*any\b|@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|oxlint-disable|biome-ignore|svelte-ignore/ },
  { id: 'escape-hatches', ext: /\.(kt|kts|java)$/, re: /!!|@Suppress(Warnings)?\(|runBlocking|GlobalScope|lateinit var/ },
  { id: 'escape-hatches', ext: /\.py$/, re: /#\s*type:\s*ignore|#\s*noqa|except\s*:|except Exception\s*:/ },
  { id: 'escape-hatches', ext: /\.go$/, re: /\/\/\s*nolint|\binterface\{\}|\bpanic\(/ },
  { id: 'escape-hatches', ext: /\.rs$/, re: /\.unwrap\(\)|\.expect\(|\bunsafe\b|#\[allow\(/ },
  { id: 'effects', ext: /\.(tsx|jsx|ts|js)$/, re: /\buse(Layout)?Effect\s*\(/ },
  { id: 'effects', ext: /\.svelte$|\.svelte\.(ts|js)$/, re: /\$effect(\.pre)?\s*\(/ },
  { id: 'effects', ext: /\.vue$/, re: /\bwatch(Effect)?\s*\(/ },
  { id: 'effects', ext: /\.kt$/, re: /\b(LaunchedEffect|DisposableEffect|SideEffect)\b\s*[\(\{]/ },
  { id: 'justification-comments', ext: SOURCE_EXT, re: /^\s*(\/\/|#|\*|\/\*).*\b(workaround|hack|for now|temporar|quick fix|band-?aid|not ideal|ugly|kludge|needed because|otherwise .* (breaks|fails))/i },
  { id: 'todos', ext: SOURCE_EXT, re: /\b(TODO|FIXME|HACK|XXX)\b/ }
]
const COMMENT = /^\s*(\/\/|\/\*|\*(?!\*)|\*\/|<!--|#(?!\[|!|include|define|if|endif|else|pragma|import))/

function sourceFiles(files) {
  return files.filter((f) => SOURCE_EXT.test(f) && !isSkipped(f) && !isTest(f))
}

function measure(files = listFiles(root)) {
  const src = sourceFiles(files)
  const probes = {}
  for (const p of PROBES) {
    const own = src.filter((f) => p.ext.test(f))
    if (!own.length) continue
    const hits = matchProbe(root, own, { pattern: p.re.source, flags: p.re.flags })
    const entry = (probes[p.id] ??= { total: 0, files: {} })
    for (const [f, lines] of Object.entries(hits)) {
      entry.total += lines.length
      entry.files[f] = (entry.files[f] ?? 0) + lines.length
    }
  }
  let lines = 0, comments = 0
  for (const f of src) {
    const t = readText(root, f)
    if (t == null) continue
    for (const l of t.split('\n')) {
      if (!l.trim()) continue
      lines++
      if (COMMENT.test(l)) comments++
    }
  }
  const tests = files.filter((f) => !isSkipped(f) && isTest(f) && SOURCE_EXT.test(f)).length
  const stateFlag = args.indexOf('--state')
  const state = stateFlag !== -1 ? JSON.parse(fs.readFileSync(args[stateFlag + 1], 'utf8')) : loadState(root)
  const rules = state ? Object.fromEntries(ratchet(root, state, files).map((r) => [r.id, r.total])) : {}
  const out = { sourceFiles: src.length, sourceLines: lines, commentLines: comments, commentRatio: +(comments / Math.max(lines, 1)).toFixed(3), testFiles: tests, probes: {}, rules }
  for (const [id, e] of Object.entries(probes)) {
    out.probes[id] = { total: e.total, top: Object.entries(e.files).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => f + ' ' + n) }
  }
  return out
}

function gitMetrics(since, until) {
  let raw = ''
  try {
    const a = ['log', '--no-merges', '--format=%x01%s', '--name-only']
    if (since) a.push('--since=' + since)
    if (until) a.push('--until=' + until)
    raw = git(a)
  } catch { return null }
  const commits = raw.split('\x01').slice(1)
  let fixes = 0, reverts = 0
  const churn = {}
  for (const c of commits) {
    const [subject, ...names] = c.split('\n')
    if (/^revert|\brevert/i.test(subject)) reverts++
    else if (/^fix|\bfix(es|ed)?\b|\bbug\b|\bregression\b|\bhotfix\b/i.test(subject)) fixes++
    for (const n of names) if (n && SOURCE_EXT.test(n) && !isTest(n) && !isSkipped(n)) churn[n] = (churn[n] ?? 0) + 1
  }
  return {
    commits: commits.length,
    fixRatio: +(fixes / Math.max(commits.length, 1)).toFixed(3),
    reverts,
    hotspots: Object.entries(churn).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, n]) => f + ' ' + n)
  }
}

const PROSE = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', '.github/copilot-instructions.md', '**/AGENTS.md', '**/CLAUDE.md', 'CODING_STANDARDS*.md', 'CONTRIBUTING.md', 'DESIGN.md', 'docs/agents/**', 'docs/adr/**', 'docs/decisions/**', '.cursor/rules/**', '.trail/learnings/**'].map(globToRegExp)
const RULE_WORDS = /\b(never|always|must|do not|don't|forbidden|avoid|only|instead of|prefer|banned|required)\b/i

function proseRules(files) {
  const found = []
  for (const f of files) {
    if (!/\.(md|mdc|txt)$|\.cursorrules$/.test(f) || !PROSE.some((r) => r.test(f)) || f.startsWith('.agents/') || f.includes('node_modules/')) continue
    const t = readText(root, f)
    if (t == null) continue
    let fence = false, managed = null
    t.split('\n').forEach((l, i) => {
      if (/^\s*(\x60{3}|~{3})/.test(l)) fence = !fence
      const start = l.match(/<!--\s*([\w-]+):start/)
      if (start) managed = start[1]
      if (/<!--\s*[\w-]+:end/.test(l)) managed = null
      if (fence || !RULE_WORDS.test(l) || /^\s*\|?\s*:?-{3}/.test(l)) return
      found.push({ at: f + ':' + (i + 1), managedBy: managed, text: l.trim().slice(0, 220) })
    })
  }
  return found
}

const TOOLS = [
  ['eslint', /(^|\/)(eslint\.config\.\w+|\.eslintrc(\.\w+)?)$/], ['oxlint', /(^|\/)\.?oxlintrc(\.json)?$|(^|\/)oxlint\.json$/], ['biome', /(^|\/)biome\.jsonc?$/],
  ['dependency-cruiser', /(^|\/)\.dependency-cruiser\.\w+$/], ['knip', /(^|\/)knip\.(json|jsonc|ts)$/], ['typescript', /(^|\/)tsconfig(\.\w+)?\.json$/],
  ['detekt', /(^|\/)detekt[\w-]*\.ya?ml$/], ['android-lint-config', /(^|\/)lint(-baseline)?\.xml$/], ['editorconfig', /(^|\/)\.editorconfig$/],
  ['ruff', /(^|\/)\.?ruff\.toml$/], ['mypy', /(^|\/)mypy\.ini$/], ['golangci', /(^|\/)\.golangci\.\w+$/], ['clippy', /(^|\/)clippy\.toml$/],
  ['playwright', /(^|\/)playwright\.config\.\w+$/], ['vitest', /(^|\/)vitest\.config\.\w+$/], ['jest', /(^|\/)jest\.config\.\w+$/],
  ['maestro', /(^|\/)\.maestro\//], ['lefthook', /(^|\/)lefthook\.ya?ml$/], ['husky', /^\.husky\//], ['pre-commit', /(^|\/)\.pre-commit-config\.yaml$/],
  ['convention-script', /^scripts\/[\w-]*(convention|lint|guard|rule)[\w-]*\.\w+$/], ['ratchet-check', /(^|\/)ratchet-check\.mjs$/]
]

function inventory() {
  const files = listFiles(root)
  const has = (re) => files.some((f) => re.test(f) && !isSkipped(f))
  const read = (f) => readText(root, f) ?? ''
  const stack = []
  const pkgs = files.filter((f) => /(^|\/)package\.json$/.test(f) && !isSkipped(f))
  const deps = pkgs.map(read).join('\n')
  const gradle = files.filter((f) => /libs\.versions\.toml$|\.gradle(\.kts)?$/.test(f) && !isSkipped(f)).map(read).join('\n')
  if (pkgs.length) stack.push('node')
  for (const [name, re] of [['react', /"react"\s*:/], ['svelte', /"svelte"\s*:/], ['vue', /"vue"\s*:/], ['solid', /"solid-js"\s*:/], ['next', /"next"\s*:/], ['electron', /"electron"\s*:/], ['react-native', /"react-native"\s*:/], ['expo', /"expo"\s*:/]]) if (re.test(deps)) stack.push(name)
  if (has(/\.kt$/)) stack.push('kotlin')
  if (has(/AndroidManifest\.xml$/)) stack.push('android')
  if (/compose/i.test(gradle)) stack.push('compose')
  if (has(/\.swift$/)) stack.push('swift')
  if (has(/(^|\/)(pyproject\.toml|requirements\.txt|setup\.py)$/)) stack.push('python')
  if (has(/(^|\/)go\.mod$/)) stack.push('go')
  if (has(/(^|\/)Cargo\.toml$/)) stack.push('rust')
  if (has(/\.ino$|platformio\.ini$/)) stack.push('embedded')
  const tools = [...new Set(TOOLS.filter(([, re]) => has(re)).map(([n]) => n))]
  if (/konsist/i.test(deps + gradle)) tools.push('konsist')
  if (/detekt/i.test(gradle) && !tools.includes('detekt')) tools.push('detekt')
  if (/ktlint|spotless/i.test(gradle)) tools.push('ktlint/spotless')
  const ci = []
  for (const f of files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$|^\.gitlab-ci\.yml$/.test(f))) {
    const lines = read(f).split('\n')
    lines.forEach((l, i) => {
      const m = l.match(/^\s*(?:-\s*)?run:\s*(.*)$/)
      if (!m) return
      const c = m[1] === '|' || m[1] === '>' ? (lines[i + 1] ?? '').trim() + ((lines[i + 2] ?? '').trim() ? ' ...' : '') : m[1]
      ci.push(f.replace('.github/workflows/', '') + ': ' + c.slice(0, 140))
    })
  }
  const scripts = {}
  for (const p of pkgs) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(read(p)).scripts ?? {})) scripts[(p === 'package.json' ? '' : path.dirname(p) + ':') + k] = v
    } catch {}
  }
  const verification = {
    e2e: tools.filter((t) => ['playwright', 'maestro'].includes(t)).concat(has(/androidTest\//) ? ['android-instrumented'] : []).concat(/roborazzi|paparazzi/i.test(gradle) ? ['screenshot-tests'] : []),
    featureMap: files.filter((f) => /feature[-_]?map|(^|\/)FEATURES\.md$/i.test(f)),
    runDrivers: files.filter((f) => /^scripts\/[\w-]*(preview|emulator|device|run|serve|smoke|perf)[\w-]*\.\w+$/i.test(f)),
    agentBrowserOrDevice: files.some((f) => /agent-(browser|device)/.test(f) || (/\.md$/.test(f) && !isSkipped(f) && /agent-(browser|device)/.test(read(f))))
  }
  const state = loadState(root)
  return {
    root, head: head(), stack, tools, ci, scripts, verification,
    prose: proseRules(files),
    state: state ? { rules: (state.rules ?? []).map((r) => r.id), declined: (state.declined ?? []).map((d) => d.id), snapshots: (state.history ?? []).length, lastSnapshot: state.history?.at(-1)?.date ?? null } : null
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(statePath(root)), { recursive: true })
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + '\n')
}

function countsFor(rule) {
  return Object.fromEntries(Object.entries(matchProbe(root, listFiles(root), rule.probe)).map(([f, l]) => [f, l.length]))
}

function run(command, timeout = 900000) {
  try {
    const o = execSync(command, { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout, maxBuffer: 1 << 26 })
    return { code: 0, output: o, tail: o.split('\n').slice(-6).join('\n') }
  } catch (e) {
    const o = (e.stdout ?? '') + (e.stderr ?? '')
    return { code: e.status ?? 1, output: o, tail: o.split('\n').slice(-12).join('\n') }
  }
}

// A canary counts only when the check passes without it and its failure names both the canary's
// path and the rule's diagnostic (canary.expect, by default ratchet-check's "[rule-id]"), so a build
// that breaks for another reason, even on the canary file, is not taken as proof.
function canary(rule, control) {
  const p = path.join(root, rule.canary.path)
  if (fs.existsSync(p)) return 'SKIPPED: canary path exists'
  if (!fs.existsSync(path.dirname(p))) return 'SKIPPED: directory gone, update canary.path'
  const command = rule.canary.check ?? rule.check ?? 'node scripts/ratchet-check.mjs'
  const before = command === rule.check && control ? control : run(command)
  if (before.code !== 0) return 'SKIPPED: the check fails without the canary'
  fs.writeFileSync(p, rule.canary.content)
  try {
    const c = run(command)
    if (c.code === 0) return 'DOES NOT FIRE'
    const expect = rule.canary.expect ?? '[' + rule.id + ']'
    const lines = c.output.split('\n')
    if (lines.some((l) => l.includes(rule.canary.path) && l.includes(expect))) return 'fires'
    return 'FAILS FOR ANOTHER REASON: no output line names both ' + rule.canary.path + ' and ' + expect
  } finally {
    fs.rmSync(p, { force: true })
  }
}

function verify() {
  const state = loadState(root)
  if (!state) {
    process.exitCode = 1
    return { error: 'no .ratchet/state.json' }
  }
  const files = listFiles(root)
  const byId = Object.fromEntries(ratchet(root, state, files).map((r) => [r.id, r]))
  const results = []
  const checked = new Map()
  let ok = true
  for (const rule of state.rules ?? []) {
    const r = { id: rule.id }
    if (!rule.check && !rule.probe) { r.incomplete = 'no check and no probe: nothing enforces this rule'; ok = false }
    if (!rule.canary) { r.incomplete = (r.incomplete ? r.incomplete + '; ' : '') + 'no canary: nothing proves the check fires'; ok = false }
    if (byId[rule.id]) {
      Object.assign(r, { total: byId[rule.id].total, violations: byId[rule.id].violations.length, slack: byId[rule.id].slack })
      if (r.violations) ok = false
    }
    let control
    if (rule.check && !flag('no-checks')) {
      if (!checked.has(rule.check)) checked.set(rule.check, run(rule.check))
      control = checked.get(rule.check)
      r.check = control.code === 0 ? 'pass' : 'FAIL'
      if (control.code) { r.checkOutput = control.tail; ok = false }
    }
    if (rule.canary && !flag('no-checks')) {
      r.canary = canary(rule, control)
      if (r.canary !== 'fires') ok = false
    }
    results.push(r)
  }
  if (!ok) process.exitCode = 1
  return { head: head(), ok, rules: results }
}

// Files whose change can move a measurement or a rule: source, the prose rules come from, CI and tool config.
const MEASURED = (f) => !!f && !f.startsWith('.ratchet/') && (/^\.github\/workflows\/|^\.gitlab-ci\.yml$/.test(f) || (!isSkipped(f) && (SOURCE_EXT.test(f) || PROSE.some((r) => r.test(f)) || /(^|\/)(package\.json|[\w.-]*config[\w.-]*\.\w+|\.?[\w-]*rc(\.\w+)?|[\w-]+\.gradle\.kts|libs\.versions\.toml|pyproject\.toml|Cargo\.toml|go\.mod)$/.test(f))))

function snapshot() {
  const state = loadState(root) ?? { version: 1, rules: [], declined: [], history: [] }
  const before = args.indexOf('--before')
  if (before !== -1) return snapshotBefore(state, args[before + 1])
  const h = head()
  const last = state.history?.at(-1)
  if (last) {
    try {
      const changed = last.commit === h ? [] : git(['diff', '--name-only', last.commit, 'HEAD']).split('\n').filter(MEASURED)
      const dirty = git(['status', '--porcelain']).split('\n').filter((l) => l && l.slice(0, 2) !== '??').map((l) => l.slice(3)).filter(MEASURED)
      if (!changed.length && !dirty.length) return { unchanged: true, since: last.commit }
    } catch {}
  }
  const entry = { commit: h, date: new Date().toISOString().slice(0, 10), metrics: measure(), git: gitMetrics('30 days ago') }
  state.history = (state.history ?? []).filter((e) => e.commit !== h)
  state.history.push(entry)
  saveState(state)
  return entry
}

// The project as it was at <rev>, measured with today's rules, kept as the first snapshot so the report starts before the changes.
function snapshotBefore(state, rev) {
  if (!rev) return { error: 'snapshot --before <commit>' }
  const commit = git(['rev-parse', '--short', rev]).trim()
  const date = git(['show', '-s', '--format=%cs', commit]).trim()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-before-'))
  const stateFile = path.join(tmp, 'state.json')
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, history: [] }))
  const tree = path.join(tmp, 'tree')
  try {
    git(['worktree', 'add', '--detach', '-q', tree, commit])
    const metrics = JSON.parse(execFileSync(process.execPath, [new URL(import.meta.url).pathname, 'measure', '--state', stateFile], { cwd: tree, encoding: 'utf8', maxBuffer: 1 << 26 }))
    const entry = { commit, date, phase: 'before', metrics }
    state.history = [entry, ...(state.history ?? []).filter((e) => e.commit !== commit)]
    saveState(state)
    return entry
  } finally {
    try { git(['worktree', 'remove', '--force', tree]) } catch {}
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function report() {
  const state = loadState(root)
  if (!state?.history?.length) return { error: 'no snapshots yet; run snapshot first' }
  const first = state.history[0]
  const now = measure()
  const days = Math.round((Date.now() - Date.parse(first.date)) / 86400000)
  const before = new Date(Date.parse(first.date) - Math.max(days, 1) * 86400000).toISOString().slice(0, 10)
  const after = gitMetrics(first.date)
  const prior = gitMetrics(before, first.date)
  const probes = {}
  for (const id of new Set([...Object.keys(first.metrics.probes), ...Object.keys(now.probes)])) probes[id] = { from: first.metrics.probes[id]?.total ?? 0, to: now.probes[id]?.total ?? 0 }
  const rules = {}
  for (const id of new Set([...Object.keys(first.metrics.rules ?? {}), ...Object.keys(now.rules)])) rules[id] = { from: first.metrics.rules?.[id] ?? null, to: now.rules[id] ?? null }
  return {
    since: first.date, days, enoughData: days >= 14 || (after?.commits ?? 0) >= 20,
    probes, rules,
    comments: { from: first.metrics.commentRatio, to: now.commentRatio },
    testFiles: { from: first.metrics.testFiles, to: now.testFiles },
    git: { before: prior, after }
  }
}

function tighten() {
  const state = loadState(root)
  if (!state) return { error: 'no .ratchet/state.json' }
  const changed = {}
  for (const rule of state.rules ?? []) {
    if (!rule.probe || !rule.baseline) continue
    const now = countsFor(rule)
    const next = {}
    for (const [f, n] of Object.entries(rule.baseline)) {
      const k = Math.min(n, now[f] ?? 0)
      if (k) next[f] = k
    }
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)
    if (sum(next) < sum(rule.baseline)) changed[rule.id] = { from: sum(rule.baseline), to: sum(next) }
    rule.baseline = next
  }
  saveState(state)
  return { tightened: changed }
}

function baseline(id) {
  const state = loadState(root)
  const rule = state?.rules?.find((r) => r.id === id)
  if (!rule?.probe) return { error: 'no rule with a probe named ' + id + ' in .ratchet/state.json' }
  if (rule.baseline && !flag('raise')) return { error: id + ' already has a baseline; use tighten, or --raise --reason "..." to reset it (only with the user OK)' }
  const reasonAt = args.indexOf('--reason')
  if (rule.baseline && reasonAt === -1) return { error: 'a raise needs --reason "...": it is the record of a false positive or a deliberate exception' }
  if (rule.baseline) {
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)
    const next = countsFor(rule)
    ;(rule.raised ??= []).push({ date: new Date().toISOString().slice(0, 10), from: sum(rule.baseline), to: sum(next), reason: args[reasonAt + 1] })
    rule.baseline = next
  } else rule.baseline = countsFor(rule)
  saveState(state)
  return { id, baselineTotal: Object.values(rule.baseline).reduce((a, b) => a + b, 0), files: Object.keys(rule.baseline).length }
}

const commands = { inventory, measure: () => measure(), snapshot, verify, report, tighten, baseline: () => baseline(args[0]) }
const fn = commands[cmd]
const result = fn ? fn() : null
if (!fn || result?.error) process.exitCode = 1
console.log(JSON.stringify(fn ? result : { usage: 'ratchet.mjs inventory | measure | snapshot [--before <commit>] | verify [--no-checks] | tighten | baseline <rule-id> [--raise --reason <why>] | report | foundation [--apply]' }, null, 1))
