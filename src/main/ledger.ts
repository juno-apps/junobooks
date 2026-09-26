import type Database from 'better-sqlite3'
import { isValidDate } from '../shared/dates'
import { formatCents, MAX_CENTS } from '../shared/money'

/**
 * The ledger engine: the only code that writes journal entries. Every
 * function checks its rules here first (for plain-English errors); the
 * database triggers in migrations.ts enforce the same rules underneath.
 *
 * Amounts are signed integer cents: positive = debit, negative = credit.
 */

/** A rule was broken; the message is safe to show on screen as is. */
export class LedgerError extends Error {}

export interface LineInput {
  accountId: number
  amountCents: number
  memo?: string
}

export interface EntryInput {
  date: string
  memo?: string
  /** Where the entry came from, e.g. 'manual', 'etsy_import'. */
  source?: string
  lines: LineInput[]
}

export type EntryStatus = 'draft' | 'posted' | 'void'

export interface Entry {
  id: number
  date: string
  memo: string
  status: EntryStatus
  source: string
  reversesEntryId: number | null
  /** The posted entry that reverses this one, if any. */
  reversedById: number | null
  postedAt: string | null
  voidedAt: string | null
  voidReason: string | null
  lines: { lineNo: number; accountId: number; amountCents: number; memo: string }[]
}

export interface AccountBalance {
  accountId: number
  /** Debits minus credits. */
  balanceCents: number
}

// ---- Period lock ----

export function getLockedThrough(db: Database.Database): string | null {
  const row = db.prepare('SELECT locked_through FROM period_lock_history ORDER BY id DESC LIMIT 1').get() as
    | { locked_through: string | null }
    | undefined
  return row?.locked_through ?? null
}

/** Sets the "books closed through" date (null = nothing locked). Moving it
 * earlier reopens closed dates and needs a reason, which the audit log keeps. */
export function setLockedThrough(db: Database.Database, date: string | null, reason = ''): void {
  if (date !== null && !isValidDate(date)) throw new LedgerError('Enter a valid date.')
  const current = getLockedThrough(db)
  if (date === current) return
  const reopening = current !== null && (date === null || date < current)
  if (reopening && !reason.trim()) throw new LedgerError('Reopening closed books needs a reason.')
  db.prepare('INSERT INTO period_lock_history (locked_through, reason, created_at) VALUES (?, ?, ?)').run(
    date,
    reason.trim(),
    new Date().toISOString()
  )
}

function assertOpen(db: Database.Database, date: string): void {
  const lock = getLockedThrough(db)
  if (lock !== null && date <= lock) {
    throw new LedgerError(`The books are closed through ${lock}. Use a later date, or reopen that period first.`)
  }
}

// ---- Entries ----

export function getEntry(db: Database.Database, id: number): Entry | null {
  const e = db
    .prepare(
      `SELECT e.*, (SELECT r.id FROM journal_entries r WHERE r.reverses_entry_id = e.id AND r.status = 'posted') AS reversed_by
       FROM journal_entries e WHERE e.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  if (!e) return null
  const lines = db
    .prepare('SELECT line_no, account_id, amount_cents, memo FROM journal_lines WHERE entry_id = ? ORDER BY line_no')
    .all(id) as { line_no: number; account_id: number; amount_cents: number; memo: string }[]
  return {
    id: e.id as number,
    date: e.entry_date as string,
    memo: e.memo as string,
    status: e.status as EntryStatus,
    source: e.source as string,
    reversesEntryId: (e.reverses_entry_id as number | null) ?? null,
    reversedById: (e.reversed_by as number | null) ?? null,
    postedAt: (e.posted_at as string | null) ?? null,
    voidedAt: (e.voided_at as string | null) ?? null,
    voidReason: (e.void_reason as string | null) ?? null,
    lines: lines.map((l) => ({ lineNo: l.line_no, accountId: l.account_id, amountCents: l.amount_cents, memo: l.memo }))
  }
}

function validateEntry(db: Database.Database, input: EntryInput): void {
  if (!isValidDate(input.date)) throw new LedgerError('Enter a valid date.')
  if (input.lines.length < 2) throw new LedgerError('An entry needs at least two lines.')

  input.lines.forEach((l, i) => {
    if (!Number.isSafeInteger(l.amountCents)) throw new LedgerError(`Line ${i + 1}: amount must be in whole cents.`)
    if (l.amountCents === 0) throw new LedgerError(`Line ${i + 1}: amount can't be zero.`)
    if (Math.abs(l.amountCents) > MAX_CENTS) throw new LedgerError(`Line ${i + 1}: amount is too large.`)
  })

  const total = input.lines.reduce((sum, l) => sum + l.amountCents, 0)
  if (total !== 0) {
    const debits = input.lines.reduce((s, l) => s + Math.max(l.amountCents, 0), 0)
    const credits = input.lines.reduce((s, l) => s + Math.max(-l.amountCents, 0), 0)
    throw new LedgerError(
      `Debits (${formatCents(debits)}) and credits (${formatCents(credits)}) don't match — off by ${formatCents(Math.abs(total))}.`
    )
  }

  const account = db.prepare('SELECT number, name, is_active FROM accounts WHERE id = ?')
  input.lines.forEach((l, i) => {
    const a = account.get(l.accountId) as { number: string; name: string; is_active: number } | undefined
    if (!a) throw new LedgerError(`Line ${i + 1}: that account doesn't exist.`)
    if (!a.is_active) throw new LedgerError(`Line ${i + 1}: account ${a.number} ${a.name} is inactive.`)
  })

  assertOpen(db, input.date)
}

function insertAndPost(db: Database.Database, input: EntryInput, reversesEntryId: number | null): number {
  validateEntry(db, input)
  return db.transaction(() => {
    const now = new Date().toISOString()
    const id = Number(
      db
        .prepare(
          'INSERT INTO journal_entries (entry_date, memo, source, reverses_entry_id, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(input.date, input.memo?.trim() ?? '', input.source ?? 'manual', reversesEntryId, now).lastInsertRowid
    )
    const addLine = db.prepare(
      'INSERT INTO journal_lines (entry_id, line_no, account_id, amount_cents, memo) VALUES (?, ?, ?, ?, ?)'
    )
    input.lines.forEach((l, i) => addLine.run(id, i + 1, l.accountId, l.amountCents, l.memo?.trim() ?? ''))
    db.prepare("UPDATE journal_entries SET status = 'posted', posted_at = ? WHERE id = ?").run(now, id)
    return id
  })()
}

/** Validates and posts a balanced entry in one transaction. Returns its id. */
export function postEntry(db: Database.Database, input: EntryInput): number {
  return insertAndPost(db, input, null)
}

function requirePosted(db: Database.Database, id: number, action: string): Entry {
  const entry = getEntry(db, id)
  if (!entry) throw new LedgerError(`Entry #${id} doesn't exist.`)
  if (entry.status === 'void') throw new LedgerError(`Entry #${id} is already voided.`)
  if (entry.status !== 'posted') throw new LedgerError(`Only posted entries can be ${action}.`)
  if (entry.reversedById !== null) {
    throw new LedgerError(`Entry #${id} was already reversed by entry #${entry.reversedById}.`)
  }
  return entry
}

/** Cancels a posted entry. It stays on record, excluded from balances. */
export function voidEntry(db: Database.Database, id: number, reason: string): void {
  if (!reason.trim()) throw new LedgerError('Voiding an entry needs a reason.')
  const entry = requirePosted(db, id, 'voided')
  assertOpen(db, entry.date)
  const inactive = db
    .prepare(
      `SELECT a.number, a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id
       WHERE l.entry_id = ? AND a.is_active = 0 LIMIT 1`
    )
    .get(id) as { number: string; name: string } | undefined
  if (inactive) {
    throw new LedgerError(`Account ${inactive.number} ${inactive.name} is inactive. Reactivate it before voiding this entry.`)
  }
  db.prepare("UPDATE journal_entries SET status = 'void', voided_at = ?, void_reason = ? WHERE id = ?").run(
    new Date().toISOString(),
    reason.trim(),
    id
  )
}

/** Posts an equal-and-opposite entry on `date`, linked to the original.
 * Works even when the original's period is locked. Returns the new id. */
export function reverseEntry(db: Database.Database, id: number, date: string, memo?: string): number {
  const entry = requirePosted(db, id, 'reversed')
  if (isValidDate(date) && date < entry.date) {
    throw new LedgerError(`A reversal can't be dated before the entry it reverses (${entry.date}).`)
  }
  return insertAndPost(
    db,
    {
      date,
      memo: memo?.trim() || `Reversal of entry #${id}${entry.memo ? `: ${entry.memo}` : ''}`,
      source: 'reversal',
      lines: entry.lines.map((l) => ({ accountId: l.accountId, amountCents: -l.amountCents, memo: l.memo }))
    },
    id
  )
}

// ---- Balances ----

/** Every account's balance from posted entries dated on or before `asOf`
 * (all dates if omitted). Voided entries and drafts don't count. */
export function accountBalances(db: Database.Database, asOf?: string): AccountBalance[] {
  if (asOf !== undefined && !isValidDate(asOf)) throw new LedgerError('Enter a valid date.')
  return db
    .prepare(
      `SELECT a.id AS accountId, COALESCE(SUM(x.amount_cents), 0) AS balanceCents
       FROM accounts a
       LEFT JOIN (
         SELECT l.account_id, l.amount_cents
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE e.status = 'posted' AND (@asOf IS NULL OR e.entry_date <= @asOf)
       ) x ON x.account_id = a.id
       GROUP BY a.id
       ORDER BY a.number`
    )
    .all({ asOf: asOf ?? null }) as AccountBalance[]
}
