# Foundation per stack

Guardrails worth having before the first feature. Each one is deterministic, runs in CI, and has a canary. JS/TS is automated by `scripts/foundation.mjs`; the others are applied by hand from this page.

## Every project

- One command that runs every check (`verify`, `./gradlew check`, `make check`), the same in CI and locally, named in AGENTS.md.
- The strictest compiler settings the stack has, from the start.
- A linter with bans for the nuance APIs below, each with a message saying what to do instead.
- No way to silence a check inline: disable comments are themselves a ratchet rule at zero.
- A dead-code check (knip, detekt `UnusedPrivateMember`, vulture).
- A test runner that passes with no tests yet, so the first test lands in an existing setup.
- For apps: a way for the agent to run the app (fixed-port dev server, emulator script) and `docs/agents/feature-map.md`.

## JS / TS (automated)

What `foundation.mjs --apply` writes, and why:

| Piece | Why |
| --- | --- |
| `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` | The type checker answers questions agents otherwise guess at (an array index can be undefined). |
| oxlint `correctness` + `suspicious` as errors | Real bugs, with few false positives. `react-in-jsx-scope` and `no-shadow` off: wrong for modern JSX, noisy for updater callbacks. |
| `no-explicit-any`, `ban-ts-comment` (all forms), `no-non-null-assertion` | The usual ways an agent wins an argument with the type checker. |
| Effects banned outside the helpers directory (React `useEffect`/`useLayoutEffect` incl. `React.useEffect`, Svelte `$effect`, Vue `watch`/`watchEffect`) | The talk's first example: effects need nuance agents don't have. Legitimate uses become purpose-named helpers there. |
| Timers banned outside the helpers directory (`setTimeout` etc., incl. `window.` forms) | Timers are the common patch over an ordering problem. |
| `no-lint-disables` probe at zero | A disable comment would undo all of the above. |
| knip, vitest `--passWithNoTests` | Dead code and a ready test runner. |
| CI running `verify` | The same gate for every agent and person. |

Verified on fresh `create vite` React-TS and Svelte-TS projects: after `--apply`, the manual steps, and fixing the template's `!` on the root element, `verify` passes and every canary fires.

Optional, ask first: Playwright e2e once there is a screen; layer boundaries (dependency-cruiser, or oxlint import rules) once the layers are decided; a clock rule (`Date.now`, `new Date()` only in a time module) for apps that show times.

## Kotlin / Android (by hand)

- `allWarningsAsErrors = true` in the convention plugin.
- detekt with a config containing at least:
  ```yaml
  style:
    ForbiddenMethodCall:
      active: true
      methods:
        - value: 'java.time.Instant.now'
          reason: 'Take now as a parameter or from the app''s time source, so code can be tested at any hour.'
        - value: 'java.lang.System.currentTimeMillis'
          reason: 'Same: one time source.'
        - value: 'java.lang.Thread.sleep'
          reason: 'Suspend with delay in a coroutine, or wait for the event.'
    ForbiddenImport:
      active: true
      imports:
        - value: 'kotlinx.coroutines.GlobalScope'
          reason: 'Use a lifecycle-bound scope.'
  potential-bugs:
    UnsafeCallOnNullableType:
      active: true
  ```
  and `./gradlew detekt` in `check`.
- Module boundaries checked on the declared graph, both `projects.x.y` and `project(":x:y")` forms (see ameki's `scripts/check-conventions.py` rule 3), with a canary per form.
- Compose: `LaunchedEffect`/`DisposableEffect` only in a few named helpers; navigation and pager decisions in a pure, tested function or the ViewModel.
- Robolectric + Roborazzi screenshot tests from the first screen.

These are not automated by `foundation.mjs` yet and have not been run on a fresh project; check that each canary fires when adding them.

## Python (by hand)

ruff with `select = ["E", "F", "B", "UP", "SIM", "TID", "PT"]` and `flake8-tidy-imports.banned-api` for nuance APIs with messages; mypy or pyright strict; `# type: ignore` and `# noqa` as a ratchet probe at zero.
