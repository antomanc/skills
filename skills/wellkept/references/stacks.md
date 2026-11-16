# Tools per stack (examples, checked 2026-11)

The skill doesn't depend on any of these. They are a starting point for deciding each assessment area of the contract (`scripts/foundation.mjs`) on the stack in front of you, and they are defaults to propose with a reason, not rules every project must adopt.

Choosing a tool:

1. **Prefer what the toolchain ships** (compiler flags, `cargo clippy`, `go vet`, .NET analyzers, `swift build -warnings-as-errors`).
2. **Judge a third-party tool** on compatibility with the project, maintenance status, whether it can express the rule, and whether its version can be pinned. A stable tool with infrequent releases is fine. Look for a replacement when there is an actual compatibility or maintenance problem.
3. **Prove it with a canary.** A rule counts only when `wellkept.mjs verify --aggregate` shows its canary failing with the rule's own diagnostic, through its check and through the verify command.

Exceptions: prefer the form the tool can report as unused once the code is fixed (Rust `#[expect(lint, reason = "...")]`, TypeScript `@ts-expect-error` with a description, ESLint `reportUnusedDisableDirectives`), scoped to one line or item rather than moved into shared config, where the exception would cover more than it should.

If no linter can express a rule, a `wellkept-check` probe can (a regex over lines, with per-file ceilings). It is weaker, so prefer a parser where one exists.

## Rust
| Intent | Example |
| --- | --- |
| compiler | `[lints.rust] warnings = "deny"`, `unsafe_code = "forbid"` in Cargo.toml; `cargo clippy --all-targets -- -D warnings` |
| escape-hatches | `[lints.clippy] unwrap_used = "deny"`, `expect_used = "deny"`, `panic = "deny"` (allow in tests via `clippy.toml` `allow-unwrap-in-tests = true`) |
| nuance-apis | `clippy.toml` `disallowed-methods` with a `reason`: `std::thread::sleep`, `std::time::SystemTime::now`, `std::thread::spawn` outside one module |
| dead-code | `dead_code` and `unused` are warnings, so `-D warnings` covers them; `cargo machete` for unused dependencies |
| tests | `cargo test` |
Canaries go in `tests/` or `examples/` (compiled by `--all-targets`); a stray file in `src/` is not compiled unless a module declares it.

## Go
| Intent | Example |
| --- | --- |
| compiler | `go vet ./...`; the compiler already rejects unused imports and variables |
| escape-hatches | golangci-lint `forcetypeassert`, `errcheck`; ban `any`/`interface{}` in exported APIs with `forbidigo` if wanted |
| nuance-apis | golangci-lint `forbidigo` patterns with `msg`: `^time\.Sleep$`, `^time\.Now$` (outside a clock package via exclusion rules), bare `go` statements via `gochecknoglobals`/review |
| dead-code | golangci-lint `unused` |
| tests | `go test ./...` |

## Python
| Intent | Example |
| --- | --- |
| compiler | `mypy --strict` or `pyright` strict |
| escape-hatches | ruff `ANN401` (no `Any`), `PGH003` (blanket type ignores) |
| nuance-apis | ruff `flake8-tidy-imports.banned-api` with `msg`: `time.sleep`, `datetime.datetime.now`, `threading.Thread` |
| dead-code | ruff `F401`, `F841`; `vulture` for unused functions |
| tests | `pytest` or `python -m unittest` |

## TypeScript / JavaScript
| Intent | Example |
| --- | --- |
| compiler | tsconfig `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` |
| escape-hatches | oxlint or typescript-eslint: `no-explicit-any`, `ban-ts-comment` (all forms), `no-non-null-assertion` |
| nuance-apis | `no-restricted-imports` (React `useEffect`/`useLayoutEffect`, Vue `watch`), `no-restricted-globals` (`setTimeout`, Svelte `$effect`), `no-restricted-properties` (`React.useEffect`, `window.setTimeout`), each with a message; an `overrides` entry for the helpers directory |
| dead-code | knip |
| tests | vitest / jest with `--passWithNoTests` until the first test |
oxlint parses TS, JSX, Svelte and Vue script blocks with no config. A working oxlint config for a React or Svelte app (tried on fresh Vite templates):
```json
{
  "categories": { "correctness": "error", "suspicious": "error" },
  "plugins": ["typescript", "import", "unicorn", "oxc", "react"],
  "rules": {
    "react/react-in-jsx-scope": "off",
    "no-shadow": "off",
    "import/no-unassigned-import": ["error", { "allow": ["**/*.css"] }],
    "typescript/no-explicit-any": "error",
    "typescript/ban-ts-comment": ["error", { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true }],
    "typescript/no-non-null-assertion": "error",
    "no-restricted-imports": ["error", { "paths": [{ "name": "react", "importNames": ["useEffect", "useLayoutEffect"], "message": "Effects live in src/lib/hooks as hooks named for what they do." }] }],
    "no-restricted-globals": ["error", { "name": "setTimeout", "message": "Wait for the event, or use a helper from src/lib/hooks." }, { "name": "$effect", "message": "Effects live in src/lib/reactive." }],
    "no-restricted-properties": ["error", { "object": "React", "property": "useEffect", "message": "Effects live in src/lib/hooks." }, { "object": "window", "property": "setTimeout", "message": "Use a helper from src/lib/hooks." }]
  },
  "overrides": [{ "files": ["src/lib/hooks/**", "src/lib/reactive/**"], "rules": { "no-restricted-imports": "off", "no-restricted-globals": "off", "no-restricted-properties": "off" } }]
}
```

## Kotlin / Android
| Intent | Example |
| --- | --- |
| compiler | `allWarningsAsErrors = true` in the Kotlin compiler options; Android lint `warningsAsErrors` |
| escape-hatches | detekt `UnsafeCallOnNullableType` (`!!`), `UnsafeCast` |
| nuance-apis | detekt `ForbiddenMethodCall` (`java.time.Instant.now`, `java.lang.Thread.sleep`), `ForbiddenImport` (`kotlinx.coroutines.GlobalScope`), each with a `reason`; Compose effects via a convention script or Konsist test |
| dead-code | detekt `UnusedPrivateMember`, `UnusedImports`; Android lint `UnusedResources` |
| tests | `./gradlew test` |
Module boundaries: check the declared Gradle graph, both `projects.x.y` and `project(":x:y")` forms.

## Swift
| Intent | Example |
| --- | --- |
| compiler | `-warnings-as-errors`, Swift 6 strict concurrency (`swiftLanguageModes: [.v6]`) |
| escape-hatches | SwiftLint `force_unwrapping`, `force_cast`, `force_try` (opt-in rules) |
| nuance-apis | SwiftLint `custom_rules` (regex) for `DispatchQueue.main.asyncAfter`, `Thread.sleep`, `Date()` outside a clock type |
| dead-code | Periphery |
| tests | `swift test` / `xcodebuild test` |

## C# / .NET
`<TreatWarningsAsErrors>`, `<Nullable>enable</Nullable>`, `<AnalysisLevel>latest-all`; `Microsoft.CodeAnalysis.BannedApiAnalyzers` with `BannedSymbols.txt` for nuance APIs (`Thread.Sleep`, `DateTime.Now`); `dotnet test`.

## Dart / Flutter
`analysis_options.yaml` with `strict-casts`, `strict-inference`, `strict-raw-types` and errors for `avoid_dynamic_calls`; banned APIs via a custom lint or a probe; `dart test` / `flutter test`.

## Anything else
The same five questions: what makes the compiler strictest, what lets code escape the type system, which APIs need nuance, what finds dead code, what runs tests. Map each to the stack's own tools, give each rule a canary, and record the verify command.
