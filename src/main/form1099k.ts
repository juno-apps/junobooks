import type Database from 'better-sqlite3'
import type { TieOutRow } from '../shared/form1099k'
import { LedgerError } from './ledger'

/** 1099-K tie-out: the gross a platform reports on its 1099-K (typed in by the owner) vs. the gross JunoBooks imported. */

const CHANNELS: { platform: string; channel: string }[] = [
  { platform: 'Etsy', channel: 'etsy' },
  { platform: 'Amazon', channel: 'amazon' }
]

export function tieOut(db: Database.Database, year: number): TieOutRow[] {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const entered = new Map(
    (
      db.prepare('SELECT platform, gross_cents AS grossCents, notes FROM form_1099k WHERE year = ?').all(year) as {
        platform: string
        grossCents: number
        notes: string
      }[]
    ).map((r) => [r.platform, r])
  )
  const months = db.prepare(
    `SELECT CAST(substr(row_date, 6, 2) AS INTEGER) AS m, SUM(gross_cents) AS c FROM marketplace_rows
     WHERE channel = ? AND row_date BETWEEN ? AND ? GROUP BY m`
  )
  const refunds = db.prepare(
    `SELECT COALESCE(SUM(cents), 0) AS c FROM marketplace_rows WHERE channel = ? AND kind = 'refund' AND row_date BETWEEN ? AND ?`
  )
  const rows: TieOutRow[] = CHANNELS.map(({ platform, channel }) => {
    const monthly = Array<number>(12).fill(0)
    for (const r of months.all(channel, from, to) as { m: number; c: number }[]) monthly[r.m - 1] = r.c
    const imported = monthly.reduce((s, c) => s + c, 0)
    const e = entered.get(platform)
    return {
      platform,
      imported: true,
      importedCents: imported,
      monthlyCents: monthly,
      refundsCents: (refunds.get(channel, from, to) as { c: number }).c,
      formCents: e?.grossCents ?? null,
      notes: e?.notes ?? '',
      differenceCents: e ? e.grossCents - imported : null
    }
  })
  for (const [platform, e] of entered) {
    if (CHANNELS.some((c) => c.platform === platform)) continue
    rows.push({
      platform,
      imported: false,
      importedCents: 0,
      monthlyCents: Array<number>(12).fill(0),
      refundsCents: 0,
      formCents: e.grossCents,
      notes: e.notes,
      differenceCents: null
    })
  }
  return rows
}

/** Records (or clears, with null) the gross on a platform's 1099-K for a year. */
export function set1099k(
  db: Database.Database,
  year: number,
  platform: string,
  grossCents: number | null,
  notes: string,
  now: Date = new Date()
): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new LedgerError('Choose a year.')
  if (!platform.trim()) throw new LedgerError('Enter who sent the 1099-K (e.g. Etsy, Amazon, PayPal, Square).')
  if (grossCents === null) {
    db.prepare('DELETE FROM form_1099k WHERE year = ? AND platform = ?').run(year, platform.trim())
    return
  }
  if (!Number.isSafeInteger(grossCents) || grossCents < 0) throw new LedgerError('Enter the gross amount from box 1a.')
  db.prepare(
    `INSERT INTO form_1099k (year, platform, gross_cents, notes, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (year, platform) DO UPDATE SET gross_cents = excluded.gross_cents, notes = excluded.notes, updated_at = excluded.updated_at`
  ).run(year, platform.trim(), grossCents, notes.trim(), now.toISOString())
}
