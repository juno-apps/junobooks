import type Database from 'better-sqlite3'
import { localDateString } from '../shared/dates'
import type { EntityTypeId } from '../shared/entities'
import { CLOSING_SOURCE, type ClosingView, type YearCloseInfo } from '../shared/closing'
import { accountantNotes } from './accountantNotes'
import { getLockedThrough, LedgerError, postEntry, setLockedThrough, voidEntry } from './ledger'

/** The books-closed date and year-end closing entries. */

export function closingView(db: Database.Database): ClosingView {
  const history = db
    .prepare(
      'SELECT locked_through AS lockedThrough, reason, created_at AS createdAt FROM period_lock_history ORDER BY id DESC'
    )
    .all() as ClosingView['history']
  const closings = db
    .prepare(
      `SELECT CAST(substr(e.entry_date, 1, 4) AS INTEGER) AS year, e.id AS entryId,
         (SELECT a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.entry_id = e.id AND a.type = 'equity' LIMIT 1) AS equityAccount,
         -(SELECT COALESCE(SUM(l.amount_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
           WHERE l.entry_id = e.id AND a.type = 'equity') AS netIncomeCents
       FROM journal_entries e WHERE e.source = ? AND e.status = 'posted' ORDER BY e.entry_date DESC`
    )
    .all(CLOSING_SOURCE) as ClosingView['closings']
  return { lockedThrough: getLockedThrough(db), history, closings }
}

/** Closes the books through a date (nothing on or before it can change) or reopens them (needs a reason). */
export function setBooksClosed(
  db: Database.Database,
  date: string | null,
  reason: string,
  today = localDateString()
): void {
  if (date !== null && date > today) throw new LedgerError("You can't close a period that hasn't ended yet.")
  setLockedThrough(db, date, reason)
}

function existingClosing(db: Database.Database, year: number): number | null {
  const r = db
    .prepare(
      `SELECT id FROM journal_entries WHERE source = ? AND status = 'posted' AND entry_date = ? ORDER BY id DESC LIMIT 1`
    )
    .get(CLOSING_SOURCE, `${year}-12-31`) as { id: number } | undefined
  return r?.id ?? null
}

/** Income and expense balances for the year, closing entries left out (debit-positive). */
function yearBalances(db: Database.Database, year: number): { id: number; c: number }[] {
  return db
    .prepare(
      `SELECT a.id, SUM(l.amount_cents) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
       WHERE e.status = 'posted' AND e.source <> ? AND e.entry_date BETWEEN ? AND ? AND a.type IN ('income', 'expense')
       GROUP BY a.id HAVING c <> 0`
    )
    .all(CLOSING_SOURCE, `${year}-01-01`, `${year}-12-31`) as { id: number; c: number }[]
}

export function defaultClosingEquity(db: Database.Database, entity: EntityTypeId): number | null {
  const category =
    entity === 'sole_prop' || entity === 'smllc'
      ? 'owner_equity'
      : entity === 'mmllc' || entity === 'partnership'
        ? 'partners_capital'
        : 'retained_earnings'
  const r = db
    .prepare(
      `SELECT id FROM accounts WHERE type = 'equity' AND is_active = 1 AND tax_category = ? AND subtype <> 'owner_draw'
       ORDER BY number LIMIT 1`
    )
    .get(category) as { id: number } | undefined
  return r?.id ?? null
}

export function yearCloseInfo(
  db: Database.Database,
  year: number,
  entity: EntityTypeId,
  booksStart: string,
  today = localDateString()
): YearCloseInfo {
  const net = -yearBalances(db, year).reduce((s, r) => s + r.c, 0)
  return {
    year,
    netIncomeCents: net,
    defaultEquityAccountId: defaultClosingEquity(db, entity),
    existingEntryId: existingClosing(db, year),
    checks: accountantNotes(db, year, booksStart).filter(
      (n) => n.kind === 'check' && !n.text.startsWith("The books aren't closed")
    ).length,
    ended: `${year}-12-31` < today
  }
}

/** Posts (or redoes) the year's closing entry, moving income and expenses into the equity account, then closes the
 * books through Dec 31. Returns the entry id (null if there was nothing to close). */
export function closeYear(
  db: Database.Database,
  year: number,
  equityAccountId: number,
  booksStart: string,
  today = localDateString()
): number | null {
  const end = `${year}-12-31`
  if (end >= today) throw new LedgerError(`${year} hasn't ended yet, so it can't be closed.`)
  if (end < booksStart) throw new LedgerError(`Your books start on ${booksStart}.`)
  const eq = db.prepare('SELECT type, is_active, subtype FROM accounts WHERE id = ?').get(equityAccountId) as
    { type: string; is_active: number; subtype: string } | undefined
  if (!eq || eq.type !== 'equity' || !eq.is_active || eq.subtype === 'opening_balance') {
    throw new LedgerError('Choose an active equity account (not Opening balance equity) to close the year into.')
  }
  const locked = getLockedThrough(db)
  if (locked && locked >= end)
    throw new LedgerError(`The books are closed through ${locked}. Reopen ${year} first to redo its closing.`)
  return db.transaction(() => {
    const old = existingClosing(db, year)
    if (old) voidEntry(db, old, `Replaced by a new ${year} closing entry`)
    const balances = yearBalances(db, year)
    let entryId: number | null = null
    if (balances.length) {
      const net = balances.reduce((s, r) => s + r.c, 0)
      const lines = balances.map((r) => ({ accountId: r.id, amountCents: -r.c, memo: '' }))
      if (net)
        lines.push({
          accountId: equityAccountId,
          amountCents: net,
          memo: net < 0 ? `Net income ${year}` : `Net loss ${year}`
        })
      entryId = postEntry(db, {
        date: end,
        memo: `Year-end close ${year}: income and expenses moved to equity`,
        source: CLOSING_SOURCE,
        lines
      })
    }
    if (!locked || locked < end) setLockedThrough(db, end)
    return entryId
  })()
}
