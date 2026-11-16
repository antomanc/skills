// Fails on console.* in src/ unless the line before says lint-disable no-console.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let failed = 0
for (const f of readdirSync('src')) {
  if (!f.endsWith('.js')) continue
  const lines = readFileSync(join('src', f), 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (/\bconsole\./.test(line) && !/lint-disable no-console/.test(lines[i - 1] ?? '')) {
      console.error(`src/${f}:${i + 1}: no-console: use the logger in src/log.js`)
      failed++
    }
  })
}
process.exit(failed ? 1 : 0)
