# skills

Agent skills by antomanc. Install with the [skills](https://skills.sh) CLI:

```sh
npx skills add antomanc/skills --skill ratchet
```

## ratchet

Makes a codebase one agents can be trusted in. It finds where agents produce slop (effects, timers, escape hatches, clock reads, cross-layer imports, rules that live only in prose), proposes a short plan, and turns each accepted item into a deterministic check: a lint rule, an architecture test, or a probe with a per-file ratchet, each with a canary that proves it fires for its own reason.

Run it again on the same project at any time. It checks that every guardrail still fires, lowers baselines as old occurrences go away, picks up new prose rules, and reports before/after trends once there is enough history. On an unchanged project a re-run changes nothing.

State lives in `.ratchet/state.json` in the project. Probe rules are enforced in CI by `scripts/ratchet-check.mjs`, a dependency-free Node script the skill copies into the project.

Based on Lauren "poteto" Tan's talk at AI Engineer Code ("nuance tends to lead to slop"): every correction should become a check, an API that hides the nuance, or a test, with prose as the last layer.

## License

MIT
