import { parseMoney } from './money'

/**
 * The journal entry screen's rows, and the rules that turn them into ledger
 * lines. Shared so the screen can show totals live and tests can check the
 * same code the screen uses.
 */

/** One row as typed on screen: debit and credit are raw text, at most one filled. */
export interface EntryRow {
  accountId: number | null
  debit: string
  credit: string
  memo: string
}

/** What the screen sends to be posted. Amounts are signed cents (+ debit, − credit). */
export interface ManualEntryInput {
  date: string
  memo: string
  lines: { accountId: number; amountCents: number; memo: string }[]
}

export function blankRow(): EntryRow {
  return { accountId: null, debit: '', credit: '', memo: '' }
}

function isBlank(r: EntryRow): boolean {
  return r.accountId === null && !r.debit.trim() && !r.credit.trim() && !r.memo.trim()
}

/** Cents of one amount box: 0 if empty or unreadable (errors come from rowsToLines). */
function cellCents(text: string): number {
  const c = parseMoney(text)
  return c === null || c < 0 ? 0 : c
}

/** Live totals for the screen: debits, credits and debits minus credits. */
export function rowTotals(rows: EntryRow[]): { debits: number; credits: number; difference: number } {
  const debits = rows.reduce((s, r) => s + cellCents(r.debit), 0)
  const credits = rows.reduce((s, r) => s + cellCents(r.credit), 0)
  return { debits, credits, difference: debits - credits }
}

/**
 * Checks each row and converts it to a signed-cents line. Fully blank rows are
 * skipped. Returns the first problem as a plain-English message; balance and
 * account rules are checked again by the ledger.
 */
export function rowsToLines(rows: EntryRow[]): { lines: ManualEntryInput['lines'] } | { error: string } {
  const lines: ManualEntryInput['lines'] = []
  for (const [i, r] of rows.entries()) {
    if (isBlank(r)) continue
    const n = i + 1
    const hasDebit = r.debit.trim() !== ''
    const hasCredit = r.credit.trim() !== ''
    if (r.accountId === null) return { error: `Line ${n}: choose an account.` }
    if (hasDebit && hasCredit) return { error: `Line ${n}: fill in a debit or a credit, not both.` }
    if (!hasDebit && !hasCredit) return { error: `Line ${n}: enter an amount.` }
    const cents = parseMoney(hasDebit ? r.debit : r.credit)
    if (cents === null) return { error: `Line ${n}: "${hasDebit ? r.debit : r.credit}" isn't an amount.` }
    if (cents < 0) return { error: `Line ${n}: amounts can't be negative. Use the other column instead.` }
    if (cents === 0) return { error: `Line ${n}: amount can't be zero.` }
    lines.push({ accountId: r.accountId, amountCents: hasDebit ? cents : -cents, memo: r.memo.trim() })
  }
  if (lines.length < 2) return { error: 'An entry needs at least two lines.' }
  return { lines }
}

function hasAmount(r: EntryRow): boolean {
  return r.debit.trim() !== '' || r.credit.trim() !== ''
}

/**
 * Two-line entries stay balanced: when the amount on the upper of exactly two
 * amount lines changes, and the entry balanced before the change, the lower
 * line's amount follows. Only top-to-bottom, so typing a split on line 2 never
 * overwrites line 1. `prev` is the rows before the edit, `next` after.
 */
export function mirrorPair<T extends EntryRow>(prev: T[], next: T[], i: number): T[] {
  const changed = prev[i].debit !== next[i].debit || prev[i].credit !== next[i].credit
  if (!changed || rowTotals(prev).difference !== 0) return next
  const others = next.map((r, j) => j).filter((j) => j !== i && hasAmount(next[j]))
  if (others.length !== 1 || others[0] < i) return next
  const j = others[0]
  const r = next[i]
  const o = next[j]
  const debitOnly = (x: EntryRow): boolean => x.debit.trim() !== '' && x.credit.trim() === ''
  const creditOnly = (x: EntryRow): boolean => x.credit.trim() !== '' && x.debit.trim() === ''
  let mirrored: T | null = null
  if (debitOnly(r) && creditOnly(o)) mirrored = { ...o, credit: r.debit }
  else if (creditOnly(r) && debitOnly(o)) mirrored = { ...o, debit: r.credit }
  return mirrored ? next.map((x, k) => (k === j ? mirrored! : x)) : next
}

/** One entry as the transaction list shows it. */
export interface EntryListItem {
  id: number
  date: string
  memo: string
  status: 'draft' | 'posted' | 'void'
  source: string
  /** The entry this one reverses, if it's a reversal. */
  reversesEntryId: number | null
  /** The posted entry that reverses this one, if any. */
  reversedById: number | null
  voidReason: string | null
  /** Total of the debit side. */
  amountCents: number
  /** Receipts attached (not removed). */
  receiptCount: number
  lines: { accountId: number; accountNumber: string; accountName: string; amountCents: number; memo: string }[]
}
