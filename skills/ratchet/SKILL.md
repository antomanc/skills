---
name: ratchet
description: Turn a codebase into one agents can be trusted in. Audits where agents produce slop (effects, timers, escape hatches, clock reads, cross-layer imports, stale generated files, rules that live only in prose), proposes a short plan, then turns each demonstrated mistake into a deterministic check with a per-file ratchet and a canary that proves it fires for the right reason. Re-run on the same project to verify every check still fires, tighten baselines, convert new prose rules and report before/after trends. Use when asked to harden a repo for AI agents, audit a codebase for agent anti-patterns, turn AGENTS.md or coding-standard rules into lint rules, or re-check a project ratcheted before.
---

# ratchet

Agents copy what the codebase shows them, and a rule written in prose is a rule they can argue their way around. So every correction should become something that fails a build: a better API that hides the nuance, a lint rule, an architecture test, a type. Prose is the last layer, for what needs judgment.

This skill runs the same loop every time on the same project. The first run sets things up; later runs check that the guardrails still work, tighten them, and show what changed. Running it twice in a row on an unchanged commit must change nothing.

`SCRIPTS` below is this skill's `scripts/` directory. Run everything from the project root.

## 1. Look

Run both, in parallel:

```sh
node SCRIPTS/ratchet.mjs inventory   # stack, tools, CI steps, verification setup, prose rules, ratchet state
node SCRIPTS/ratchet.mjs measure     # probe counts and top files, comment ratio, rule totals
```

On a **first run**, take the before-snapshot now, before any change: `node SCRIPTS/ratchet.mjs snapshot` (or later, `snapshot --before <commit>` measures the project as it was at that commit). Without it the report can't show what the first changes did.

If `.ratchet/state.json` exists, this is a **re-run**: also run `node SCRIPTS/ratchet.mjs verify` (add `--no-checks` only if the user wants it fast; checks can take minutes) and `node SCRIPTS/ratchet.mjs report`, then go to section 5 before planning anything new.

Then read, don't just count:
- Open the top files of each probe and decide what the hits are. 12 effects in one component is a missing abstraction; one `setTimeout` in a CLI's sleep helper is fine. Counts point; reading decides.
- Read every prose rule the inventory listed (`prose`). Skip lines inside managed blocks of other tools (`managedBy`) unless they contradict the code.
- Read `git log --oneline -40` and look for the same kind of fix landing twice: that is a correction that never became a check.
- Look for generated files that are committed (fixtures, snapshots, generated code) and check they match what their generator writes today; a stale one is a missing freshness check.
- Find the project's existing check mechanism (a convention script, a lint config, an architecture test). Extending it beats adding a new tool.

Use [references/catalog.md](references/catalog.md) for what each probe means per stack and how to enforce it there.

## 2. Classify each finding

Put every finding in exactly one bucket:

| Bucket | Means | Becomes |
| --- | --- | --- |
| **API** | Agents need nuance to use something right (effects, timers, raw async races, clock reads, intent extras) | A small API that hides it, then a rule banning the raw form outside that API |
| **Boundary** | A layer or module must not reach another (UI → data source, renderer → main, widget → database) | A dependency rule: module graph check, import ban, architecture test |
| **Pattern** | A syntactic thing that is wrong everywhere here | A lint rule in the native linter, or a probe in `ratchet-check` |
| **Behavior** | A promise about what the product does ("the button never changes size", "share sends only title and url") | A test: unit, e2e, screenshot |
| **Judgment** | Needs taste or context no check can see | Stays prose, one line, in the file reviewers read |
| **Noise** | A probe hit that is fine, or a rule nobody needs | Record in `declined` with the reason and a `revisitWhen`, so it isn't proposed again until that changes |

**Evidence before bans.** Adopt a restriction only when the repository shows recurring misuse (the same fix landing more than once, a hotspot full of the pattern, a correction given before) and the replacement removes a decision callers had to get right. A framework feature with legitimate uses (React effects for syncing with external systems, timers for real delays) is restricted, not banned: the legitimate uses move into purpose-specific helpers named after what they do (`useSubscription`, `latest`, `flash`), never into a generic wrapper that only renames the effect. The directory those helpers live in gets its own baseline too, so a new helper is a reviewed raise, not a free escape.

A prose rule that becomes a check is replaced in the same change. Two sources of truth drift.

## 3. Plan, then stop

Show the user a short plan and wait for a yes. Format:

```
ratchet plan: <project> @ <commit>

Found: <2-4 lines: the few things that matter, with file:line evidence and counts>

1. [API] <name>: <what changes>. Enforced by <tool>. Baseline <n>. Replaces <prose file:line>.
2. [Boundary] ...
...
Not doing: <findings judged Noise or Judgment, one line each>
Verification gaps: <only if real: no way to run the app, no feature map, no e2e>
```

Rules for the plan:
- At most 7 items, ordered by how much slop each removes per hour of work. Prefer one categorical fix over five lint rules.
- Every item names how it is enforced and what it replaces. An item with no enforcement is not a ratchet item.
- Say plainly when the project is already in good shape. A plan with two items is fine.
- The user may accept, drop or change items. Dropped items go to `declined` with the user's reason and what would reopen them.

## 4. Apply each accepted item

For each item, in order, as its own commit:

1. **Fix the root cause first where it is cheap.** Write the API, move the code, then ban the raw form. If cleaning every old occurrence is too big, ratchet instead (step 3).
2. **Enforce it with the project's own tools first**, in this order: types or module structure (it cannot be written) → the native linter or architecture test (detekt, eslint/oxlint, Konsist, dependency-cruiser, Gradle module graph) → the project's existing convention script → a probe in `.ratchet/state.json` checked by `ratchet-check`. Error messages say what to do instead and why, in one sentence: they are the prompt the next agent reads. "Read time through rememberWeatherTime(); a composable that reads the clock cannot be tested at midnight" — not "Forbidden call".
3. **Ratchet what you can't clean now.** Add the rule to `.ratchet/state.json` (schema in [references/state.md](references/state.md)) with a `probe`, then `node SCRIPTS/ratchet.mjs baseline <id>`. Each file gets a ceiling: as many occurrences as it has today, never more. Be honest about what that is: a file can still swap an old occurrence for a new one, and a regex sees text, not syntax. Where that matters, move the rule to a parser-based tool. The first time a project gets a probe rule, copy `SCRIPTS/ratchet-check.mjs` to `scripts/ratchet-check.mjs` and add `node scripts/ratchet-check.mjs` to CI next to the other checks.
4. **Add a canary**: a minimal file that breaks the rule, in `rule.canary`. `verify` runs the check without it (it must pass), writes it, runs the check again and counts it only when the failure names the canary (its path, or `canary.expect` when the check reports something else), then deletes it. A canary that breaks the build for another reason is reported as such, not as proof.
5. **Shorten the prose it replaces, keep the why.** Delete procedure the check now carries; keep one line of rationale, or a link to the ADR, when the check enforces only part of the original intent or a future maintainer would ask why the constraint exists. Keep one line in AGENTS.md (or the standards file) when an agent needs to know the API exists: "Time comes from rememberWeatherTime()". Never add rules about the rule.
6. Run the project's checks and tests, and `node SCRIPTS/ratchet.mjs verify`. It exits 1 unless every rule shows `check: pass`, `canary: fires` and no violations.

After the last item is committed, run `node SCRIPTS/ratchet.mjs snapshot` and commit `.ratchet/state.json` on its own ("Record the ratchet snapshot"). A snapshot is keyed by commit, and later runs treat commits that touch only `.ratchet/` as no change, so a re-run right after this changes nothing.

Do not install a new linter just to host one rule if the convention script or `ratchet-check` can carry it; do install one when three or more rules need it or the rule needs a parser (imports, AST shapes).

## 5. Re-run: check, tighten, report

On a project with `.ratchet/state.json`:

1. **Broken guardrails first.** From `verify`: a rule whose `check` fails, a canary that `DOES NOT FIRE` or was `SKIPPED` (path moved), a probe that matches nothing anymore because files moved. Fix these before anything else; a guardrail that silently stopped working is worse than none.
2. **Tighten.** If any rule has `slack`, run `node SCRIPTS/ratchet.mjs tighten`. Baselines only go down. Raising one needs the user's explicit OK and a reason (`baseline <id> --raise --reason "..."`); the reasons in `rule.raised` are the rule's false positives, and a rule that keeps collecting them is a rule to rework or drop.
3. **Revisit declined findings** whose `revisitWhen` has happened (a dependency added, an architecture change, the same mistake showing up again). A decline is a decision for the evidence of its day, not forever.
4. **New prose.** Compare the inventory's prose rules with the last run (`git log -p --since=<last snapshot date> -- AGENTS.md CLAUDE.md <standards files>`). Rules added since are candidates for section 2.
5. **New hotspots.** Probes that grew since the last snapshot, and files in `git.hotspots` that are not covered by any rule.
6. **Report.** Show the `report` output as a short table. Lead with what the skill controls: rule totals from the before-snapshot to now, broken guardrails found, baseline raises and their reasons (false positives), and how long `verify` took. Then the weak signals, labeled as weak: fix-commit ratio and reverts in the window since the first snapshot versus the same-length window before it, comment ratio, test files. `enoughData` is true after 14 days or 20 commits, whichever comes first. If it is false, say the trend is too early to read and show only the guardrail status. Do not claim causation; say what moved.
7. If anything is left, a plan as in section 3 (usually 0-3 items). Then `snapshot`, and commit `.ratchet/state.json` only if it changed.

When nothing changed since the last snapshot and everything passes, say so in one line and change no files.

## Verification layer

Checks stop known mistakes; verification catches the unknown ones. Propose these only when missing and only as plan items:
- **A way to run the app** the agent can call: a preview script, an emulator script, a dev server with a fixed port.
- **A feature map**: `docs/agents/feature-map.md`, each user-visible feature with its name, where it lives on screen, how to reach it, and the files behind it. It gives agents and the user a shared vocabulary ("the rain strip on the 4x2 widget").
- **Behavior checks** for the flows that broke before: e2e or screenshot tests, property-based tests for pure logic with wide input (parsers, unit conversion, date math).

## Never

- Never weaken or delete a test or check to make the plan pass.
- Never ban something the codebase needs without giving the replacement API in the same change.
- Never add explanatory comments to justify a rule; the error message is the explanation.
- Never write outside the project except into this skill's own scratch output.
