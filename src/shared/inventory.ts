/**
 * Inventory (plan §6): facts are material purchases (item, quantity, cost) and physical counts. The four
 * methods are reports over the same facts; switching never changes them. Quantities are whole thousandths
 * ("milli") so 12.5 grams is 12500; money is cents. Pure code, shared by the screen and the main process.
 */

export type InventoryMethod = 'periodic' | 'fifo' | 'average' | 'expensed'

export const INVENTORY_METHODS: { id: InventoryMethod; label: string; hint: string }[] = [
  {
    id: 'periodic',
    label: 'Periodic count (latest cost)',
    hint: 'Count what is on hand; value it at the most recent price paid. Cost of goods sold = beginning + purchases − ending.'
  },
  {
    id: 'fifo',
    label: 'FIFO (first in, first out)',
    hint: 'What is left on hand is assumed to be what you bought most recently.'
  },
  {
    id: 'average',
    label: 'Weighted average',
    hint: 'Everything on hand is valued at the average price paid this year (including what you started the year with).'
  },
  {
    id: 'expensed',
    label: 'Expense as purchased',
    hint: 'Materials count as cost of goods sold when bought, so no inventory is carried on the balance sheet (small-business materials treatment).'
  }
]

export const methodLabel = (m: InventoryMethod): string => INVENTORY_METHODS.find((x) => x.id === m)!.label

export interface InventoryItem {
  id: number
  name: string
  unit: string
  notes: string
  isActive: boolean
}

export interface InventoryPurchase {
  id: number
  itemId: number
  date: string
  quantityMilli: number
  costCents: number
  /** Stock on hand when the books start (beginning inventory), not a purchase in the year. */
  isOpening: boolean
  memo: string
}

export interface InventoryCountRow {
  itemId: number
  date: string
  quantityMilli: number
}

export const COMMON_UNITS = ['g', 'dwt', 'ozt', 'oz', 'ct', 'each', 'ft', 'in', 'pair', 'strand']

/** "12.5" → 12500, "1,000" → 1000000; up to three decimals; null if not a positive-or-zero amount. */
export function parseQuantity(text: string): number | null {
  const t = text.trim().replace(/,/g, '')
  const m = /^(\d*)(?:\.(\d{1,3}))?$/.exec(t)
  if (!m || (m[1] === '' && m[2] === undefined)) return null
  const v = Number(m[1] || '0') * 1000 + Number((m[2] ?? '').padEnd(3, '0'))
  return Number.isSafeInteger(v) ? v : null
}

/** 12500 → "12.5", 1000 → "1". */
export function formatQuantity(milli: number): string {
  const sign = milli < 0 ? '-' : ''
  const a = Math.abs(milli)
  const whole = Math.floor(a / 1000)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = String(a % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${sign}${whole}${frac ? `.${frac}` : ''}`
}

/** cents × (a / b), rounded half away from zero, without floating-point error. */
export function scaleCents(cents: number, a: number, b: number): number {
  if (b === 0) return 0
  const num = BigInt(cents) * BigInt(a)
  const den = BigInt(b)
  const q = num / den
  const r = num % den
  const twice = (r < 0n ? -r : r) * 2n
  const away = twice >= (den < 0n ? -den : den) ? (num < 0n !== den < 0n ? -1n : 1n) : 0n
  return Number(q + away)
}

export interface ItemFacts {
  purchases: InventoryPurchase[]
  counts: InventoryCountRow[]
}

export interface OnHand {
  quantityMilli: number
  /** The count the quantity is based on, if any. */
  countDate: string | null
  /** True when there is a count on exactly this date. */
  countedOnDate: boolean
}

/** Quantity on hand at the end of `date`: the latest count on or before it, plus purchases after that count.
 * With no count at all, everything bought is assumed to be still on hand. */
export function onHand(f: ItemFacts, date: string): OnHand {
  const count = f.counts.filter((c) => c.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0]
  const from = count?.date ?? ''
  const added = f.purchases.filter((p) => p.date > from && p.date <= date).reduce((s, p) => s + p.quantityMilli, 0)
  return {
    quantityMilli: (count?.quantityMilli ?? 0) + added,
    countDate: count?.date ?? null,
    countedOnDate: count?.date === date
  }
}

const byDate = (a: InventoryPurchase, b: InventoryPurchase): number => a.date.localeCompare(b.date) || a.id - b.id

export interface YearFigures {
  beginCents: number
  purchasesCents: number
  endCents: number
  cogsCents: number
  endQuantityMilli: number
  /** The year-end quantity isn't from a count on the last day of the year. */
  notCounted: boolean
}

/** Value of `qty` on hand at `date` under FIFO: the most recent purchases are what's left. Any quantity beyond what was
 * ever bought is valued at the latest price. */
function fifoValue(purchases: InventoryPurchase[], qty: number): number {
  let left = qty
  let value = 0
  const newestFirst = [...purchases].sort(byDate).reverse()
  for (const p of newestFirst) {
    if (left <= 0) break
    const take = Math.min(left, p.quantityMilli)
    value += scaleCents(p.costCents, take, p.quantityMilli)
    left -= take
  }
  if (left > 0 && newestFirst[0]) value += scaleCents(newestFirst[0].costCents, left, newestFirst[0].quantityMilli)
  return value
}

function latestCostValue(purchases: InventoryPurchase[], qty: number): number {
  const latest = [...purchases].sort(byDate).pop()
  return latest ? scaleCents(latest.costCents, qty, latest.quantityMilli) : 0
}

/**
 * One item's figures for a calendar year under a method. The first year starts from the item's opening stock;
 * later years start from the previous year's ending value under the same method.
 */
export function itemYear(f: ItemFacts, method: InventoryMethod, year: number, firstYear: number): YearFigures {
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const upToEnd = f.purchases.filter((p) => p.date <= end)
  const inYear = f.purchases.filter((p) => p.date >= start && p.date <= end && !p.isOpening)
  const purchasesCents = inYear.reduce((s, p) => s + p.costCents, 0)
  const purchasesQty = inYear.reduce((s, p) => s + p.quantityMilli, 0)
  const hand = onHand(f, end)

  let beginCents: number
  let beginQty: number
  if (year <= firstYear) {
    const opening = f.purchases.filter((p) => p.isOpening && p.date <= end)
    beginCents = method === 'expensed' ? 0 : opening.reduce((s, p) => s + p.costCents, 0)
    beginQty = opening.reduce((s, p) => s + p.quantityMilli, 0)
  } else {
    const prev = itemYear(f, method, year - 1, firstYear)
    beginCents = prev.endCents
    beginQty = prev.endQuantityMilli
  }

  let endCents: number
  switch (method) {
    case 'expensed':
      endCents = 0
      break
    case 'fifo':
      endCents = fifoValue(upToEnd, hand.quantityMilli)
      break
    case 'periodic':
      endCents = latestCostValue(upToEnd, hand.quantityMilli)
      break
    case 'average': {
      const totalQty = beginQty + purchasesQty
      const totalCost = beginCents + purchasesCents
      endCents =
        totalQty > 0
          ? scaleCents(totalCost, hand.quantityMilli, totalQty)
          : latestCostValue(upToEnd, hand.quantityMilli)
      break
    }
  }
  return {
    beginCents,
    purchasesCents,
    endCents,
    cogsCents: beginCents + purchasesCents - endCents,
    endQuantityMilli: hand.quantityMilli,
    notCounted: !hand.countedOnDate
  }
}

export interface MethodSummary extends Omit<YearFigures, 'endQuantityMilli' | 'notCounted'> {
  method: InventoryMethod
  items: ({ itemId: number } & YearFigures)[]
}

/** All items under one method for a year. */
export function methodYear(
  facts: Map<number, ItemFacts>,
  method: InventoryMethod,
  year: number,
  firstYear: number
): MethodSummary {
  const items = [...facts].map(([itemId, f]) => ({ itemId, ...itemYear(f, method, year, firstYear) }))
  const sum = (k: 'beginCents' | 'purchasesCents' | 'endCents' | 'cogsCents'): number =>
    items.reduce((s, i) => s + i[k], 0)
  return {
    method,
    beginCents: sum('beginCents'),
    purchasesCents: sum('purchasesCents'),
    endCents: sum('endCents'),
    cogsCents: sum('cogsCents'),
    items
  }
}
