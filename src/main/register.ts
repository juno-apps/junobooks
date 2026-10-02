import type Database from 'better-sqlite3'
import { isValidDate } from '../shared/dates'
import type { RegisterQuery, RegisterRow, RegisterView } from '../shared/register'
import { LedgerError } from './ledger'

/** An account's register: its lines in date order with a running balance on the account's normal side.
 * Read-only. Only posted entries count toward balances; voided ones can be listed for reference. */
export function accountRegister(db: Database.Database, q: RegisterQuery): RegisterView {
  const from = q.from || null
  const to = q.to || null
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) throw new LedgerError('Enter a valid date.')
  if (from && to && from > to) throw new LedgerError('The "from" date is after the "to" date.')

  const a = db
    .prepare(
      `SELECT id, number, name, type, subtype, normal_balance AS normalBalance, is_active AS isActive
       FROM accounts WHERE id = ?`
    )
    .get(q.accountId) as (Omit<RegisterView['account'], 'isActive'> & { isActive: number }) | undefined
  if (!a) throw new LedgerError('That account no longer exists.')
  const sign = a.normalBalance === 'debit' ? 1 : -1

  const opening = from
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(l.amount_cents), 0) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           WHERE l.account_id = ? AND e.status = 'posted' AND e.entry_date < ?`
        )
        .get(a.id, from) as { c: number }).c * sign
    : 0

  const lines = db
    .prepare(
      `SELECT l.entry_id AS entryId, l.line_no AS lineNo, l.amount_cents AS amount, l.memo AS lineMemo,
              e.entry_date AS date, e.memo, e.status, e.source
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_id = @id AND e.status IN ('posted', 'void')
         AND (@from IS NULL OR e.entry_date >= @from) AND (@to IS NULL OR e.entry_date <= @to)
         AND (@voided = 1 OR e.status = 'posted')
       ORDER BY e.entry_date, e.id, l.line_no`
    )
    .all({ id: a.id, from, to, voided: q.includeVoided ? 1 : 0 }) as {
    entryId: number
    lineNo: number
    amount: number
    lineMemo: string
    date: string
    memo: string
    status: 'posted' | 'void'
    source: string
  }[]

  // The other accounts in each entry, for the "other side" column.
  const others = db.prepare(
    `SELECT DISTINCT a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id
     WHERE l.entry_id = ? AND l.account_id <> ? ORDER BY l.line_no`
  )

  let balance = opening
  const rows: RegisterRow[] = lines.map((l) => {
    const names = (others.all(l.entryId, a.id) as { name: string }[]).map((r) => r.name)
    const normal = l.amount * sign
    if (l.status === 'posted') balance += normal
    return {
      entryId: l.entryId,
      date: l.date,
      memo: l.memo,
      lineMemo: l.lineMemo,
      otherSide: names.length === 0 ? '(same account)' : names.length === 1 ? names[0] : `Split (${names.length} accounts)`,
      increaseCents: normal > 0 ? normal : 0,
      decreaseCents: normal < 0 ? -normal : 0,
      balanceCents: balance,
      status: l.status,
      source: l.source
    }
  })

  return { account: { ...a, isActive: !!a.isActive }, from, to, openingCents: opening, closingCents: balance, rows }
}
