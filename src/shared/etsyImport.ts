import type { EtsyKind, EtsyTarget } from './etsy'

/** What moves between the Etsy import screen and the books. */

export type EtsyMapping = Partial<Record<EtsyTarget, number | null>>

export interface EtsyAccountStatus {
  number: string
  name: string
  /** The existing account, if the chart has one with this name. */
  accountId: number | null
}

export interface EtsyFilesInput {
  statementText: string
  ordersText: string | null
}

export interface EtsyPreview {
  rows: number
  newRows: number
  alreadyImported: number
  beforeBooksStart: number
  problems: { row: number; reason: string }[]
  ordersRead: number
  /** Sales rows whose order was found in the orders file (to split out shipping). */
  salesWithOrder: number
  sales: number
  /** Totals per target for the new rows (debit positive), clearing included. */
  totals: { target: EtsyTarget; cents: number; rows: number }[]
  /** Rows Etsy worded in a way JunoBooks doesn't recognize, with examples. */
  unknown: { type: string; title: string; cents: number }[]
  kinds: { kind: EtsyKind; rows: number }[]
  days: number
  deposits: { date: string; cents: number }[]
  mapping: EtsyMapping
  depositAccountId: number | null
}

export interface EtsyImportInput extends EtsyFilesInput {
  fileName: string
  mapping: EtsyMapping
  depositAccountId: number | null
}

export interface EtsyImportResult {
  entries: number
  deposits: number
  rowsImported: number
  alreadyImported: number
  beforeBooksStart: number
}

export interface EtsyPayout {
  date: string
  cents: number
  entryId: number
  depositAccountName: string
  /** matched: tied to an imported bank line · waiting: a bank line that looks like it is waiting in review · missing: not in an imported bank file yet */
  status: 'matched' | 'waiting' | 'missing'
  bankLineDate: string | null
}
