# skills

Agent skills by antomanc. Install with the [skills](https://skills.sh) CLI:

```sh
npx skills add antomanc/skills --skill wellkept
```

## wellkept

A well-kept codebase stays that way: every agent that works in it meets the same checks, and each check points to the right way to do things.

Makes a codebase one agents can be trusted in. It finds where agents produce slop (effects, timers, escape hatches, clock reads, cross-layer imports, rules that live only in prose), proposes a short plan, and turns each accepted item into a deterministic check: a lint rule, an architecture test, or a probe with a per-file ratchet, each with a canary that proves it fires for its own reason.

On a new project, in any language, it starts with a foundation: a contract (`scripts/foundation.mjs`) of one verify command run in CI and six kinds of guardrail (strict compiler, escape hatches, nuance APIs such as effects and timers, dead code, tests, no inline suppressions), each a rule with a canary. The script checks the contract without knowing any tool; the agent picks the stack's current tools for each part (`references/stacks.md` has examples for Rust, Go, Python, TS, Kotlin, Swift, .NET, Dart), and the canaries prove the choice works.

Run it again on the same project at any time. It checks that every guardrail still fires, lowers baselines as old occurrences go away, picks up new prose rules, and reports before/after trends once there is enough history. On an unchanged project a re-run changes nothing.

State lives in `.wellkept/state.json` in the project. Probe rules are enforced in CI by `scripts/wellkept-check.mjs`, a dependency-free Node script the skill copies into the project.

Every restriction comes with a sanctioned path, proven by an *allow canary* (a correct use that must pass), so a rule never leaves the agent with no right way to do something. Changes to the guardrails themselves fail CI unless the commit says why (`wellkept-check --against main` plus a `Wellkept-Change:` trailer).

### Does it help in the long run?

We measured it. A small React shop app gets 5 feature tickets in a row (debounced search, cart, persisted query, a details panel with racing requests, a "recently viewed" list with live times). Sonnet agents do each ticket with no help, and hidden tests (14, including one for leaked timers) grade the result after every ticket. Four setups, same code and prompts:

| Setup | Runs | Hidden tests at the end | Test files the agents wrote |
| --- | --- | --- | --- |
| A: nothing | 2 | 14/14 in both | 0 |
| B: the same rules written in AGENTS.md | 2 | 14/14 in both | 0 |
| C: guardrails from an early version of this skill | 2 | **13/14 in both: a leaked timer** | 0 |
| **C″: guardrails from this version** | 4 | **14/14 in all 4** | 5–6 per run |

What it shows:
- **Bad guardrails cause bugs.** Version C banned timers with no sanctioned helper, so agents found a way around the rule, and both runs leaked a timer. That's why every restriction now needs an allow canary.
- **Good guardrails don't, and they build a safety net.** C″ agents reused the sanctioned hooks, put every new hook behind a test (the verify command requires it), never edited a guardrail and used no suppressions. Without the skill, agents wrote no tests at all.
- **It costs tokens.** C″ runs used about 1.3–2.5× the output tokens of A (median about 1.5×), mostly on the tests.
- **What it doesn't show yet.** On this app, agents with no rules also wrote correct code, so this benchmark can't show fewer bugs than doing nothing. It shows the guardrails are safe to add and leave a growing test suite behind. A harder benchmark is next.

Based on Lauren "poteto" Tan's talk at AI Engineer Code ("nuance tends to lead to slop"): every correction should become a check, an API that hides the nuance, or a test, with prose as the last layer.

## Development

`npm test` runs the scripts against throwaway git repositories, including every bug found in review so far.

## License

MIT
