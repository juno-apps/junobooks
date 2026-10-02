import type { InventoryItem, InventoryMethod, InventoryPurchase, MethodSummary } from './inventory'

/** What moves between the Inventory screen and the books. */

export interface ItemInput {
  name: string
  unit: string
  notes: string
}

export interface PurchaseInput {
  itemId: number
  date: string
  quantityMilli: number
  costCents: number
  isOpening: boolean
  memo: string
}

export interface CountSheet {
  date: string
  rows: {
    itemId: number
    name: string
    unit: string
    /** Counted on this date, if entered. */
    quantityMilli: number | null
    /** What earlier counts plus purchases since suggest should be there (null if nothing known). */
    expectedMilli: number | null
  }[]
}

export interface InventoryOverview {
  items: InventoryItem[]
  purchases: InventoryPurchase[]
  counts: { date: string; items: number }[]
  firstYear: number
}

export interface InventoryYearReport {
  year: number
  firstYear: number
  filed: InventoryMethod | null
  methods: MethodSummary[]
  /** Items whose year-end quantity isn't from a count on December 31. */
  notCounted: string[]
  history: { year: number; method: InventoryMethod | null; reason: string; createdAt: string }[]
  /** Purchases recorded on the Inventory screen this year vs. cost of goods sold and inventory accounts in the books. */
  check: { inventoryPurchasesCents: number; booksPurchasesCents: number }
  /** The posted year-end adjustment, if any. */
  adjustment: { entryId: number; method: InventoryMethod; valueCents: number; asOf: string } | null
  /** The inventory account(s) balance in the books at year end. */
  inventoryBalanceCents: number
}
