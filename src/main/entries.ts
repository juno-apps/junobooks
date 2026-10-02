import type Database from 'better-sqlite3'
import type { EntryListItem } from '../shared/journal'

/** Read-only views of journal entries for the screens. Writing stays in ledger.ts. */

/** Every entry, newest date first (then newest id), with its lines and account names. */
export function listEntries(db: Database.Database): EntryListItem[] {
  const entries = db
    .prepare(
      `SELECT e.id, e.entry_date, e.memo, e.status, e.source, e.reverses_entry_id, e.void_reason,
         (SELECT r.id FROM journal_entries r WHERE r.reverses_entry_id = e.id AND r.status = 'posted') AS reversed_by,
         (SELECT COUNT(*) FROM attachments t WHERE t.entry_id = e.id AND t.removed_at IS NULL) AS receipts
       FROM journal_entries e
       ORDER BY e.entry_date DESC, e.id DESC`
    )
    .all() as {
    id: number
    entry_date: string
    memo: string
    status: EntryListItem['status']
    source: string
    reverses_entry_id: number | null
    void_reason: string | null
    reversed_by: number | null
    receipts: number
  }[]

  const lines = db
    .prepare(
      `SELECT l.entry_id, l.account_id, a.number, a.name, l.amount_cents, l.memo
       FROM journal_lines l JOIN accounts a ON a.id = l.account_id
       ORDER BY l.entry_id, l.line_no`
    )
    .all() as { entry_id: number; account_id: number; number: string; name: string; amount_cents: number; memo: string }[]

  const byEntry = new Map<number, EntryListItem['lines']>()
  for (const l of lines) {
    const list = byEntry.get(l.entry_id) ?? []
    list.push({ accountId: l.account_id, accountNumber: l.number, accountName: l.name, amountCents: l.amount_cents, memo: l.memo })
    byEntry.set(l.entry_id, list)
  }

  return entries.map((e) => {
    const entryLines = byEntry.get(e.id) ?? []
    return {
      id: e.id,
      date: e.entry_date,
      memo: e.memo,
      status: e.status,
      source: e.source,
      reversesEntryId: e.reverses_entry_id,
      reversedById: e.reversed_by,
      voidReason: e.void_reason,
      amountCents: entryLines.reduce((s, l) => s + Math.max(l.amountCents, 0), 0),
      receiptCount: e.receipts,
      lines: entryLines
    }
  })
}
