import { describe, expect, it } from 'vitest'
import { formatCents, MAX_CENTS, parseMoney } from './money'

describe('parseMoney', () => {
  it.each([
    ['12.34', 1234],
    ['12', 1200],
    ['12.5', 1250],
    ['.25', 25],
    ['$1,234.56', 123456],
    ['1234567.89', 123456789],
    ['-0.01', -1],
    ['-$40', -4000],
    ['  7.00 ', 700],
    ['0.10', 10],
    ['-0', 0]
  ])('%s → %i cents', (input, cents) => {
    expect(parseMoney(input)).toBe(cents)
  })

  it.each(['', '.', '$', 'abc', '12.345', '1,23', '1e5', '12.3.4', '--5', '$-5', '0x10'])('rejects %j', (input) => {
    expect(parseMoney(input)).toBeNull()
  })

  it('handles amounts where float math would drift', () => {
    expect(parseMoney('0.29')).toBe(29) // 0.29 * 100 = 28.999999999999996 in floats
    expect(parseMoney('1.15')).toBe(115)
  })

  it('rejects amounts over the maximum', () => {
    expect(parseMoney(String(MAX_CENTS / 100))).toBe(MAX_CENTS)
    expect(parseMoney(String(MAX_CENTS / 100 + 1))).toBeNull()
  })
})

describe('formatCents', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [1234, '$12.34'],
    [123456789, '$1,234,567.89'],
    [-123456, '-$1,234.56']
  ])('%i → %s', (cents, text) => {
    expect(formatCents(cents)).toBe(text)
  })
})
