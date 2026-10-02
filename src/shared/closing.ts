/** Closing the books: the lock date, its history, and year-end closing entries. */

export const CLOSING_SOURCE = 'closing'

export interface ClosingView {
  lockedThrough: string | null
  history: { lockedThrough: string | null; reason: string; createdAt: string }[]
  /** Year-end closing entries posted (not voided). */
  closings: { year: number; entryId: number; equityAccount: string; netIncomeCents: number }[]
}

export interface YearCloseInfo {
  year: number
  /** Net income for the year, closing entries left out. */
  netIncomeCents: number
  /** Equity account suggested for this entity type. */
  defaultEquityAccountId: number | null
  /** A closing entry already posted for the year. */
  existingEntryId: number | null
  /** Things to check from the notes for the accountant. */
  checks: number
  /** The year has ended (Dec 31 is in the past). */
  ended: boolean
}
