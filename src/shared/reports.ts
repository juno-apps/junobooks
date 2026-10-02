import type { AccountType } from './taxLines'

/** Report shapes shared by the main process and the Reports screen. Amounts are cents; in profit & loss and the
 * balance sheet they are on each section's natural side (income, liabilities and equity positive when credit). */

export interface ReportRow {
  accountId: number
  number: string
  name: string
  /** One value per column. */
  values: number[]
  /** Sub-accounts nest under their parent (filled in when sub-accounts are used). */
  depth: number
  parentId: number | null
}

export interface ReportSection {
  title: string
  rows: ReportRow[]
  total: number[]
}

export interface ProfitAndLoss {
  from: string
  to: string
  /** "Total", or one label per month plus "Total". */
  columns: string[]
  income: ReportSection
  cogs: ReportSection
  grossProfit: number[]
  expenses: ReportSection
  netIncome: number[]
}

export interface BalanceSheet {
  asOf: string
  assets: ReportSection
  liabilities: ReportSection
  equity: ReportSection
  /** Profit since January 1 of the as-of year (not yet closed into equity). */
  currentYearProfit: number
  /** Profit from earlier years not yet closed into equity by a year-end close. */
  priorYearsProfit: number
  totalLiabilitiesAndEquity: number
  /** Assets equal liabilities + equity + profit. */
  balanced: boolean
}

export interface TrialBalanceRow {
  accountId: number
  number: string
  name: string
  type: AccountType
  debit: number
  credit: number
}

export interface TrialBalance {
  asOf: string
  rows: TrialBalanceRow[]
  totalDebit: number
  totalCredit: number
}

export interface LedgerAccount {
  accountId: number
  number: string
  name: string
  normalBalance: 'debit' | 'credit'
  opening: number
  closing: number
  lines: {
    date: string
    entryId: number
    memo: string
    otherSide: string
    debit: number
    credit: number
    balance: number
  }[]
}

export interface GeneralLedger {
  from: string
  to: string
  accounts: LedgerAccount[]
}

/** Quotes a CSV cell when needed. */
export function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Cents as a plain number for spreadsheets: 123456 → "1234.56", -5 → "-0.05". */
export function plainCents(c: number): string {
  const sign = c < 0 ? '-' : ''
  const a = Math.abs(c)
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
}
