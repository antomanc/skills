# .ratchet/state.json

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
      "enforcedBy": "ratchet-check probe",
      "check": "node scripts/ratchet-check.mjs",
      "probe": {
        "pattern": "Instant\\.now\\(\\)|LocalDate\\.now\\(\\)|System\\.currentTimeMillis",
        "include": ["**/src/main/**/*.kt"],
        "exclude": ["core/ui/**/WeatherTime.kt"]
      },
      "baseline": { "widget/src/main/kotlin/dev/example/WidgetModel.kt": 2 },
      "canary": {
        "path": "feature/home/src/main/kotlin/RatchetCanary.kt",
        "content": "fun ratchetCanary() = java.time.Instant.now()\n"
      },
      "added": "2026-11-16"
    }
  ],
  "declined": [
    { "id": "timers-in-ingest-cli", "reason": "sleep between polite crawl requests is the point", "date": "2026-11-16" }
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
- `enforcedBy`: where the rule actually lives (detekt config, eslint rule name, Konsist test, convention script, ratchet-check probe).
- `check`: command that exits non-zero when the rule is broken. Rules enforced by the same command share it; `verify` runs each distinct command once.
- `probe` (optional): regex over lines, with globs. Present when ratchet-check enforces the rule, and also useful for native-tool rules so `measure` can track the count. Patterns are JS regex source; escape backslashes for JSON.
- `baseline`: per-file allowed counts. Only `baseline <id>` sets it, only `tighten` lowers it. Missing file = 0 allowed.
- `canary`: a file that must make `check` (or `canary.check`) fail. Its directory must exist; its path must not.
- `declined`: findings the user or the skill decided against, never proposed again unless the user asks.
- `history`: one snapshot per commit; `report` compares the first with now.
