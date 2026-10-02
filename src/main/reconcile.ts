import type Database from 'better-sqlite3'
import { isValidDate } from '../shared/dates'
import { formatCents } from '../shared/money'
import type { ReconcileLine, ReconcileView, ReconciliationSummary } from '../shared/reconcile'
import { LedgerError } from './ledger'

/** Cleared status (line_clearing) and reconciliations of a bank or card account against its statement.
 * In the database amounts are debit-side; this module converts to the account's normal side for the screen. */

interface AccountRow {
  id: number
  number: string
  name: string
  type: string
  subtype: string
  normalBalance: 'debit' | 'credit'
  isActive: number
}

function account(db: Database.Database, id: number): AccountRow {
  const a = db
    .prepare(
      'SELECT id, number, name, type, subtype, normal_balance AS normalBalance, is_active AS isActive FROM accounts WHERE id = ?'
    )
    .get(id) as AccountRow | undefined
  if (!a) throw new LedgerError('That account no longer exists.')
  if (a.type !== 'asset' && a.type !== 'liability')
    throw new LedgerError('Only bank, cash, card and loan accounts are reconciled.')
  return a
}

const sign = (a: AccountRow): number => (a.normalBalance === 'debit' ? 1 : -1)

const SUMMARY = `SELECT id, statement_date AS statementDate, statement_balance_cents AS statementBalanceCents, status,
  finished_at AS finishedAt, undo_reason AS undoReason FROM reconciliations`

function summary(row: ReconciliationSummary | undefined, s: number): ReconciliationSummary | null {
  return row ? { ...row, statementBalanceCents: row.statementBalanceCents * s } : null
}

function openRec(db: Database.Database, accountId: number): ReconciliationSummary | undefined {
  return db.prepare(`${SUMMARY} WHERE account_id = ? AND status = 'in_progress'`).get(accountId) as
    ReconciliationSummary | undefined
}

function lastFinished(db: Database.Database, accountId: number): ReconciliationSummary | undefined {
  return db
    .prepare(`${SUMMARY} WHERE account_id = ? AND status = 'finished' ORDER BY statement_date DESC, id DESC LIMIT 1`)
    .get(accountId) as ReconciliationSummary | undefined
}

/** Debit-side total of the account's reconciled lines (posted entries only). */
function reconciledTotal(db: Database.Database, accountId: number): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS c FROM line_clearing c
         JOIN journal_lines l ON l.id = c.journal_line_id JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_id = ? AND c.status = 'reconciled' AND e.status = 'posted'`
      )
      .get(accountId) as { c: number }
  ).c
}

/** Posted, not-yet-reconciled lines on the account (debit-side amounts). */
function openLines(db: Database.Database, accountId: number): (Omit<ReconcileLine, 'otherSide'> & { raw: number })[] {
  return (
    db
      .prepare(
        `SELECT l.id AS lineId, e.id AS entryId, e.entry_date AS date, e.memo, l.amount_cents AS raw,
           CASE WHEN c.status = 'cleared' THEN 1 ELSE 0 END AS cleared
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         LEFT JOIN line_clearing c ON c.journal_line_id = l.id
         WHERE l.account_id = ? AND e.status = 'posted' AND (c.status IS NULL OR c.status <> 'reconciled')
         ORDER BY e.entry_date, e.id, l.line_no`
      )
      .all(accountId) as { lineId: number; entryId: number; date: string; memo: string; raw: number; cleared: number }[]
  ).map((r) => ({ ...r, amountCents: r.raw, cleared: !!r.cleared }))
}

export function reconcileView(db: Database.Database, accountId: number): ReconcileView {
  const a = account(db, accountId)
  const s = sign(a)
  const open = openRec(db, accountId)
  const others = db.prepare(
    `SELECT DISTINCT a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? AND l.account_id <> ?`
  )
  const all = openLines(db, accountId)
  const shown = open ? all.filter((l) => l.date <= open.statementDate) : all
  const history = (
    db
      .prepare(`${SUMMARY} WHERE account_id = ? AND status <> 'in_progress' ORDER BY statement_date DESC, id DESC`)
      .all(accountId) as ReconciliationSummary[]
  ).map((r) => summary(r, s)!)
  return {
    account: { id: a.id, number: a.number, name: a.name, subtype: a.subtype, normalBalance: a.normalBalance },
    last: summary(lastFinished(db, accountId), s),
    open: summary(open, s),
    reconciledCents: reconciledTotal(db, accountId) * s,
    lines: shown.map((l) => {
      const names = (others.all(l.entryId, accountId) as { name: string }[]).map((r) => r.name)
      return {
        lineId: l.lineId,
        entryId: l.entryId,
        date: l.date,
        memo: l.memo,
        otherSide:
          names.length === 1 ? names[0] : names.length === 0 ? '(same account)' : `Split (${names.length} accounts)`,
        amountCents: l.raw * s,
        cleared: l.cleared
      }
    }),
    laterCount: all.length - shown.length,
    history
  }
}

/** Starts (or changes) the reconciliation for a statement: its end date and ending balance (normal side). */
export function setStatement(
  db: Database.Database,
  accountId: number,
  statementDate: string,
  balanceCents: number,
  now: Date = new Date()
): void {
  const a = account(db, accountId)
  if (!isValidDate(statementDate)) throw new LedgerError('Enter the statement end date.')
  if (!Number.isSafeInteger(balanceCents)) throw new LedgerError('Enter the ending balance from the statement.')
  const last = lastFinished(db, accountId)
  if (last && statementDate < last.statementDate) {
    throw new LedgerError(
      `The last reconciliation already covers up to ${last.statementDate}. Choose a later statement.`
    )
  }
  const raw = balanceCents * sign(a)
  const open = openRec(db, accountId)
  if (open) {
    db.prepare('UPDATE reconciliations SET statement_date = ?, statement_balance_cents = ? WHERE id = ?').run(
      statementDate,
      raw,
      open.id
    )
  } else {
    db.prepare(
      `INSERT INTO reconciliations (account_id, statement_date, statement_balance_cents, status, started_at)
       VALUES (?, ?, ?, 'in_progress', ?)`
    ).run(accountId, statementDate, raw, now.toISOString())
  }
}

/** Ticks or unticks lines as cleared (seen on the bank statement). Reconciled lines can't be changed here. */
export function setCleared(db: Database.Database, lineIds: number[], cleared: boolean, now: Date = new Date()): void {
  const get = db.prepare('SELECT status FROM line_clearing WHERE journal_line_id = ?')
  const exists = db.prepare(
    `SELECT a.type FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.id = ? AND e.status = 'posted'`
  )
  db.transaction(() => {
    for (const id of lineIds) {
      const line = exists.get(id) as { type: string } | undefined
      if (!line) throw new LedgerError('One of the lines is no longer posted.')
      if (line.type !== 'asset' && line.type !== 'liability')
        throw new LedgerError('Only bank, card and loan lines can be cleared.')
      const cur = get.get(id) as { status: string } | undefined
      if (cur?.status === 'reconciled')
        throw new LedgerError('A reconciled line can only change by undoing its reconciliation.')
      if (cleared && !cur) {
        db.prepare("INSERT INTO line_clearing (journal_line_id, status, updated_at) VALUES (?, 'cleared', ?)").run(
          id,
          now.toISOString()
        )
      } else if (!cleared && cur) {
        db.prepare('DELETE FROM line_clearing WHERE journal_line_id = ?').run(id)
      }
    }
  })()
}

/** Marks an entry's lines on one account as cleared (used when an imported bank line is posted or matched). */
export function clearEntryLines(
  db: Database.Database,
  entryId: number,
  accountId: number,
  now: Date = new Date()
): void {
  const ids = (
    db.prepare('SELECT id FROM journal_lines WHERE entry_id = ? AND account_id = ?').all(entryId, accountId) as {
      id: number
    }[]
  ).map((r) => r.id)
  const insert = db.prepare(
    `INSERT INTO line_clearing (journal_line_id, status, updated_at) SELECT ?, 'cleared', ?
     WHERE NOT EXISTS (SELECT 1 FROM line_clearing WHERE journal_line_id = ?)`
  )
  for (const id of ids) insert.run(id, now.toISOString(), id)
}

/** Finishes the open reconciliation when the cleared balance equals the statement: ticked lines up to the statement
 * date become reconciled. */
export function finishReconciliation(db: Database.Database, accountId: number, now: Date = new Date()): void {
  account(db, accountId)
  db.transaction(() => {
    const open = openRec(db, accountId)
    if (!open) throw new LedgerError('Enter the statement date and ending balance first.')
    const ticked = openLines(db, accountId).filter((l) => l.cleared && l.date <= open.statementDate)
    const cleared = reconciledTotal(db, accountId) + ticked.reduce((s, l) => s + l.raw, 0)
    const diff = open.statementBalanceCents - cleared
    if (diff !== 0) {
      throw new LedgerError(
        `The cleared balance is off from the statement by ${formatCents(Math.abs(diff))}. Tick or untick lines until the difference is $0.00.`
      )
    }
    const stamp = now.toISOString()
    const mark = db.prepare(
      "UPDATE line_clearing SET status = 'reconciled', reconciliation_id = ?, updated_at = ? WHERE journal_line_id = ?"
    )
    for (const l of ticked) mark.run(open.id, stamp, l.lineId)
    db.prepare("UPDATE reconciliations SET status = 'finished', finished_at = ? WHERE id = ?").run(stamp, open.id)
  })()
}

/** Drops the reconciliation being worked on (ticks stay as cleared). */
export function cancelReconciliation(db: Database.Database, accountId: number): void {
  db.prepare("DELETE FROM reconciliations WHERE account_id = ? AND status = 'in_progress'").run(accountId)
}

/** Undoes the most recent finished reconciliation: its lines go back to cleared. Needs a reason. */
export function undoLastReconciliation(
  db: Database.Database,
  accountId: number,
  reason: string,
  now: Date = new Date()
): void {
  account(db, accountId)
  if (!reason.trim()) throw new LedgerError('Give a reason for undoing the reconciliation.')
  db.transaction(() => {
    if (openRec(db, accountId)) throw new LedgerError('Finish or cancel the reconciliation in progress first.')
    const last = lastFinished(db, accountId)
    if (!last) throw new LedgerError('There is no finished reconciliation to undo.')
    const stamp = now.toISOString()
    db.prepare("UPDATE reconciliations SET status = 'undone', undone_at = ?, undo_reason = ? WHERE id = ?").run(
      stamp,
      reason.trim(),
      last.id
    )
    db.prepare(
      "UPDATE line_clearing SET status = 'cleared', reconciliation_id = NULL, updated_at = ? WHERE reconciliation_id = ?"
    ).run(stamp, last.id)
  })()
}

/** Cleared status for each line id (for the register). */
export function clearingFor(db: Database.Database, lineIds: number[]): Map<number, 'cleared' | 'reconciled'> {
  const out = new Map<number, 'cleared' | 'reconciled'>()
  const get = db.prepare('SELECT status FROM line_clearing WHERE journal_line_id = ?')
  for (const id of lineIds) {
    const r = get.get(id) as { status: 'cleared' | 'reconciled' } | undefined
    if (r) out.set(id, r.status)
  }
  return out
}
