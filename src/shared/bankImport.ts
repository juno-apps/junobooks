import type { ChartAccount } from './chart'
import type { ColumnMapping } from './csvImport'
import type { AccountGroup } from './everyday'

/** Bank and card imports: what moves between the import screens and the books. */

export interface ImportFile {
  fileName: string
  text: string
}

export interface StageImportInput {
  accountId: number
  fileName: string
  text: string
  mapping: ColumnMapping
}

export interface StageImportResult {
  batchId: number
  added: number
  /** Lines already imported before (e.g. overlapping downloads). */
  duplicates: number
  /** Rows that couldn't be read. */
  problems: { row: number; reason: string }[]
  /** Lines dated before the books start (left out). */
  early: number
}

export type BankLineStatus = 'new' | 'posted' | 'matched' | 'ignored'

export interface BankLine {
  id: number
  batchId: number
  accountId: number
  date: string
  description: string
  /** Debit-side change on the imported account: bank money in / card payment positive. */
  amountCents: number
  status: BankLineStatus
  entryId: number | null
  /** The entry it was posted to or matched with was later voided, so it needs another look. */
  entryVoided: boolean
  /** Entries already in the books that look like this line (same account and amount, within MATCH_DAYS), closest date first. */
  matches: MatchCandidate[]
  /** Suggested from a categorization rule. */
  suggestion: { accountId: number; payee: string; ruleId: number; matchText: string } | null
}

export interface MatchCandidate {
  entryId: number
  date: string
  memo: string
  /** The entry's other account(s), e.g. "Materials" or "Split (2 accounts)". */
  otherSide: string
  source: string
}

/** How far apart (in days) an imported line and an entry may be dated and still be suggested as the same thing. */
export const MATCH_DAYS = 10

export interface PostBankLineInput {
  lineId: number
  /** The other side: an expense, income, or another bank/card account for transfers. */
  accountId: number
  /** Entry memo; blank uses the bank description. */
  memo: string
}

export interface PostBankLinesResult {
  posted: { lineId: number; entryId: number }[]
  failed: { lineId: number; error: string }[]
}

export interface ImportBatchSummary {
  id: number
  accountId: number
  accountName: string
  fileName: string
  importedAt: string
  added: number
  duplicates: number
  waiting: number
}

const nonEmpty = (groups: AccountGroup[]): AccountGroup[] => groups.filter((g) => g.accounts.length > 0)

/** Accounts a bank or card file can be imported into. */
export function importAccountGroups(accounts: ChartAccount[]): AccountGroup[] {
  const active = accounts.filter((a) => a.isActive)
  const cash = active.filter((a) => a.type === 'asset' && a.taxCategory === 'cash')
  const cards = active.filter((a) => a.subtype === 'credit_card')
  const shown = new Set([...cash, ...cards].map((a) => a.id))
  const other = active.filter(
    (a) =>
      !shown.has(a.id) &&
      (a.type === 'asset' || a.type === 'liability') &&
      !['inventory', 'fixed_asset', 'contra', 'sales_tax'].includes(a.subtype)
  )
  return nonEmpty([
    { title: 'Bank and cash', accounts: cash },
    { title: 'Credit cards', accounts: cards },
    { title: 'Other accounts (e.g. PayPal, a loan)', accounts: other }
  ])
}

/** The "other side" choices for an imported line: money out lists expenses first, money in lists income first.
 * Bank, card and loan accounts are offered as transfers (e.g. paying the card from checking). */
export function lineCategoryGroups(
  accounts: ChartAccount[],
  importAccountId: number,
  amountCents: number
): AccountGroup[] {
  const active = accounts.filter((a) => a.isActive && a.id !== importAccountId && a.subtype !== 'opening_balance')
  const expenses = active.filter((a) => a.type === 'expense' && a.subtype !== 'cogs')
  const cogs = active.filter((a) => a.type === 'expense' && a.subtype === 'cogs')
  const income = active.filter((a) => a.type === 'income')
  const transfer = active.filter(
    (a) =>
      (a.type === 'asset' && a.taxCategory === 'cash') ||
      a.subtype === 'credit_card' ||
      a.taxCategory === 'long_term_loans'
  )
  const used = new Set([...expenses, ...cogs, ...income, ...transfer].map((a) => a.id))
  const other = active.filter((a) => !used.has(a.id))
  const out = [
    { title: 'Expenses', accounts: expenses },
    { title: 'Cost of goods sold', accounts: cogs },
    { title: 'Transfers and payments (your other accounts)', accounts: transfer },
    { title: 'Income (refunds and other money in)', accounts: income },
    { title: 'Other accounts', accounts: other }
  ]
  const into = [
    { title: 'Income', accounts: income },
    { title: 'Transfers and payments (your other accounts)', accounts: transfer },
    { title: 'Expenses (refunds of spending)', accounts: expenses },
    { title: 'Cost of goods sold', accounts: cogs },
    { title: 'Other accounts', accounts: other }
  ]
  return nonEmpty(amountCents < 0 ? out : into)
}

/** Column words that fit the imported account: "Money in/out" for a bank, "Payments/Charges" for a card. */
export function inOutWords(a: { type: string; subtype: string } | undefined): { in: string; out: string } {
  if (a?.subtype === 'credit_card') return { in: 'Payments & refunds', out: 'Charges' }
  if (a?.type === 'liability') return { in: 'Paid down', out: 'Borrowed' }
  return { in: 'Money in', out: 'Money out' }
}
