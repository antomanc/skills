---
name: wellkept
description: Turn a codebase in any language into one agents can be trusted in. Audits where agents produce slop (effects, timers, escape hatches, clock reads, cross-layer imports, stale generated files, rules that live only in prose), proposes a short plan, then turns each demonstrated mistake into a deterministic check with a per-file ratchet and a canary that proves it fires for the right reason. Treats tests the same way: prunes tests that pass by construction or break on every refactor, proves the kept ones fail when behavior breaks, and makes deleting or weakening a test a declared, reviewed change. Re-run on the same project to verify every check still fires, tighten baselines, convert new prose rules and report before/after trends. Use when asked to harden a repo for AI agents, audit a codebase for agent anti-patterns or test slop, turn AGENTS.md or coding-standard rules into lint rules, or re-check a project ratcheted before.
---

# wellkept

Agents copy what the codebase shows them, and a rule written in prose is a rule they can argue their way around. So every correction should become something that fails a build: a better API that hides the nuance, a lint rule, an architecture test, a type. Prose is the last layer, for what needs judgment.

Tests are code agents copy too. A suite full of mocks of the project's own modules, snapshots of whole objects and assertions that restate the implementation teaches the next agent to write more of them, and it breaks on every refactor without catching a bug. An agent that writes the code and its tests in one pass grades its own homework: the same misunderstanding lands in both. So a test earns its place the same way a check does: it must fail when the behavior breaks, for its own reason.

This skill runs the same loop every time on the same project. The first run sets things up; later runs check that the guardrails still work, tighten them, and show what changed. Running it twice in a row on an unchanged commit must change nothing.

`SCRIPTS` below is this skill's `scripts/` directory. Run everything from the project root.

## 0. Foundation (new or young projects)

A fresh project is the cheapest moment to decide its guardrails: nothing to migrate, so whatever is adopted starts at zero. What to adopt is still a decision for this project, not a universal law: the talk's examples (ban `useEffect` in product code, hide nuance behind APIs) are strong defaults for some stacks and wrong for others.

The foundation is a **verification contract**, checked without knowing any tool:

- **One verify command** runs every check, and CI runs that exact command.
- **Six assessment areas**, each with a decision: rules (each with a check and a canary), or a declined entry with the reason. `compiler` (strictness, warnings), `escape-hatches` (any, forced unwraps and casts, unsafe), `nuance-apis` (effects, timers, threads, clock reads), `dead-code`, `tests` (the test command, and which tests are worth having), `suppressions` (how exceptions are written).
- **A test guard**: `state.tests` (section 4.3), so deleting a test file, removing assertions or switching tests off is never silent.
- **AGENTS.md** says how to run verify, in a short managed block.

```sh
node SCRIPTS/foundation.mjs                       # where the project stands; exits 1 while anything is undecided
node SCRIPTS/foundation.mjs --verify "<command>"  # record the one command that runs every check
node SCRIPTS/foundation.mjs --apply [--app]       # tool-free parts; never overwrites; twice = no change
```

`--apply` adds only what needs no tool choice: `scripts/wellkept-check.mjs`, the test guard with defaults for common languages, an `explained-suppressions` rule (an exception must name its rule and give a reason on the same line, in any language's syntax; existing ones become a ceiling), the AGENTS.md block, and with `--app` a feature map stub. `--no-suppression-rule` skips that rule when the project decides otherwise.

Then, for each area:

1. **Propose a default with its reason**, from what the stack and the app need: a UI app with a reactive framework gets effects restricted to named helpers; a CLI probably doesn't need a timer rule; a Rust library may allow `unwrap` in tests and forbid it elsewhere. Ask the user in one short round, together with what only they know: the layers and boundaries the app will have, and when e2e tests start.
2. **Pick the tool**: prefer what the toolchain ships (compiler flags, `cargo clippy`, `go vet`, analyzers), then the stack's mainstream linter. Judge a tool on compatibility with this project, maintenance status, whether it can express the rule, and whether its version can be pinned, not on how recent its last release is. Look for a replacement when there is an actual compatibility or maintenance problem. [references/stacks.md](references/stacks.md) has dated examples per stack.
3. **Write the rule** with a message that says what to do instead, add it to `.wellkept/state.json` with its `intent`, `check` and a `canary` whose `expect` is the tool's own diagnostic. Record a declined area as `{ "intent": "...", "reason": "...", "revisitWhen": "..." }` in `declined`.
4. **Wire and prove**: CI runs the exact verify command; fix the template's own violations; then `wellkept.mjs verify --aggregate`, which proves each canary fails both its own check and the verify command (so verify really runs every rule), and `foundation.mjs` exits 0.

The same contract is worth checking on an existing project during its first run: areas without a decision are candidates for the plan.

## 1. Look

Run both, in parallel:

```sh
node SCRIPTS/wellkept.mjs inventory   # stack, tools, CI steps, verification setup, prose rules, wellkept state
node SCRIPTS/wellkept.mjs measure     # probe counts and top files, comment ratio, rule totals
```

**Decide the mode from the inventory, before anything writes state:** `inventory` reports `state: null` on a first run.

- **New or young project** (just bootstrapped, or little code and no recurring fixes yet): go to section 0 first. There is no history to find misuse in yet, so decide the guardrails with the user from what the stack and the app need, while anything adopted can start at zero.
- **First run on an existing project**: take the before-snapshot now, before any change: `node SCRIPTS/wellkept.mjs snapshot`. (If changes were made already, `snapshot --before <commit>` measures the project as it was at that commit.) Without it the report can't show what the first changes did.
- **Re-run**: `.wellkept/state.json` exists: also run `node SCRIPTS/wellkept.mjs verify` (add `--no-checks` only if the user wants it fast; checks can take minutes) and `node SCRIPTS/wellkept.mjs report`, then go to section 5 before planning anything new.

Then read, don't just count:
- Open the top files of each probe and decide what the hits are. 12 effects in one component is a missing abstraction; one `setTimeout` in a CLI's sleep helper is fine. Counts point; reading decides.
- Read every prose rule the inventory listed (`prose`). Skip lines inside managed blocks of other tools (`managedBy`) unless they contradict the code.
- Read `git log --oneline -40` and look for the same kind of fix landing twice: that is a correction that never became a check.
- Read the tests like the code. `measure` reports `tests`: mocks (in JS, mocks of the project's own modules by relative path), skips, sleeps, and snapshots that keep changing. Open the top files and judge each test with two imagined edits: **break the behavior** (a wrong value, a skipped or doubled effect): a test that still passes proves nothing (loose assertion, expected value computed the way the code computes it, assertions on data the test built itself); **change the internals** and keep every observable result: a test that fails is pinned to the implementation (mocked internal collaborators, call counts and order, private helpers). Keep tests that catch the first and survive the second. A snapshot that changed in many recent commits while its test never forced a code fix is regenerated, not read.
- Look for generated files that are committed (fixtures, snapshots, generated code) and check they match what their generator writes today; a stale one is a missing freshness check.
- Find the project's existing check mechanism (a convention script, a lint config, an architecture test). Extending it beats adding a new tool.

Use [references/catalog.md](references/catalog.md) for what each probe means per stack and how to enforce it there.

## 2. Classify each finding

Put every finding in exactly one bucket:

| Bucket | Means | Becomes |
| --- | --- | --- |
| **API** | Agents need nuance to use something right (effects, timers, raw async races, clock reads, intent extras) | A small API that hides it, then a rule banning the raw form outside that API |
| **Boundary** | A layer or module must not reach another (UI → data source, renderer → main, widget → database) | A dependency rule: module graph check, import ban, architecture test |
| **Pattern** | A syntactic thing that is wrong everywhere here | A lint rule in the native linter, or a probe in `wellkept-check` |
| **Behavior** | A promise about what the product does ("the button never changes size", "share sends only title and url") | A test: unit, e2e, screenshot |
| **Judgment** | Needs taste or context no check can see | Stays prose, one line, in the file reviewers read |
| **Noise** | A probe hit that is fine, or a rule nobody needs | Record in `declined` with the reason and a `revisitWhen` (plus a `revisitProbe` when code can show it), so it isn't proposed again until that changes |

**Evidence before bans.** Adopt a restriction only when the repository shows recurring misuse (the same fix landing more than once, a hotspot full of the pattern, a correction given before) and the replacement removes a decision callers had to get right.

**No restriction without a sanctioned path that is easier than the workaround.** An agent blocked with nowhere legitimate to go will find somewhere illegitimate: in a long-run test, a timer ban with no timer helper made agents hide a polling loop in the data layer and leak a timer, and a ceiling on the helpers folder blocked the right hook. So, before restricting an API:

1. Pick the sanctioned path for this project: an existing helper, an established library, or a small helper you write now. Use what you know, the docs, or the web; the skill doesn't ship replacements, because the right one depends on the stack and the project.
2. Make it carry real lifecycle behaviour and test it: cleanup on unmount, dependency changes, stale answers, errors, separate instances. A helper that exists but leaks is worse than none.
3. Give the rule an **allow canary**: an ordinary, correct use through that path, which must pass the check and verify. It is the proof that the restriction leaves the right way open. Boundary rules need one too (a component importing a *type* from the data layer is legitimate even when importing its functions is not). `verify` fails an `api` or `boundary` rule without one.
4. Keep the helpers' home open: new purpose-named helpers there are ordinary work, guarded by their own tests and review, not by a count ceiling. Make the tests a check, not a hope: a rule that every helper file has a test beside it, so lifecycle bugs (a timer left running after unmount) are caught where they live.
5. Treat every exemption as a hole and close it: if a file may use the restricted thing (a fake server's latency timer), add a canary that tries to smuggle it out through that file (an exported `sleep` used elsewhere) and must fail, or check that the exempt file exports nothing but its own job.
6. Give each layer an explicit job instead of accidental exemptions (the data layer does I/O, it doesn't export timers), and check that boundary.

If you can't build a path that makes the correct implementation easy, don't restrict: decline the area with that reason, or keep it to review.

**Tests are findings too.** A test that fails either edit is a Behavior finding: rewrite it at the public seam (a concrete input, an expected value written as a literal from the requirement, mocks only for what the project doesn't own: network, clock, randomness, third-party APIs; a real local stand-in for the database or filesystem where one exists) or delete it. Prefer no test over a bad one. A test that reads source files to check their text is a lint rule in disguise: move it to the linter or a probe. A whole object or DOM tree in a snapshot becomes an assertion on the few fields that matter. For pure logic with wide input (parsers, unit conversion, date math), one property-based test (round-trip, idempotence, a simple reference model) beats a list of examples the agent picked. Deleting tests is a plan item with its evidence (which edit each fails, churn counts), never a side effect.

A prose rule that becomes a check is replaced in the same change. Two sources of truth drift.

## 3. Plan, then stop

Show the user a short plan and wait for a yes. Format:

```
wellkept plan: <project> @ <commit>

Found: <2-4 lines: the few things that matter, with file:line evidence and counts>

1. [API] <name>: <what changes>. Enforced by <tool>. Baseline <n>. Replaces <prose file:line>.
2. [Boundary] ...
...
Not doing: <findings judged Noise or Judgment, one line each>
Verification gaps: <only if real: no way to run the app, no feature map, no e2e>
```

Rules for the plan:
- At most 7 items, ordered by how much slop each removes per hour of work. Prefer one categorical fix over five lint rules.
- Every item names how it is enforced and what it replaces. An item with no enforcement is not a plan item.
- A Behavior item names the seam it tests through (the public function, route, command or screen) and the edit that must turn it red. A pruning item lists the tests and which of the two edits each fails.
- Say plainly when the project is already in good shape. A plan with two items is fine.
- The user may accept, drop or change items. Dropped items go to `declined` with the user's reason and what would reopen them.

## 4. Apply each accepted item

For each item, in order, as its own commit:

1. **Fix the root cause first where it is cheap.** Write the API, move the code, then ban the raw form. If cleaning every old occurrence is too big, ratchet instead (step 3).
2. **Enforce it with the project's own tools first**, in this order: types or module structure (it cannot be written) → a parser-based linter or architecture test (the stack's own, or its mainstream one: references/stacks.md) → the project's existing convention script → a probe in `.wellkept/state.json` checked by `wellkept-check`. A project with no linter gets one when a rule needs it (references/stacks.md lists options per stack). Use regex probes for what no linter sees, or as the per-file ceiling over legacy files while the linter blocks new ones. A check that parses one syntax must cover the others that mean the same thing (both `projects.x` and `project(":x")` in Gradle), with a canary for each. Error messages say what to do instead and why, in one sentence: they are the prompt the next agent reads. "Read time through rememberWeatherTime(); a composable that reads the clock cannot be tested at midnight" — not "Forbidden call".
3. **Protect the guardrails themselves.** In CI, run `node scripts/wellkept-check.mjs --against <main branch>`: a rule removed or loosened, a ceiling raised, the verify command changed, or a file listed in `state.protected` (linter configs, the CI workflow) edited fails unless the commit carries a `Wellkept-Change: <reason>` trailer. With `state.tests` set, it also fails on test changes that weaken a check: a test file deleted, assertions removed from a file, a skip/only/ignore marker added. Adding tests and assertions is ordinary work and passes. A deliberate prune or a behavior that really changed declares itself with the same trailer. It sees text, not intent: a matcher loosened in place (`toBe(1099)` to `toBeGreaterThan(0)`) keeps the count, so the tests that matter most get a behavior canary (step 5). Weakening a guardrail stays possible, but never silent. The AGENTS.md block tells agents that a test contradicting the task is a conflict to report, not an assertion to edit: with a way out, agents cheat on tests far less than when they're only told not to.
4. **Ratchet what you can't clean now.** Add the rule to `.wellkept/state.json` (schema in [references/state.md](references/state.md)) with a `probe`, then `node SCRIPTS/wellkept.mjs baseline <id>`. Each file gets a ceiling: as many occurrences as it has today, never more. Be honest about what that is: a file can still swap an old occurrence for a new one, and a regex sees text, not syntax. Where that matters, move the rule to a parser-based tool. The first time a project gets a probe rule, copy `SCRIPTS/wellkept-check.mjs` to `scripts/wellkept-check.mjs` and add `node scripts/wellkept-check.mjs` to CI next to the other checks.
5. **Add a canary**: a minimal file that breaks the rule, in `rule.canary`. `verify` runs the check without it (it must pass), writes it, runs the check again and counts it only when the failure names the canary (its path, or `canary.expect` when the check reports something else), then deletes it. A canary that breaks the build for another reason is reported as such, not as proof. A `behavior` rule's canary is a **mutation** instead (`canary.mutate`: a `find`/`replace` in a production file, like a flipped condition or a wrong return value): `verify` breaks the code, the check must fail with `expect` (text only a failing run prints, such as the runner's failure line for that test), then restores the file. A test that stays green with the behavior broken is not a guardrail.
6. **Shorten the prose it replaces, keep the why.** Delete procedure the check now carries; keep one line of rationale, or a link to the ADR, when the check enforces only part of the original intent or a future maintainer would ask why the constraint exists. Keep one line in AGENTS.md (or the standards file) when an agent needs to know the API exists: "Time comes from rememberWeatherTime()". Never add rules about the rule.
7. Run the project's checks and tests, and `node SCRIPTS/wellkept.mjs verify --aggregate`. It exits 1 unless every rule's check passes, every canary fails its own check and the verify command with the rule's diagnostic, every allow canary passes both, and nothing violates a ceiling.

After the last item is committed, run `node SCRIPTS/wellkept.mjs snapshot` and commit `.wellkept/state.json` on its own ("Record the wellkept snapshot"). A snapshot is keyed by commit, and later runs treat commits that touch only `.wellkept/` as no change, so a re-run right after this changes nothing.

Do not install a new linter just to host one rule if the convention script or `wellkept-check` can carry it; do install one when three or more rules need it or the rule needs a parser (imports, AST shapes).

## 5. Re-run: check, tighten, report

On a project with `.wellkept/state.json`:

1. **Broken guardrails first.** From `verify`: a rule whose `check` fails, a canary that `DOES NOT FIRE` or was `SKIPPED` (path moved), a probe that matches nothing anymore because files moved. Fix these before anything else; a guardrail that silently stopped working is worse than none.
2. **Tighten.** If any rule has `slack`, run `node SCRIPTS/wellkept.mjs tighten`. Baselines only go down. Raising one needs the user's explicit OK and a reason (`baseline <id> --raise --reason "..."`); the reasons in `rule.raised` are the rule's false positives, and a rule that keeps collecting them is a rule to rework or drop.
3. **Revisit declined findings** whose `revisitWhen` has happened (`verify` lists those whose `revisitProbe` matches) (a dependency added, an architecture change, the same mistake showing up again). A decline is a decision for the evidence of its day, not forever.
4. **New prose.** Compare the inventory's prose rules with the last run (`git log -p --since=<last snapshot date> -- AGENTS.md CLAUDE.md <standards files>`). Rules added since are candidates for section 2.
5. **New hotspots.** Probes that grew since the last snapshot, and files in `git.hotspots` that are not covered by any rule.
6. **Report.** Show the `report` output as a short table. Lead with what the skill controls: rule totals from the before-snapshot to now, broken guardrails found, baseline raises and their reasons (false positives), and how long `verify` took. Then the weak signals, labeled as weak: fix-commit ratio and reverts in the window since the first snapshot versus the same-length window before it, comment ratio, and `tests` (lines, mocks, skips, sleeps, snapshot lines). Fewer test lines with fewer mocks and skips is a suite that got leaner, not weaker; more test lines is not more safety. `enoughData` is true after 14 days or 20 commits, whichever comes first. If it is false, say the trend is too early to read and show only the guardrail status. Do not claim causation; say what moved.
7. **Speed.** If verify takes minutes, agents stop running it before they say done. That is a finding: split a fast check (types, lint, probes, unit) that runs on every change from slower e2e that runs in CI, and prune tests that cost time and catch nothing.
8. If anything is left, a plan as in section 3 (usually 0-3 items). Then `snapshot`, and commit `.wellkept/state.json` only if it changed.

When nothing changed since the last snapshot and everything passes, say so in one line and change no files.

## Verification layer

Checks stop known mistakes; verification catches the unknown ones. Propose these only when missing and only as plan items:
- **A way to run the app** the agent can call: a preview script, an emulator script, a dev server with a fixed port.
- **A feature map**: `docs/agents/feature-map.md`, each user-visible feature with its name, where it lives on screen, how to reach it, and the files behind it. It gives agents and the user a shared vocabulary ("the rain strip on the 4x2 widget"). Its "Run it" section says how to launch the app, check that the running instance is healthy before blaming the code, drive it as a user, and what evidence to keep.
- **Behavior checks** for the flows that broke before: e2e or screenshot tests, property-based tests for pure logic with wide input (parsers, unit conversion, date math).
- **Proof on the real thing.** "Tests pass" is not proof a feature works. Done means the agent ran the app, did the thing, and shows the result.

## Never

- Never weaken, skip or delete a test or check to get a green build. Pruning a test that proves nothing is a plan item the user accepted, committed with its reason.
- Never write a test after the fact just to have one: a test that passes by construction is worse than none.
- Never ban something the codebase needs without giving the replacement API in the same change.
- Never add explanatory comments to justify a rule; the error message is the explanation.
- Never write outside the project except into this skill's own scratch output.
