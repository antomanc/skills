#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { total, withTax } from './totals.js'
import { log } from './log.js'

const [file, rate = '0.22'] = process.argv.slice(2)
if (!file) {
  log('usage: invoice <lines.json> [tax rate]')
  process.exit(2)
}
const lines = JSON.parse(readFileSync(file, 'utf8'))
const net = total(lines)
// lint-disable no-console -- needed
console.log(JSON.stringify({ net, gross: withTax(net, Number(rate)) }))
