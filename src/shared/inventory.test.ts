import { describe, expect, it } from 'vitest'
import { formatQuantity, itemYear, methodYear, onHand, parseQuantity, scaleCents, type ItemFacts } from './inventory'

let nextId = 1
const buy = (date: string, qty: number, dollars: number, isOpening = false) => ({
  id: nextId++,
  itemId: 1,
  date,
  quantityMilli: qty * 1000,
  costCents: dollars * 100,
  isOpening,
  memo: ''
})
const count = (date: string, qty: number) => ({ itemId: 1, date, quantityMilli: qty * 1000 })

const silver: ItemFacts = {
  purchases: [
    buy('2026-01-01', 100, 200, true),
    buy('2026-03-01', 50, 150),
    buy('2026-06-01', 50, 200),
    buy('2027-02-01', 100, 500)
  ],
  counts: [count('2026-12-31', 80), count('2027-12-31', 60)]
}

describe('quantities and rounding', () => {
  it('parses and formats thousandths', () => {
    expect(parseQuantity('12.5')).toBe(12500)
    expect(parseQuantity('1,000')).toBe(1000000)
    expect(parseQuantity('0.125')).toBe(125)
    expect(parseQuantity('1.2345')).toBeNull()
    expect(parseQuantity('-1')).toBeNull()
    expect(formatQuantity(12500)).toBe('12.5')
    expect(formatQuantity(1000000)).toBe('1,000')
    expect(formatQuantity(125)).toBe('0.125')
  })

  it('scales cents exactly, rounding half away from zero', () => {
    expect(scaleCents(100, 1, 3)).toBe(33)
    expect(scaleCents(100, 2, 3)).toBe(67)
    expect(scaleCents(5, 1, 2)).toBe(3)
    expect(scaleCents(-5, 1, 2)).toBe(-3)
    expect(scaleCents(999_999_999_99, 999_999_999, 1_000_000_000)).toBe(99_999_999_899)
  })
})

describe('on hand', () => {
  it('uses the latest count plus purchases after it', () => {
    expect(onHand(silver, '2026-12-31')).toEqual({ quantityMilli: 80000, countDate: '2026-12-31', countedOnDate: true })
    expect(onHand(silver, '2027-03-01')).toEqual({
      quantityMilli: 180000,
      countDate: '2026-12-31',
      countedOnDate: false
    })
    expect(onHand(silver, '2026-06-30').quantityMilli).toBe(200000) // never counted yet: all bought
  })
})

describe('the four methods over the same facts', () => {
  const y = (m: Parameters<typeof itemYear>[1], year: number) => itemYear(silver, m, year, 2026)

  it('first year', () => {
    expect(y('fifo', 2026)).toMatchObject({
      beginCents: 20000,
      purchasesCents: 35000,
      endCents: 29000,
      cogsCents: 26000,
      notCounted: false
    })
    expect(y('periodic', 2026)).toMatchObject({ endCents: 32000, cogsCents: 23000 })
    expect(y('average', 2026)).toMatchObject({ endCents: 22000, cogsCents: 33000 })
    expect(y('expensed', 2026)).toMatchObject({ beginCents: 0, purchasesCents: 35000, endCents: 0, cogsCents: 35000 })
  })

  it('second year starts from the first year’s ending value under the same method', () => {
    expect(y('fifo', 2027)).toMatchObject({
      beginCents: 29000,
      purchasesCents: 50000,
      endCents: 30000,
      cogsCents: 49000
    })
    expect(y('average', 2027)).toMatchObject({ beginCents: 22000, endCents: 24000, cogsCents: 48000 })
    expect(y('periodic', 2027)).toMatchObject({ beginCents: 32000, endCents: 30000, cogsCents: 52000 })
    expect(y('expensed', 2027)).toMatchObject({ cogsCents: 50000 })
  })

  it('over two years every method expenses the same total once inventory is used up the same way', () => {
    // Total cost in = 200 + 350 + 500 = 1050. Ending values differ, so COGS + ending is what's equal.
    for (const m of ['fifo', 'periodic', 'average', 'expensed'] as const) {
      expect(y(m, 2026).cogsCents + y(m, 2027).cogsCents + y(m, 2027).endCents).toBe(m === 'expensed' ? 85000 : 105000)
    }
  })

  it('flags items not counted at year end and sums items per method', () => {
    const beads: ItemFacts = { purchases: [{ ...buy('2026-03-03', 10, 5), itemId: 2 }], counts: [] }
    const facts = new Map([
      [1, silver],
      [2, beads]
    ])
    const s = methodYear(facts, 'fifo', 2026, 2026)
    expect(s.endCents).toBe(29000 + 500)
    expect(s.items.find((i) => i.itemId === 2)!.notCounted).toBe(true)
  })
})
