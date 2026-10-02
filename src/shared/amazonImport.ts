import type { AmazonTarget } from './amazon'

/** What moves between the Amazon import screen and the books. */

export type AmazonMapping = Partial<Record<AmazonTarget, number | null>>

export interface AmazonPreview {
  settlementId: string
  startDate: string | null
  endDate: string | null
  rows: number
  newRows: number
  alreadyImported: number
  beforeBooksStart: number
  problems: { row: number; reason: string }[]
  totals: { target: AmazonTarget; cents: number; rows: number }[]
  unknown: { transactionType: string; amountType: string; description: string; cents: number }[]
  /** Reserve movements (left in the Amazon payment account). */
  reserveCents: number
  days: number
  deposit: { date: string; cents: number } | null
  /** The payout was already imported with an earlier copy of this settlement. */
  depositAlreadyImported: boolean
  /** The settlement pays out a negative amount (you owe Amazon). */
  negativeTotalCents: number
  mapping: AmazonMapping
  depositAccountId: number | null
}

export interface AmazonImportInput {
  text: string
  fileName: string
  mapping: AmazonMapping
  depositAccountId: number | null
}

export interface AmazonImportResult {
  entries: number
  deposits: number
  rowsImported: number
  alreadyImported: number
  beforeBooksStart: number
}
