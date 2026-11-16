import { test } from 'node:test'
import assert from 'node:assert/strict'
import { total, withTax } from '../src/totals.js'

test('total sums qty times price', () => {
  assert.equal(total([{ qty: 2, price: 3 }, { qty: 1, price: 4 }]), 10)
})

test('withTax rounds to cents', () => {
  assert.equal(withTax(10, 0.22), 12.2)
})
