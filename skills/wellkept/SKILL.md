---
name: wellkept
description: Make a codebase in any language or framework harder for AI agents to fill with slop. Finds what agents get wrong in this project (effects and reactivity, timers, clock reads, escape hatches, swallowed errors, cross-layer imports, workaround comments, tests that prove nothing), gives each one an explicit alternative, and enforces it with a deterministic check in the project's own tools whose error message says what to use instead. Use when asked to harden a repo for agents, audit it for agent slop, turn AGENTS.md or coding-standard rules into lint rules, ban an API like useEffect, or check a project again later.
license: MIT
metadata:
  tags: "code-quality, linting, ai-agents, slop, guardrails, refactoring, testing, any-language"
---

# wellkept

**Nuance leads to slop.** When doing something right takes judgment, agents get it wrong: they copy the nearest example, take the shortest path that compiles, and argue their way around rules written in prose. So take the decision away:

1. **An explicit alternative** that hides the nuance: a hook named for what it does, a derived value, a clock helper, a typed result.
2. **A deterministic check** that fails the build when the raw form is used, with an error message that names the alternative. Compiler, types, linter, dependency rules, tests. Never an LLM review as the gate.
3. **Prose last**, one line, only for what no check can see.

You decide what this project needs. Nothing here is a mandatory rule: a ban that is right for a React app is wrong for a CLI. [references/examples.md](references/examples.md) has examples per stack, to calibrate, not to copy.

## 1. Look

- **The setup.** Language, framework, the tools that already run (compiler flags, linter, formatter, type checker, test runner), the command CI runs, and the agent instruction files (AGENTS.md, CLAUDE.md, contributing or standards docs).
- **Where agents need nuance here.** Think about this stack: which APIs are easy to misuse, which shortcuts compile but rot? Typical families: effects and reactivity, timers and sleeps, clock and randomness, concurrency, escape hatches (any, casts, forced unwraps, unsafe), swallowed errors, imports across layers, inline suppressions, comments that defend a workaround, dead code, two ways of doing the same thing. Search for them (`rg`), then **read** the top files. Twelve effects in one component is a missing abstraction; one sleep in a CLI retry loop is fine. Counts point, reading decides.
- **Repeated fixes.** `git log --oneline -50`: the same kind of fix landing twice is a correction that never became a check.
- **Prose rules.** Every "never", "always", "don't" in the instruction files is a candidate check.
- **Tests.** Agents copy tests too. Judge each test you read with two imagined edits: **break the behavior** (a wrong value, a skipped or doubled effect): if the test still passes, it proves nothing. **Change only the internals**, same observable results: if the test fails, it is pinned to the implementation (mocks of the project's own modules, call counts, private helpers, snapshots of whole objects). Keep tests that catch the first and survive the second.

## 2. Plan, then stop

Show the user a short plan and wait for a yes:

```
wellkept plan: <project>

Found: <2-4 lines, with file:line evidence>

1. <name>: <the alternative>. Check: <tool and rule>. Replaces: <prose rule, if any>.
2. ...
Tests: <tests to rewrite or delete, each with the edit it fails>
Not doing: <findings that are fine here, one line each>
```

- **Evidence before bans.** Propose a check only when this repo shows the problem (several occurrences, a fix that landed twice, a correction the user gave). On a new project, propose only the defaults its stack clearly needs.
- **At most 7 items**, the ones that remove the most slop first. A plan with two items is fine. If the project is already in good shape, say so.
- **Every item has a check.** An item that is only advice is not an item.

## 3. Apply each accepted item

One commit per item.

1. **The alternative first.** Use what the project or the framework already has; otherwise write a small helper. If it hides effects, timers or concurrency, test its lifecycle (cleanup, stale results, errors). Never ban something without giving the replacement in the same change. An agent blocked with no right way to go finds a wrong one.
2. **The check**, in this order of preference: types or module structure (the wrong thing can't be written) → the project's own linter or compiler options → its dependency or architecture tool → a small script in the repo, only when nothing else can express the rule. Add a new tool only when several rules need it. Allow the raw form only inside the helper. The message says what to do instead and why, in one sentence: "Read time through useNow(); a component that reads the clock can't be tested at midnight", not "Forbidden".
3. **Old code.** Fix it when that's cheap. Otherwise use the tool's own baseline (ESLint bulk suppressions, detekt or Android lint baselines, per-file ignores) so only new code is blocked. Never silence a rule for the whole repo.
4. **Prove it once.** Write a file that breaks the rule and run the check: it must fail with this rule's message. Write a correct use through the alternative: it must pass. Delete both and say in the report that you did it.
5. **Exceptions are visible.** An inline disable must name the rule and give a reason on the same line. Have the linter enforce this where it can (references/examples.md).
6. **One verify command.** Everything runs from one command (`npm run verify`, `make check`, a script), CI runs exactly that, and AGENTS.md says to run it before calling work done.
7. **Replace the prose.** Delete instructions the check now carries. Keep one line in AGENTS.md per alternative an agent needs to know about ("Time comes from useNow()").

**Tests:**
- Rewrite or delete the tests the plan listed. A new test drives the public interface with a concrete input and an expected value written as a literal; it mocks only what the project doesn't own (network, clock, third-party APIs). For pure logic with wide input (parsers, conversions, date math), one property-based test beats many hand-picked examples. Prefer no test over one that can't fail.
- Put this line in AGENTS.md: "If a test contradicts the task, stop and report the conflict. Never change an expected value, skip a test or regenerate a snapshot just to get a green build."
- If the linter can, block focused and skipped tests (`.only`, `.skip`) without a reason.

## 4. Report

Per item: what changed, the check, and the proof (the failing example and its message, the passing correct use). Then what you left alone and why.

## Running it again

Same loop, on the current code. First make sure the existing checks still run: verify still includes them, CI still runs verify, and no rule was turned off or widened. Then look for new repeated fixes, new prose rules, new hotspots. If there is nothing to do, say so in one line and change nothing.

## Never

- Never weaken, skip or delete a test or check to get a green build.
- Never ban something without its replacement.
- Never add a check the repo shows no need for.
- Never add comments to justify a rule; the error message is the explanation.
