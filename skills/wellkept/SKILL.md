---
name: wellkept
description: Audit a codebase in any language or framework for AI slop, recurring bugs, and anti-patterns, then harden it with deterministic guardrails. Finds where agents or developers rely on nuance (effects, reactivity, timers, clock reads, escape hatches, silent fallbacks, swallowed errors, parallel implementations, cross-layer imports, workaround comments, tests that prove nothing), gives each an explicit alternative, and enforces it through the project's own tools with actionable error messages. Use for periodic codebase health checkups, auditing a repo for agent slop or recurring issues, turning AGENTS.md or coding-standard prose into lint/type rules, banning misuse-prone APIs (like useEffect), or re-checking guardrail drift over time.
license: MIT
metadata:
  tags: [code-quality, linting, ai-agents, slop, guardrails, refactoring, testing, audit, any-language]
---

# wellkept

Nuance leads to slop. When doing something right takes judgment, agents get it wrong: they copy the nearest example, take the shortest path that compiles, and argue their way around rules written in prose. So take the decision away:

1. **An explicit alternative** that hides the nuance: a hook named for what it does, a derived value, a clock helper, a typed result.
2. **A deterministic check** that fails the build when the raw form is used, with an error message that names the alternative. Compiler, types, linter, dependency rules, tests. Never an LLM review as the gate.
3. **Prose last**, one line, only for what no check can see.

You decide what this project needs. Nothing here is a mandatory rule: a ban right for a React app is wrong for a CLI. If `references/examples.md` exists alongside this skill, use it to calibrate per stack, not to copy blindly.

## 1. Look

Scope first: exclude generated code, vendored dependencies, lockfiles, and build artifacts. In large monorepos, focus on active packages or ask the user which scope to audit.

- **Setup & guardrail drift.** Language, framework, active tools (compiler flags, linter, formatter, type checker, test runner), the exact command CI runs, and instruction files (`AGENTS.md`, `CLAUDE.md`, contributing/standards docs). If guardrails already exist, check for drift first: are they still wired into CI, or have rules been disabled, widened, or bypassed with growing suppressions/baselines?
- **Where nuance and AI slop accumulate.** Think about this stack: which APIs are easy to misuse, which shortcuts compile but rot? Search with `rg` for typical families, then read the top files (counts point; reading decides):
  - *Misuse-prone APIs:* effects and reactivity, timers and sleeps, clock and randomness, concurrency/races.
  - *Type & error holes:* escape hatches (`any`, casts, forced unwraps, `unsafe`), swallowed errors, silent fallbacks (`?? ""`, `|| []`, defensive `if (!x) return` on non-null types that hide bugs instead of failing fast).
  - *Structural slop:* cross-layer imports, parallel implementations (two ways of doing the same thing because an agent missed the existing helper), pointless 1-to-1 wrappers, dead code.
  - *Escape trails:* inline suppressions (`eslint-disable`, `@ts-ignore`, `# noqa`), comments defending workarounds or narrating obvious code, stale `TODO`/`HACK` notes.
- **History & churn.** Look at the last ~100 commits or 90 days (whichever gives better signal):
  - *Repeated fixes:* the same bug class landing twice is a correction that never became a check. Read the actual diffs of suspicious fixes to find the root cause, not just commit titles.
  - *Hotspot files:* files modified repeatedly in bug-fix commits usually hide unencapsulated complexity or missing invariants.
- **Prose rules.** Every "never", "always", or "don't" in instruction files is a candidate deterministic check.
- **Tests.** Agents copy bad tests too. Judge each sampled test with two imagined edits:
  1. Break the behavior (wrong value, skipped or doubled effect): if the test still passes, it proves nothing.
  2. Change only the internals, same observable output: if the test fails, it is pinned to the implementation (mocking the project's own modules, call-count assertions, private helpers, whole-object snapshots).
  Keep tests that catch (1) and survive (2).

## 2. Report & plan, then stop

Present this concise health snapshot and action plan, then **STOP and wait for the user to approve which items to apply**. If the user only asked for an audit, stop here.

```markdown
wellkept report: <project / scope>

Codebase pulse:
- Verify & CI: <single command or fragmented / drift found>
- Escape hatches & suppressions: <counts by type, trend vs baseline if any>
- Top hotspots / repeated fixes: <2-3 concrete file:line or commit findings>

Guardrails to add (max 7):
1. <name>: <the explicit alternative>. Check: <tool and rule>. Evidence: <file:line or commits>. Replaces: <prose rule, if any>.
2. ...

Tests to fix or delete:
- <test file:line>: <which imagined edit it fails and what to do>

Structural debt (optional, max 3 — only issues a lint rule cannot express):
- <area/file>: <recurring design issue> -> <concrete permanent refactor>

Not doing:
- <finding that is fine in this context, one line each>
```

Planning rules:
- **Evidence before bans.** Propose a check only when this repo shows the problem (multiple occurrences, a fix that landed twice, hotspot churn, or a user correction). On a brand-new repo, propose only clear stack defaults.
- **At most 7 guardrails**, ranked by slop removed per unit of effort. A plan with 2 items—or zero if the codebase is genuinely clean—is a good outcome.
- **No disguised advice.** Every item under *Guardrails* must have a deterministic check. Genuine architectural issues belong under *Structural debt*, never padded into fragile lint rules.

## 3. Apply accepted items

**Git hygiene first:** check `git status` and the current branch. Never commit on top of unrelated uncommitted work or directly onto a protected branch without asking. Make **one clean commit per accepted item**.

### Accepted guardrails
1. **The alternative first.** Use what the project or framework already provides; otherwise build a small, well-named helper. If it encapsulates effects, timers, or concurrency, test its lifecycle (cleanup, stale results, errors). Never ban a pattern without landing its replacement in the same change.
2. **The check**, in order of preference:
   `types / module boundaries (wrong code can't compile)` -> `existing linter or compiler flags` -> `dependency / architecture tool` -> `a small repo script` (only if nothing else can express it).
   Add a new tool only if multiple rules need it. Allow the raw form only inside the helper. The error message must state **what to use instead and why** in one sentence (e.g., `"Read time through useNow(); direct clock reads break deterministic tests"`, not `"Forbidden"`).
3. **Old code.** Fix it if cheap and low-risk. Otherwise use the tool's baseline mechanism (bulk suppressions, lint baselines, explicit per-file ignores) so only new/touched code is blocked. Never silence a rule globally.
4. **Prove it.**
   - For configured rules (linter/compiler/types): create a minimal failing case and verify it fails with the exact rule message, plus a passing case using the alternative; delete both temporary files afterward and record the proof in the report.
   - For custom scripts or custom lint rules: leave a permanent unit test covering both the failing and passing cases.
5. **Visible exceptions.** Inline disables must name the specific rule and include a reason on the same line. Enforce this in the linter where supported.
6. **One fast verify command.** Wire everything into one command (`npm run verify`, `make check`, etc.) fast enough to run locally on every task (keep slow E2E suites separate if needed); ensure CI runs that exact command and `AGENTS.md` tells agents to run it before finishing.
7. **Replace the prose.** Delete prose rules now enforced by tooling. Keep one short line in `AGENTS.md` per alternative an agent needs to know exists (`"Read current time via useNow()"`).

### Accepted test cleanup
- Rewrite or delete listed tests. New tests drive the public interface with concrete inputs and literal expected values; mock only boundaries the project doesn't own (network, clock, third-party APIs). For pure logic with wide input spaces (parsers, converters, date math), prefer property-based tests over hand-picked duplicates. Prefer no test over one that can't fail.
- Add to `AGENTS.md`: `"If a test contradicts the task, stop and report the conflict. Never change an expected value, skip a test, or regenerate a snapshot just to get a green build."`
- Block focused/skipped tests (`.only`, `.skip`) without an explicit reason where the linter supports it.

### Accepted structural debt
- Confirm or add behavior-preserving tests before refactoring.
- Consolidate onto a single canonical path and delete the redundant one so two implementations never coexist.

## 4. Final report

Summarize per item: what changed, the check added, and the proof (failing output + passing case). Show the updated *Codebase pulse* (before -> after), and list what was intentionally left alone and why.

## Running it again

Run the same loop on the current codebase. Start with a **drift check**: confirm `verify` still runs all previous checks, CI still runs `verify`, no rule was weakened or broadened, and suppression/baseline counts haven't crept up. Then scan for new repeated fixes, hotspots, and prose rules. If the codebase is clean and nothing regressed, say so in a few lines and change nothing.

## Never

- Never weaken, skip, or delete a test or check to get a green build.
- Never ban an API or pattern without shipping its replacement.
- Never add a check the repo shows no evidence of needing.
- Never commit over uncommitted user work or silently broaden ignore lists.
- Never leave two parallel ways of doing the same thing after a refactor.
- Never add comments to justify a rule; the error message is the explanation.