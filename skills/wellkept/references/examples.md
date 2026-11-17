# Examples per stack (checked 2026-11)

Starting points to calibrate, not rules to adopt. Check that a rule or option still exists in the version the project uses before relying on it. Prefer what the toolchain ships, then the linter the project already has.

## Common families

| Family | Why agents get it wrong | Usual alternative |
| --- | --- | --- |
| Effects and reactivity | Derived state, event handling and syncing all look like effects. Syncing with an outside system is the legitimate use. | Derive during render (`useMemo`, `$derived`, `computed`, `derivedStateOf`); handle events in the handler; keep real syncing in hooks named for what they do (`useSubscription`, `useMediaQuery`, `useLatest(fetcher)`). |
| Timers and sleeps | "Wait 300 ms then scroll" patches an ordering problem. They pile up, leak, and make tests flaky. | Wire to the real event (transition end, layout callback, a flow). Keep timers in a few named helpers (`debounce`, `useInterval`, `sleep` in a CLI) that clean up. |
| Clock and randomness | Code that reads the clock can't be tested at midnight, across time zones or DST. | Pass `now` in, or read it from one provider. |
| Escape hatches | Each one is an agent winning an argument with the type checker. | Fix the type. Where one is truly needed, an inline exception with a reason. |
| Swallowed errors | Empty catch blocks and broad excepts hide the bug the next agent has to find. | Handle, rethrow, or return a typed error. |
| Layer boundaries | UI reaching the database, renderer reaching main: the shortest path compiles. | A dependency rule, or a package/module the wrong layer can't import. |
| Workaround comments | A comment explaining why a shortcut is fine is how the shortcut spreads. | Fix the cause and delete the comment, or turn the reason into a check. Domain "why" comments are fine. |
| Two ways to do one thing | Agents copy whichever they find first. | Delete the old way after migrating callers. |

## Tests

| Smell | Fix |
| --- | --- |
| Mocks of the project's own modules | Test through the public interface; pass outside dependencies in and fake them there. A real local stand-in beats a mock (PGlite or SQLite for the database, a temp dir for files). |
| Expected value computed like the code does, or asserted on data the test built | A literal from the requirement, or a property-based test (fast-check, Hypothesis, proptest, Kotest property, rapid). |
| Snapshot of a whole object or tree that changes in most commits | Assert the few fields that matter. |
| Fixed sleep in a test | Await the observable change, or use a fake clock. |
| `.only` / `.skip` left in | Lint: `vitest/no-focused-tests`, `vitest/no-disabled-tests` (same names for jest, also in oxlint's jest and vitest plugins); pytest: `--strict-markers` and review skips. |
| A test that reads source files to check their text | A lint rule. |

## TypeScript / JavaScript

- **Compiler**: tsconfig `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- **Linter**: what the project has; with none, oxlint (fast, zero config), and ESLint only for a plugin oxlint lacks. ESLint bulk suppressions (`eslint --suppress-all`) baseline old code.
- **Bans with a message**: `no-restricted-imports` (React `useEffect`/`useLayoutEffect`, Vue `watch`), `no-restricted-globals` (`setTimeout`, Svelte `$effect`), `no-restricted-properties` (`React.useEffect`, `window.setTimeout`), `no-restricted-syntax` for AST shapes. An `overrides` entry turns them off in the helpers folder.
- **Escape hatches**: `no-explicit-any`, `ban-ts-comment`, `no-non-null-assertion`.
- **Exceptions with reasons**: `@eslint-community/eslint-comments/require-description`, `reportUnusedDisableDirectives`.
- **Boundaries**: dependency-cruiser `forbidden` rules, or workspace packages that don't depend on each other.
- **Dead code**: knip.

oxlint config used on a React/Svelte app:

```json
{
  "categories": { "correctness": "error", "suspicious": "error" },
  "plugins": ["typescript", "import", "unicorn", "oxc", "react"],
  "rules": {
    "typescript/no-explicit-any": "error",
    "typescript/ban-ts-comment": ["error", { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true }],
    "no-restricted-imports": ["error", { "paths": [{ "name": "react", "importNames": ["useEffect", "useLayoutEffect"], "message": "Derive during render or use a hook from src/lib/hooks named for what it does." }] }],
    "no-restricted-globals": ["error", { "name": "setTimeout", "message": "Wait for the event, or use a helper from src/lib/hooks." }]
  },
  "overrides": [{ "files": ["src/lib/hooks/**"], "rules": { "no-restricted-imports": "off", "no-restricted-globals": "off" } }]
}
```

## Kotlin / Android / Compose

- **Compiler**: `allWarningsAsErrors`; Android lint `warningsAsErrors`, `abortOnError`.
- **Bans**: detekt `ForbiddenMethodCall` (`java.time.Instant.now`, `java.lang.Thread.sleep`), `ForbiddenImport` (`GlobalScope`), each with a `reason`; `baseline.xml` for old code.
- **Escape hatches**: detekt `UnsafeCallOnNullableType` (`!!`), `UnsafeCast`.
- **Compose**: `LaunchedEffect` for navigation or pager coordination is the Compose version of effect soup; push decisions into a pure tested function or the ViewModel. Konsist tests or a convention script can restrict effects to named helpers.
- **Boundaries**: the Gradle module graph (a `feature` module can't depend on a `source` module), checked by a convention plugin or Konsist; handle both `projects.x` and `project(":x")`.

## Python

ruff (`flake8-tidy-imports.banned-api` with `msg` for `time.sleep`, `datetime.datetime.now`; `BLE001` blind except; `PGH003`/`PGH004` blanket ignores; `RUF100` unused noqa), mypy or pyright strict, import-linter for layers, vulture for dead code.

## Go

`go vet`; golangci-lint with `forbidigo` (`^time\.Sleep$`, `^time\.Now$` outside a clock package, each with `msg`), `depguard` for imports, `errcheck`, `nolintlint` (`require-explanation`, `require-specific`), `unused`. `internal/` packages are a free boundary.

## Rust

`[lints]` in Cargo.toml: `unsafe_code = "forbid"`, clippy `unwrap_used`, `expect_used`, `allow_attributes_without_reason`; `clippy.toml` `disallowed-methods` with a `reason` (`std::thread::sleep`, `std::time::SystemTime::now`); `#[expect(lint, reason = "...")]` for exceptions; workspace crates as boundaries.

## Swift

`-warnings-as-errors`, Swift 6 strict concurrency; SwiftLint `force_unwrapping`, `force_cast`, `custom_rules` for `DispatchQueue.main.asyncAfter` or `Date()` outside a clock type, `superfluous_disable_command`; Periphery for dead code.

## C# / .NET

`TreatWarningsAsErrors`, `Nullable` enabled, `AnalysisLevel latest-all`; BannedApiAnalyzers with `BannedSymbols.txt` (`Thread.Sleep`, `DateTime.Now`).

## Dart / Flutter

`analysis_options.yaml` with `strict-casts`, `strict-inference`, `strict-raw-types`; `avoid_dynamic_calls` as an error.

## Anything else

Ask the same questions: what makes the compiler strictest, what lets code escape the type system, which APIs need nuance here, what finds dead code, what runs the tests. Map each to the stack's own tools.
