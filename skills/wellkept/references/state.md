# .wellkept/state.json

The only state the skill keeps. Committed with the project.

```json
{
  "version": 1,
  "rules": [
    {
      "id": "no-direct-clock",
      "kind": "api",
      "message": "Read time from rememberWeatherTime() or take now as a parameter; code that reads the clock can't be tested at midnight.",
      "source": "CODING_STANDARDS.md (Time), removed there when this rule landed",
      "enforcedBy": "wellkept-check probe",
      "check": "node scripts/wellkept-check.mjs",
      "probe": {
        "pattern": "Instant\\.now\\(\\)|LocalDate\\.now\\(\\)|System\\.currentTimeMillis",
        "include": ["**/src/main/**/*.kt"],
        "exclude": ["core/ui/**/WeatherTime.kt"]
      },
      "baseline": { "widget/src/main/kotlin/dev/example/WidgetModel.kt": 2 },
      "canary": {
        "path": "feature/home/src/main/kotlin/WellkeptCanary.kt",
        "content": "fun wellkeptCanary() = java.time.Instant.now()\n"
      },
      "added": "2026-11-16"
    }
  ],
  "declined": [
    { "id": "timers-in-ingest-cli", "reason": "sleep between polite crawl requests is the point", "revisitWhen": "timers show up outside the crawler", "revisitProbe": { "pattern": "\\b(setTimeout|setInterval)\\(", "include": ["src/**"], "exclude": ["src/crawler/**"] }, "date": "2026-11-16" }
  ],
  "history": [
    { "commit": "491a005", "date": "2026-11-16", "metrics": {}, "git": {} }
  ]
}
```

Fields:
- `id`: stable kebab-case. The skill matches rules by id, so a re-run never adds a rule twice.
- `kind`: `api` | `boundary` | `pattern` | `behavior`.
- `message`: the error text an agent will read. What to do instead, and why, one sentence.
- `enforcedBy`: where the rule actually lives (detekt config, eslint rule name, Konsist test, convention script, wellkept-check probe).
- `check`: command that exits non-zero when the rule is broken. Rules enforced by the same command share it; `verify` runs each distinct command once.
- `probe` (optional): regex over lines, with globs. Present when wellkept-check enforces the rule, and also useful for native-tool rules so `measure` can track the count. Patterns are JS regex source; escape backslashes for JSON.
- `baseline`: per-file ceiling on occurrences. Only `baseline <id>` sets it, only `tighten` lowers it. Missing file = 0 allowed. A file can swap one occurrence for another under its ceiling; this is a ratchet on counts, not proof that no new code matches.
- `raised`: every `baseline <id> --raise --reason` with its date and totals. These are the rule's false positives and deliberate exceptions.
- `allow` (required for `kind: "api"`): a file with an ordinary, correct use through the sanctioned helper; it must pass `check` and, with `--aggregate`, verify. It proves the restriction leaves the right way open.
- `protected` (top level): config files whose changes `wellkept-check --against <ref>` reports as enforcement changes (linter configs, the CI workflow).
- `canary`: a file that must make `check` (or `canary.check`) fail, with output that names the canary (its path, or `canary.expect`). The check must pass without it. Its directory must exist; its path must not.
- `declined`: findings decided against, with `reason` and `revisitWhen`. Re-runs skip them until `revisitWhen` happens or the user asks. When `revisitWhen` is something code can show (a clock read, a timer outside one place, a new dependency), add `revisitProbe` (same shape as `probe`): `wellkept-check` then warns in CI once it matches, and `verify` reports the decline as due and exits 1, so a stale decision can't sit unnoticed.
- `history`: one snapshot per commit; the first is the before-snapshot (`phase: "before"` when taken with `--before`), and `report` compares it with now.
