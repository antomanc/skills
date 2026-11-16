#!/usr/bin/env node
// foundation: the deterministic guardrails a JS/TS project should have from day one.
//   node foundation.mjs           checklist of what is present and what is missing (JSON)
//   node foundation.mjs --apply   add what is missing and safe to add; never overwrites a file it did not create.
// Applying twice changes nothing the second time.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot, listFiles, loadState, statePath } from './ratchet-check.mjs'

const root = repoRoot()
const apply = process.argv.includes('--apply')
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8') } catch { return null } }
const exists = (f) => fs.existsSync(path.join(root, f))
const changed = []
const manual = []
const code = (s) => '\x60' + s + '\x60'

function writeNew(f, content) {
  if (exists(f)) return false
  fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true })
  fs.writeFileSync(path.join(root, f), content)
  changed.push(f)
  return true
}

const pkgText = read('package.json')
if (!pkgText) {
  console.log(JSON.stringify({ error: 'foundation covers JS/TS projects with a package.json; for other stacks follow references/foundation.md' }, null, 1))
  process.exit(1)
}
const pkg = JSON.parse(pkgText)
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
const files = listFiles(root)
const pm = exists('pnpm-lock.yaml') ? 'pnpm' : exists('bun.lock') || exists('bun.lockb') ? 'bun' : exists('yarn.lock') ? 'yarn' : 'npm'
const run = (s) => (pm === 'npm' ? 'npm run ' + s : pm + ' ' + s)
const ui = deps.react ? 'react' : deps.svelte ? 'svelte' : deps.vue ? 'vue' : null
const helpers = { react: 'src/lib/hooks', svelte: 'src/lib/reactive', vue: 'src/composables' }[ui] ?? 'src/lib'
const ts = files.some((f) => /\.(ts|tsx)$/.test(f)) || !!deps.typescript

// Linter config (oxlint): parser-based bans whose messages say what to do instead.
function oxlintConfig() {
  const effectMsg = 'Effects live only in ' + helpers + ' as helpers named for what they do; derive the value or handle the event instead.'
  const timerMsg = 'Wait for the event itself (a promise, transitionend, an observer), or use a named helper from ' + helpers + '.'
  const timers = ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback']
  const rules = {
    'typescript/no-explicit-any': 'error',
    'typescript/ban-ts-comment': ['error', { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true }],
    'typescript/no-non-null-assertion': 'error',
    'import/no-unassigned-import': ['error', { allow: ['**/*.css', '**/*.scss'] }],
    'no-shadow': 'off',
    'no-restricted-globals': ['error', ...timers.map((name) => ({ name, message: timerMsg }))],
    'no-restricted-properties': ['error', ...timers.map((property) => ({ object: 'window', property, message: timerMsg }))]
  }
  if (ui === 'react') {
    rules['react/react-in-jsx-scope'] = 'off'
    rules['no-restricted-imports'] = ['error', { paths: [{ name: 'react', importNames: ['useEffect', 'useLayoutEffect'], message: effectMsg }] }]
    rules['no-restricted-properties'].push({ object: 'React', property: 'useEffect', message: effectMsg }, { object: 'React', property: 'useLayoutEffect', message: effectMsg })
  }
  if (ui === 'svelte') rules['no-restricted-globals'].push({ name: '$effect', message: effectMsg })
  if (ui === 'vue') rules['no-restricted-imports'] = ['error', { paths: [{ name: 'vue', importNames: ['watch', 'watchEffect'], message: effectMsg }] }]
  return {
    $schema: './node_modules/oxlint/configuration_schema.json',
    plugins: ['typescript', 'import', 'unicorn', 'oxc', ...(ui === 'react' ? ['react', 'react-hooks', 'jsx-a11y'] : [])],
    categories: { correctness: 'error', suspicious: 'error' },
    rules,
    overrides: [{ files: [helpers + '/**'], rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off', 'no-restricted-imports': 'off' } }]
  }
}

const linter = files.find((f) => /(^|\/)(\.oxlintrc\.json|eslint\.config\.\w+|\.eslintrc(\.\w+)?|biome\.jsonc?)$/.test(f))
const tsText = files.filter((f) => /(^|\/)tsconfig[\w.]*\.json$/.test(f)).map(read).join('\n')
const missingFlags = ts ? ['strict', 'noUncheckedIndexedAccess', 'noImplicitOverride', 'noFallthroughCasesInSwitch'].filter((flag) => !new RegExp('"' + flag + '"\\s*:\\s*true').test(tsText)) : []
const typecheck = pkg.scripts?.typecheck ?? (ui === 'svelte' && /svelte-check/.test(pkg.scripts?.check ?? '') ? pkg.scripts.check : ts ? 'tsc -b' : null)
const wantScripts = {
  ...(typecheck ? { typecheck } : {}),
  lint: 'oxlint',
  knip: 'knip',
  test: deps.jest ? 'jest --passWithNoTests' : 'vitest run --passWithNoTests',
  ratchet: 'node scripts/ratchet-check.mjs'
}
const verifySteps = Object.keys(wantScripts).map(run)
const workflows = files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f))
const ciText = workflows.map(read).join('\n')
const agentsFile = exists('AGENTS.md') ? 'AGENTS.md' : exists('CLAUDE.md') ? 'CLAUDE.md' : 'AGENTS.md'
const needDeps = ['oxlint', 'knip', ...(deps.jest ? [] : ['vitest'])].filter((d) => !deps[d])

const checklist = {
  stack: { pm, ui, ts, helpers },
  linter: linter ?? 'missing',
  typescriptFlagsMissing: missingFlags,
  scriptsMissing: Object.keys(wantScripts).filter((k) => !pkg.scripts?.[k]).concat(pkg.scripts?.verify ? [] : ['verify']),
  devDependenciesMissing: needDeps,
  ci: workflows.length ? (/\bverify\b/.test(ciText) ? 'runs verify' : 'present, does not run verify') : 'missing',
  ratchet: exists('scripts/ratchet-check.mjs') && loadState(root) ? 'present' : 'missing',
  agentsBlock: /<!-- ratchet:start -->/.test(read(agentsFile) ?? '') ? 'present' : 'missing',
  featureMap: exists('docs/agents/feature-map.md') ? 'present' : ui ? 'missing' : 'not needed',
  e2e: ui ? (deps['@playwright/test'] ? 'playwright' : 'missing: add Playwright once the first screen exists') : 'not needed'
}

if (apply) {
  if (!linter) writeNew('.oxlintrc.json', JSON.stringify(oxlintConfig(), null, 2) + '\n')
  else if (!/no-restricted-globals/.test(read(linter) ?? '')) manual.push(linter + ' exists: add the bans from references/foundation.md to it')

  const scripts = { ...(pkg.scripts ?? {}) }
  for (const [k, v] of Object.entries(wantScripts)) if (!scripts[k]) scripts[k] = v
  if (!scripts.verify) scripts.verify = verifySteps.join(' && ')
  if (JSON.stringify(scripts) !== JSON.stringify(pkg.scripts ?? {})) {
    pkg.scripts = scripts
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
    changed.push('package.json')
  }

  if (!exists('scripts/ratchet-check.mjs')) {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
    fs.copyFileSync(path.join(here, 'ratchet-check.mjs'), path.join(root, 'scripts/ratchet-check.mjs'))
    changed.push('scripts/ratchet-check.mjs')
  }
  const state = loadState(root) ?? { version: 1, rules: [], declined: [], history: [] }
  const lint = run('lint')
  const dir = fs.existsSync(path.join(root, 'src')) ? 'src/' : ''
  const rules = [
    { id: 'escape-hatches', kind: 'pattern', message: 'Fix the type instead of any, ts comments or non-null assertions.', enforcedBy: 'oxlint typescript rules', check: lint, canary: { path: dir + 'ratchet-canary-any.ts', content: 'export const ratchetCanary: any = 1\n', expect: 'no-explicit-any' } },
    { id: 'timers-in-helpers', kind: 'api', message: 'Timers live in named helpers in ' + helpers + '.', enforcedBy: 'oxlint no-restricted-globals', check: lint, canary: { path: dir + 'ratchet-canary-timer.ts', content: 'export const ratchetCanary = () => setTimeout(() => {}, 1)\n', expect: 'no-restricted-globals' } },
    { id: 'no-lint-disables', kind: 'pattern', message: 'Fix the cause instead of disabling the rule; if the rule is wrong for this code, change its config in review.', enforcedBy: 'ratchet-check probe', check: 'node scripts/ratchet-check.mjs', probe: { pattern: '(eslint|oxlint)-disable|biome-ignore|svelte-ignore', include: ['src/**'] }, baseline: {}, canary: { path: dir + 'ratchet-canary-disable.ts', content: '// oxlint-disable\nexport const ratchetCanary = 1\n' } }
  ]
  if (ui === 'react') rules.push({ id: 'effects-in-helpers', kind: 'api', message: 'useEffect lives only in ' + helpers + ' as hooks named for what they do.', enforcedBy: 'oxlint no-restricted-imports', check: lint, canary: { path: dir + 'RatchetCanary.tsx', content: "import { useEffect } from 'react'\nexport const ratchetCanary = useEffect\n", expect: 'no-restricted-imports' } })
  if (ui === 'svelte') rules.push({ id: 'effects-in-helpers', kind: 'api', message: '$effect lives only in ' + helpers + ' as helpers named for what they do.', enforcedBy: 'oxlint no-restricted-globals', check: lint, canary: { path: dir + 'ratchet-canary-effect.svelte.ts', content: 'export function ratchetCanary() {\n  $effect(() => {})\n}\n', expect: '$effect' } })
  if (ui === 'vue') rules.push({ id: 'effects-in-helpers', kind: 'api', message: 'watch and watchEffect live only in ' + helpers + '.', enforcedBy: 'oxlint no-restricted-imports', check: lint, canary: { path: dir + 'ratchet-canary-watch.ts', content: "import { watch } from 'vue'\nexport const ratchetCanary = watch\n", expect: 'no-restricted-imports' } })
  const date = new Date().toISOString().slice(0, 10)
  let added = 0
  for (const r of rules) if (!state.rules.some((x) => x.id === r.id)) { state.rules.push({ ...r, source: 'ratchet foundation', added: date }); added++ }
  if (added) {
    fs.mkdirSync(path.dirname(statePath(root)), { recursive: true })
    fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + '\n')
    changed.push('.ratchet/state.json')
  }

  const install = pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : pm === 'npm' ? 'npm ci' : pm === 'yarn' ? 'yarn install --immutable' : 'bun install --frozen-lockfile'
  if (!workflows.length) {
    writeNew('.github/workflows/ci.yml', [
      'name: CI', '', 'on:', '  push:', '    branches: [main]', '  pull_request:', '', 'jobs:', '  verify:', '    runs-on: ubuntu-latest', '    steps:',
      '      - uses: actions/checkout@v5',
      ...(pm === 'pnpm' ? ['      - uses: pnpm/action-setup@v4'] : pm === 'bun' ? ['      - uses: oven-sh/setup-bun@v2'] : []),
      '      - uses: actions/setup-node@v5', '        with:', '          node-version: 24', ...(pm === 'bun' ? [] : ['          cache: ' + pm]),
      '      - run: ' + install,
      '      - run: ' + run('verify'), ''
    ].join('\n'))
  } else if (!/\bverify\b/.test(ciText)) manual.push('CI exists: add a step running ' + run('verify'))

  const block = [
    '<!-- ratchet:start -->',
    '## Checks',
    '- ' + code(run('verify')) + ' runs every check (typecheck, lint, unused code, tests, ratchet). Run it before calling work done; CI runs the same.',
    '- A lint error says what to do instead. Fix the cause: disabling a rule, ' + code('any') + ', ts comments and non-null assertions are errors themselves.',
    ...(ui ? ['- Effects and timers live only in ' + code(helpers) + ', as helpers named for what they do.'] : []),
    ...(ui ? ['- ' + code('docs/agents/feature-map.md') + ' names every screen and control with the code behind it; keep it current.'] : []),
    '- A mistake corrected twice becomes a check in ' + code('.ratchet/state.json') + ', not a new line here.',
    '<!-- ratchet:end -->'
  ].join('\n')
  const agents = read(agentsFile)
  if (agents == null) writeNew(agentsFile, '# ' + (pkg.name ?? path.basename(root)) + '\n\n' + block + '\n')
  else if (!agents.includes('<!-- ratchet:start -->')) { fs.writeFileSync(path.join(root, agentsFile), agents.trimEnd() + '\n\n' + block + '\n'); changed.push(agentsFile) }
  else {
    const next = agents.replace(/<!-- ratchet:start -->[\s\S]*?<!-- ratchet:end -->/, block)
    if (next !== agents) { fs.writeFileSync(path.join(root, agentsFile), next); changed.push(agentsFile) }
  }

  if (ui) writeNew('docs/agents/feature-map.md', '# Feature map\n\nWhat a user sees, with the names to use for it and the code behind it. A new screen, control or dialog gets a row in the same change.\n\n| Name | What it is | How to reach it | Code |\n| --- | --- | --- | --- |\n')
  if (needDeps.length) manual.push('install: ' + (pm === 'npm' ? 'npm install -D ' : pm === 'yarn' ? 'yarn add -D ' : pm + ' add -D ') + needDeps.join(' '))
  if (missingFlags.length) manual.push('tsconfig: set ' + missingFlags.map((f) => '"' + f + '": true').join(', ') + ' in the app tsconfig')
  manual.push('run ' + run('verify') + ' and fix what it reports in the existing code')
  manual.push('node <skill>/scripts/ratchet.mjs verify: every rule must pass and every canary fire')
}

console.log(JSON.stringify(apply ? { changed, manual } : checklist, null, 1))
