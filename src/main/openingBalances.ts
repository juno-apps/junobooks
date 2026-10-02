import type Database from 'better-sqlite3'
import type { OpeningBalanceInput, OpeningBalancesView } from '../shared/opening'
import { LedgerError, postEntry, voidEntry } from './ledger'

/** Opening balances are one posted entry (source 'opening') dated the books start date. Each balance-sheet
 * account's amount goes on its normal side, and the difference lands in Opening balance equity, which the
 * accountant reviews. Changing them voids the old entry and posts a new one, so the history stays on record. */

export const OPENING_SOURCE = 'opening'

function currentEntryId(db: Database.Database): number | null {
  const row = db
    .prepare(`SELECT id FROM journal_entries WHERE source = ? AND status = 'posted' ORDER BY id DESC LIMIT 1`)
    .get(OPENING_SOURCE) as { id: number } | undefined
  return row?.id ?? null
}

function equityAccount(db: Database.Database): { id: number; number: string; name: string; isActive: boolean } | null {
  const row = db
    .prepare(
      `SELECT id, number, name, is_active AS isActive FROM accounts WHERE subtype = 'opening_balance' ORDER BY is_active DESC, number LIMIT 1`
    )
    .get() as { id: number; number: string; name: string; isActive: number } | undefined
  return row ? { ...row, isActive: !!row.isActive } : null
}

export function getOpeningBalances(db: Database.Database, booksStartDate: string): OpeningBalancesView {
  const entryId = currentEntryId(db)
  const amounts = new Map<number, number>()
  if (entryId !== null) {
    for (const l of db.prepare('SELECT account_id, amount_cents FROM journal_lines WHERE entry_id = ?').all(entryId) as {
      account_id: number
      amount_cents: number
    }[]) {
      amounts.set(l.account_id, (amounts.get(l.account_id) ?? 0) + l.amount_cents)
    }
  }
  const equity = equityAccount(db)
  const rows = db
    .prepare(
      `SELECT id, number, name, type, subtype, normal_balance AS normalBalance, is_active AS isActive
       FROM accounts WHERE type IN ('asset', 'liability', 'equity') AND subtype <> 'opening_balance'
       ORDER BY number`
    )
    .all() as { id: number; number: string; name: string; type: 'asset' | 'liability' | 'equity'; subtype: string; normalBalance: 'debit' | 'credit'; isActive: number }[]

  const accounts = rows
    .map((a) => {
      const raw = amounts.get(a.id) ?? 0
      return { ...a, isActive: !!a.isActive, amountCents: a.normalBalance === 'debit' ? raw : -raw }
    })
    // Inactive accounts only appear if they already hold an opening amount.
    .filter((a) => a.isActive || a.amountCents !== 0)

  return {
    date: booksStartDate,
    entryId,
    equityAccount: equity ? { number: equity.number, name: equity.name } : null,
    equityCents: equity ? -(amounts.get(equity.id) ?? 0) : 0,
    accounts
  }
}

/** Replaces the opening balances. Amounts are on each account's normal side; zero means none.
 * Returns the new entry id, or null if every amount is zero (the old entry is voided). */
export function saveOpeningBalances(
  db: Database.Database,
  booksStartDate: string,
  input: OpeningBalanceInput[]
): number | null {
  const equity = equityAccount(db)
  if (!equity) {
    throw new LedgerError(
      'Opening balances need the "Opening balance equity" account. Add it back from the chart of accounts (standard accounts not in your chart).'
    )
  }
  if (!equity.isActive) throw new LedgerError(`Turn "${equity.name}" back on (it is inactive) before saving opening balances.`)

  const accounts = new Map(
    (
      db
        .prepare(`SELECT id, name, type, subtype, normal_balance AS normalBalance FROM accounts`)
        .all() as { id: number; name: string; type: string; subtype: string; normalBalance: 'debit' | 'credit' }[]
    ).map((a) => [a.id, a])
  )

  const lines: { accountId: number; amountCents: number; memo: string }[] = []
  const seen = new Set<number>()
  for (const i of input) {
    if (!Number.isSafeInteger(i.amountCents)) throw new LedgerError('Amounts must be whole cents.')
    if (i.amountCents === 0) continue
    const a = accounts.get(i.accountId)
    if (!a) throw new LedgerError('One of the accounts no longer exists.')
    if (!['asset', 'liability', 'equity'].includes(a.type) || a.subtype === 'opening_balance') {
      throw new LedgerError(`"${a.name}" can't have an opening balance here.`)
    }
    if (seen.has(a.id)) throw new LedgerError(`"${a.name}" is listed twice.`)
    seen.add(a.id)
    lines.push({ accountId: a.id, amountCents: a.normalBalance === 'debit' ? i.amountCents : -i.amountCents, memo: '' })
  }
  const total = lines.reduce((s, l) => s + l.amountCents, 0)
  if (total !== 0) lines.push({ accountId: equity.id, amountCents: -total, memo: 'Difference (for your accountant to review)' })

  return db.transaction(() => {
    const old = currentEntryId(db)
    if (old !== null) voidEntry(db, old, 'Replaced by updated opening balances')
    if (lines.length === 0) return null
    return postEntry(db, { date: booksStartDate, memo: 'Opening balances', source: OPENING_SOURCE, lines })
  })()
}
