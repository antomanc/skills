export function total(lines) {
  return lines.reduce((sum, l) => sum + l.qty * l.price, 0)
}

export function withTax(amount, rate) {
  return Math.round(amount * (1 + rate) * 100) / 100
}
