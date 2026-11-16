#!/usr/bin/env node
// foundation: the guardrail contract every project should meet, whatever its language or tools.
//
// The contract, checked here without knowing any tool:
//   - one verify command runs every check (state.verify), and CI runs it;
//   - every intent below is covered by at least one rule with a check and a canary, or declined with a reason;
//   - AGENTS.md says how to run verify.
// Which linter or compiler flag covers an intent is the agent's choice for the stack (references/stacks.md),
// proven by the canary, so the contract outlives any particular tool.
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

export const INTENTS = {
  'strict-compiler': 'The strictest compiler or type-checker settings the stack has, warnings as errors.',
  'escape-hatches': 'No way around the type system inline: any/unknown casts, force unwraps (!, !!, unwrap, try!), unchecked casts, unsafe without review.',
  'nuance-apis': 'APIs agents misuse are banned outside named helpers: effects, timers and sleeps, raw threads or goroutines, direct clock reads where time matters.',
  'dead-code': 'Unused code, exports and dependencies fail the build.',
  'tests': 'A test command that runs in verify; a failing test fails verify.',
  'no-inline-disables': 'Comments that silence a check are a rule of their own at zero.'
}

// Every suppression syntax we know, across languages. Text, not syntax: it has to work before any linter exists.
export const DISABLE_PATTERN = [
  '(eslint|oxlint)-disable', 'biome-ignore', 'svelte-ignore', '@ts-(ignore|expect-error|nocheck)', 'deno-lint-ignore',
  '#!?\\[allow\\(', '//\\s*nolint', 'swiftlint:disable', '@Suppress(Warnings)?\\(', 'ktlint-disable',
  '#\\s*noqa', '#\\s*type:\\s*ignore', '#\\s*pyright:\\s*ignore', 'rubocop:disable', '#pragma warning disable',
  'SuppressMessage\\(', 'NOSONAR', '//\\s*ignore(_for_file)?:', 'checkstyle:off', 'NOLINT', 'phpcs:ignore', 'shellcheck disable'
].join('|')
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
  if (!state.rules.some((r) => r.id === 'no-inline-disables')) {
    const probe = { pattern: DISABLE_PATTERN, include: ['**'], exclude: DISABLE_EXCLUDE }
    const baseline = Object.fromEntries(Object.entries(matchProbe(root, files, probe)).map(([f, l]) => [f, l.length]))
    state.rules.push({
      id: 'no-inline-disables', intent: 'no-inline-disables', kind: 'pattern',
      message: 'Fix the cause instead of silencing the check; if a rule is wrong for this code, change its config in review.',
      source: 'ratchet foundation', enforcedBy: 'ratchet-check probe', check: 'node scripts/ratchet-check.mjs', probe, baseline,
      canary: { path: 'ratchet-canary-disable.txt', content: 'nolint: // nolint\n', expect: '[no-inline-disables]' },
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
      '- A failing check says what to do instead. Fix the cause: comments that silence a check fail the build themselves.',
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
    : { status: 'missing', what }
}
const verifyNames = state.verify ? [state.verify, ...state.verify.split(/\s*&&\s*/)] : []
const result = {
  stacks,
  verify: state.verify ?? 'missing: pick the one command that runs every check, then --verify "<command>"',
  ci: !workflows.length ? 'missing' : state.verify && verifyNames.some((v) => ciText.includes(v)) ? 'runs verify' : 'present, does not run verify',
  agentsBlock: /<!-- ratchet:start -->/.test((read('AGENTS.md') ?? '') + (read('CLAUDE.md') ?? '')) ? 'present' : 'missing',
  intents,
  incompleteRules: state.rules.filter((r) => !complete(r)).map((r) => r.id),
  next: 'for each missing intent, add a rule with the stack\'s current tools (references/stacks.md), give it an intent and a canary, then run ratchet.mjs verify'
}
const missing = Object.values(intents).some((i) => i.status === 'missing') || !state.verify || result.ci !== 'runs verify' || result.incompleteRules.length
if (missing && !argv.includes('--apply') && !verifyArg) process.exitCode = 1
console.log(JSON.stringify(argv.includes('--apply') || verifyArg ? { changed, ...result } : result, null, 1))
