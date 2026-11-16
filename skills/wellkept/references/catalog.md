# Probe catalog

What `wellkept.mjs measure` counts, why each is a nuance trap, and how to enforce the fix per stack. Read the section for the project's stack only.

## Universal

| Probe | Why agents get it wrong | Usual fix |
| --- | --- | --- |
| `timers` | Timers are the easy patch over an ordering or architecture problem ("wait 300ms then scroll"). They pile up, cause jank and flaky tests. | Name the event being waited for and wire to it (transition end, layout callback, a flow). Keep timers only inside a few named helpers (`debounce`, `flash`, `sleep` in a CLI) and ban them elsewhere. |
| `clock-reads` | Code that reads the clock can't be tested at midnight, across time zones or DST. | Pass `now` in, or read it from one provider (a `Clock` injected, a `rememberNow()`). Ban direct reads outside it. |
| `escape-hatches` | Each one is an agent winning an argument with the type checker or linter. | Fix the type. Ban the hatch; where one is genuinely needed, require a rule-specific reason in a dedicated helper, not inline. |
| `effects` | Effects are the classic nuance API: derived state, event handling and syncing all look like effects. Syncing with an external system is a legitimate use. | When the repo shows misuse: derive instead (`$derived`, `useMemo`, `derivedStateOf`, a ViewModel flow) and move the legitimate uses (subscriptions, observers, latest-wins async) into purpose-specific helpers, then restrict raw effects outside them, with the helpers' directory under its own baseline. |
| `justification-comments` | Comments explaining why a shortcut is fine are how shortcuts spread. | Fix the cause and delete the comment, or turn the reason into a check. |
| `todos` | Promises nobody tracks. | An issue, or delete it. |

Committed generated files (fixtures, snapshots, generated clients, lockfile-like data): if a script regenerates them, CI should regenerate and fail on a diff. A doc line saying "the committed X can lag" is this check missing.

Comment ratio: a high ratio is not a finding by itself. Look at what comments say. Domain "why" comments are fine; a comment that holds examples of inputs ("14- oz . can") is a test case in disguise; a comment that restates the code or defends a workaround should go.

Git metrics (`report`): a file in `hotspots` with many fix commits is where a missing abstraction usually lives. Fix ratio, reverts, comment ratio and test-file counts are weak signals of quality; use them to find where to look, not to claim an effect.

## TypeScript / JavaScript

- **Linter**: prefer what the project has. None? Use oxlint (fast, zero config) for patterns and add eslint only when you need a plugin oxlint lacks. ESLint bulk suppressions (`eslint --suppress-all`, `eslint-suppressions.json`) are a native ratchet.
- **Bans**: `no-restricted-syntax` with a selector and a message, e.g. `CallExpression[callee.name='setTimeout']`; `no-restricted-imports` / `no-restricted-globals` for APIs and modules. Use `overrides`/`files` to allow the one helper file.
- **Boundaries**: dependency-cruiser `forbidden` rules, or workspace `package.json` dependencies (a package can't import what it doesn't depend on, with pnpm's strict linking). Name directories after the boundary (`electron-main`, `electron-renderer`, `core`, `ingest`) so the context is in the path.
- **Unused code**: knip.
- **React**: when effects are misused here, restrict `useEffect`/`useLayoutEffect` to purpose-specific hooks (`useSubscription`, `useLatest(asyncFn)`, `useInterval`), following React's own guidance ("You Might Not Need an Effect", custom hooks named for their purpose, not generic effect wrappers).
- **Svelte 5**: when effects are misused here, restrict `$effect` to `src/lib/reactive/**` (eslint-plugin-svelte parses runes; or a `wellkept-check` probe `\$effect(\.pre)?\s*\(`). Replacements: `$derived` for derived values, a `latest(fn)` helper for request/response with stale-answer dropping, `observe(el, cb)` for IntersectionObserver/ResizeObserver, `flash(ms)` for transient UI state. Resetting state "when X changes" is usually a `$derived` with a key or an event handler, not an effect.
- **Vue**: same for `watch`/`watchEffect`; prefer `computed`.

## Kotlin / Android / Compose

- **Linter**: detekt with `ForbiddenMethodCall`, `ForbiddenImport`, `ForbiddenAnnotation` (each takes a `reason`, shown in the error) and a native `baseline.xml` ratchet. Android lint has `lint-baseline.xml` too. If the project already has a convention script in CI, small regex rules can go there instead of adding detekt.
- **Architecture tests**: Konsist (JUnit tests over the code: "classes in `..feature..` don't import `..source..`", "ViewModels end with ViewModel and live in feature modules").
- **Module boundaries**: the Gradle graph is the cheapest boundary there is. A check task (or a test reading `settings.gradle.kts` + each `build.gradle.kts`) that fails when `feature:*` depends on `source:*` or `widget` depends on Room. Convention plugins in `build-logic` can refuse forbidden `project(...)` dependencies at configuration time.
- **Compose effects**: `LaunchedEffect` for navigation/pager coordination is the Compose equivalent of useEffect soup. Push decisions into a pure, tested function (a reducer, `nextStep`) or the ViewModel; leave the composable applying results. Tickers (`while(true) { delay() }`) belong in a shared time source.
- **Clock**: `Instant.now()`, `LocalDate.now()`, `System.currentTimeMillis()`, `Clock.system*` only in the time provider.
- **Hatches**: `!!`, `@Suppress`, `runBlocking`, `GlobalScope`, `lateinit` outside DI/test.
- **Intent extras / string keys**: literal keys only in their one owner (an `AppRequest`-style class).

## Python

ruff (`flake8-tidy-imports.banned-api` for banned calls with messages, `TID` for relative imports), import-linter for layer contracts, mypy/pyright strict on new modules. Hatches: `# type: ignore`, `# noqa`, bare `except`.

## Go

golangci-lint with `forbidigo` (banned calls, with messages) and `depguard` (import boundaries). `internal/` packages are a free boundary.

## Rust

clippy `disallowed-methods` / `disallowed-types` in `clippy.toml` (each with a reason), `#![deny(clippy::unwrap_used)]` outside tests, workspace crates as boundaries.

## Embedded / C++ (Arduino, ESP-IDF)

Blocking calls (`delay(`) in loops that also serve radios or USB, heap allocation in ISRs, `String` in long-running code. A convention script with regex probes is usually the right size; a host-side unit test target for pure logic is the verification layer.
