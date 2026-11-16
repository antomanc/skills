#!/usr/bin/env node
// foundation: a verification contract any project can meet, whatever its language, tools or policy.
//
// Checked here without knowing any tool:
//   - one verify command runs every check (state.verify), and CI runs that exact command;
//   - every assessment area below has a decision: rules (each with a check and a canary) or a recorded reason to skip it;
//   - AGENTS.md says how to run verify.
// The areas are questions, not mandatory restrictions: what to enforce, and with which tool, is decided per project
// (references/stacks.md has examples). Whether verify really runs each rule is proven by ratchet.mjs verify --aggregate.
//
//   node foundation.mjs                         checklist (JSON)
//   node foundation.mjs --verify "<command>"    record the project's verify command
//   node foundation.mjs --apply [--app]         add the tool-free parts; never overwrites; twice = no change
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot, listFiles, loadState, statePath, matchProbe } from './ratchet-check.mjs'

const root = repoRoot()
const argv = process.argv.slice(2)
const flagValue = (name) => { const i = argv.indexOf('--' + name); return i === -1 ? null : argv[i + 1] }
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8') } catch { return null } }
const exists = (f) => fs.existsSync(path.join(root, f))
const bt = (s) => '\x60' + s + '\x60'

// Assessment areas: each needs a decision, recorded as rules or as a declined entry with a reason.
export const INTENTS = {
  'compiler': 'How strict the compiler or type checker is, and whether warnings fail the build.',
  'escape-hatches': 'Which ways around the type system are allowed (any, forced unwraps and casts, unsafe), and where.',
  'nuance-apis': 'Which APIs this codebase has seen misused or expects to (effects, timers, threads, clock reads), and the helpers that replace them.',
  'dead-code': 'Whether unused code, exports and dependencies fail the build.',
  'tests': 'The test command; a failing test fails verify.',
  'suppressions': 'How exceptions to checks are written: narrow, with a reason, reviewed, and reported when no longer needed where the tool supports it.'
}

// Suppression syntax across languages. Text, not syntax, so it works before any linter is chosen.
const SUPPRESSIONS = [
  '(eslint|oxlint)-disable', 'biome-ignore', 'svelte-ignore', '@ts-(ignore|expect-error|nocheck)', 'deno-lint-ignore',
  '#!?\\[(allow|expect)\\(', '//\\s*nolint', 'swiftlint:disable', '@Suppress(Warnings)?\\(', 'ktlint-disable',
  '#\\s*noqa', '#\\s*type:\\s*ignore', '#\\s*pyright:\\s*ignore', 'rubocop:disable', '#pragma warning disable',
  'SuppressMessage\\(', 'NOSONAR', '//\\s*ignore(_for_file)?:', 'checkstyle:off', 'NOLINT', 'phpcs:ignore', 'shellcheck disable'
].join('|')
// A suppression is explained when its line gives a reason: Rust's reason = "...", a " -- " description
// (eslint, oxlint, biome), a reason word, or a comment after a named rule (//nolint:errcheck // flushed above).
const EXPLAINED = 'reason\\s*=|\\s--\\s+\\S|\\b(because|since|until|so that)\\b|:\\s*[\\w,-]+\\s+(//|#)\\s*\\S'
export const UNEXPLAINED_PATTERN = '^(?!.*(' + EXPLAINED + ')).*(' + SUPPRESSIONS + ')'
const DISABLE_EXCLUDE = ['**/node_modules/**', '**/vendor/**', '**/target/**', '**/build/**', '**/dist/**', '**/.gradle/**', '.git/**', '.agents/**', '.claude/**', '.codex/**', '.cursor/**', '.ratchet/**', '**/*.md', '**/*.lock', '**/*-lock.*', '**/*.lockb', 'scripts/ratchet-check.mjs']

const MANIFESTS = [
  ['js/ts', /(^|\/)package\.json$/], ['rust', /(^|\/)Cargo\.toml$/], ['go', /(^|\/)go\.mod$/], ['python', /(^|\/)(pyproject\.toml|requirements\.txt|setup\.py)$/],
  ['kotlin/java (gradle)', /(^|\/)(build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$/], ['java (maven)', /(^|\/)pom\.xml$/], ['swift', /(^|\/)Package\.swift$|\.xcodeproj\//],
  ['dart/flutter', /(^|\/)pubspec\.yaml$/], ['c#/.net', /\.(csproj|sln)$/], ['ruby', /(^|\/)Gemfile$/], ['php', /(^|\/)composer\.json$/], ['elixir', /(^|\/)mix\.exs$/],
  ['c/c++', /(^|\/)(CMakeLists\.txt|meson\.build|Makefile)$/], ['zig', /(^|\/)build\.zig$/]
]

const files = listFiles(root)
const stacks = [...new Set(MANIFESTS.filter(([, re]) => files.some((f) => re.test(f) && !/node_modules\//.test(f))).map(([s]) => s))]
let state = loadState(root) ?? { version: 1, rules: [], declined: [], history: [] }
const changed = []
const save = () => {
  fs.mkdirSync(path.dirname(statePath(root)), { recursive: true })
  const next = JSON.stringify(state, null, 2) + '\n'
  if (read('.ratchet/state.json') !== next) { fs.writeFileSync(statePath(root), next); if (!changed.includes('.ratchet/state.json')) changed.push('.ratchet/state.json') }
}

const verifyArg = flagValue('verify')
if (verifyArg) { state.verify = verifyArg; save() }

if (argv.includes('--apply')) {
  if (!exists('scripts/ratchet-check.mjs')) {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
    fs.copyFileSync(path.join(here, 'ratchet-check.mjs'), path.join(root, 'scripts/ratchet-check.mjs'))
    changed.push('scripts/ratchet-check.mjs')
  }
  if (!state.rules.some((r) => r.id === 'explained-suppressions') && !argv.includes('--no-suppression-rule')) {
    const probe = { pattern: UNEXPLAINED_PATTERN, include: ['**'], exclude: DISABLE_EXCLUDE }
    const baseline = Object.fromEntries(Object.entries(matchProbe(root, files, probe)).map(([f, l]) => [f, l.length]))
    state.rules.push({
      id: 'explained-suppressions', intent: 'suppressions', kind: 'pattern',
      message: 'Fix the cause, or keep the exception narrow (name the rule) and say why on the same line; prefer the form the tool reports when it is no longer needed (Rust #[expect], @ts-expect-error, unused-directive reports).',
      source: 'ratchet foundation', enforcedBy: 'ratchet-check probe', check: 'node scripts/ratchet-check.mjs', probe, baseline,
      canary: { path: 'ratchet-canary-suppression.txt', content: 'x // nolint\n', expect: '[explained-suppressions]' },
      added: new Date().toISOString().slice(0, 10)
    })
  }
  save()
  if (state.verify) {
    const agentsFile = exists('AGENTS.md') ? 'AGENTS.md' : exists('CLAUDE.md') ? 'CLAUDE.md' : 'AGENTS.md'
    const block = [
      '<!-- ratchet:start -->',
      '## Checks',
      '- ' + bt(state.verify) + ' runs every check. Run it before calling work done; CI runs the same command.',
      '- A failing check says what to do instead. Fix the cause; an exception names the rule and says why on the same line.',
      '- A mistake corrected twice becomes a check in ' + bt('.ratchet/state.json') + ', not a new line here.',
      ...(exists('docs/agents/feature-map.md') || argv.includes('--app') ? ['- ' + bt('docs/agents/feature-map.md') + ' names every screen and control with the code behind it; keep it current.'] : []),
      '<!-- ratchet:end -->'
    ].join('\n')
    const agents = read(agentsFile)
    const next = agents == null ? '# ' + path.basename(root) + '\n\n' + block + '\n'
      : agents.includes('<!-- ratchet:start -->') ? agents.replace(/<!-- ratchet:start -->[\s\S]*?<!-- ratchet:end -->/, block)
      : agents.trimEnd() + '\n\n' + block + '\n'
    if (next !== agents) { fs.writeFileSync(path.join(root, agentsFile), next); changed.push(agentsFile) }
  }
  if (argv.includes('--app') && !exists('docs/agents/feature-map.md')) {
    fs.mkdirSync(path.join(root, 'docs/agents'), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs/agents/feature-map.md'), '# Feature map\n\nWhat a user sees, with the names to use for it and the code behind it. A new screen, control or dialog gets a row in the same change.\n\n| Name | What it is | How to reach it | Code |\n| --- | --- | --- | --- |\n')
    changed.push('docs/agents/feature-map.md')
  }
}

// Checklist
const workflows = files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$|^\.gitlab-ci\.yml$|^\.circleci\/config\.yml$|^azure-pipelines\.yml$|^bitbucket-pipelines\.yml$/.test(f))
const ciText = workflows.map(read).join('\n')
const declined = new Map((state.declined ?? []).filter((d) => d.intent).map((d) => [d.intent, d.reason]))
const complete = (r) => (r.check || r.probe) && r.canary
const intents = {}
for (const [id, what] of Object.entries(INTENTS)) {
  const rules = state.rules.filter((r) => r.intent === id)
  intents[id] = declined.has(id) ? { status: 'declined', reason: declined.get(id) }
    : rules.some(complete) ? { status: 'covered', rules: rules.map((r) => r.id) }
    : { status: 'undecided', what }
}
const squash = (s) => s.replace(/\s+/g, ' ').trim()
const result = {
  stacks,
  verify: state.verify ?? 'missing: pick the one command that runs every check, then --verify "<command>"',
  ci: !workflows.length ? 'missing' : state.verify && squash(ciText).includes(squash(state.verify)) ? 'runs verify' : 'present, does not run the exact verify command',
  agentsBlock: /<!-- ratchet:start -->/.test((read('AGENTS.md') ?? '') + (read('CLAUDE.md') ?? '')) ? 'present' : 'missing',
  intents,
  incompleteRules: state.rules.filter((r) => !complete(r)).map((r) => r.id),
  next: 'decide each undecided area with the user: rules (each with a check and a canary) or a declined entry with intent and reason; then ratchet.mjs verify --aggregate proves verify runs every rule'
}
const missing = Object.values(intents).some((i) => i.status === 'undecided') || !state.verify || result.ci !== 'runs verify' || result.agentsBlock !== 'present' || result.incompleteRules.length
if (missing && !argv.includes('--apply') && !verifyArg) process.exitCode = 1
console.log(JSON.stringify(argv.includes('--apply') || verifyArg ? { changed, ...result } : result, null, 1))
