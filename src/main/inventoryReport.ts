import type Database from 'better-sqlite3'
import { formatCents } from '../shared/money'
import { INVENTORY_METHODS, itemYear, methodLabel, methodYear } from '../shared/inventory'
import type { InventoryYearReport } from '../shared/inventoryView'
import { filedMethod, filedMethods, itemFacts, listItems } from './inventory'
import { LedgerError, postEntry, voidEntry } from './ledger'

/** The four methods for a year, the filed method, and the year-end adjustment that brings the books' inventory
 * to the filed method's ending value. */

export const INVENTORY_SOURCE = 'inventory'

function inventoryBalance(db: Database.Database, asOf: string): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id WHERE a.subtype = 'inventory' AND e.status = 'posted' AND e.entry_date <= ?`
      )
      .get(asOf) as { c: number }
  ).c
}

function currentAdjustment(db: Database.Database, asOf: string): InventoryYearReport['adjustment'] {
  const r = db
    .prepare(
      `SELECT a.entry_id AS entryId, a.method, a.value_cents AS valueCents, a.as_of_date AS asOf
       FROM inventory_adjustments a LEFT JOIN journal_entries e ON e.id = a.entry_id
       WHERE a.as_of_date = ? AND (a.entry_id IS NULL OR e.status = 'posted') ORDER BY a.id DESC LIMIT 1`
    )
    .get(asOf) as InventoryYearReport['adjustment'] | undefined
  return r ?? null
}

export function inventoryYear(db: Database.Database, year: number, booksStart: string): InventoryYearReport {
  const firstYear = Number(booksStart.slice(0, 4))
  if (!Number.isInteger(year) || year < firstYear) throw new LedgerError(`Your books start in ${firstYear}.`)
  const facts = itemFacts(db)
  const methods = INVENTORY_METHODS.map((m) => methodYear(facts, m.id, year, firstYear))
  const end = `${year}-12-31`
  const names = new Map(listItems(db).map((i) => [i.id, i.name]))
  const notCounted = [...facts]
    .filter(([, f]) => f.purchases.some((p) => p.date <= end) || f.counts.some((c) => c.date <= end))
    .filter(([, f]) => itemYear(f, 'fifo', year, firstYear).notCounted)
    .map(([id]) => names.get(id) ?? `Item ${id}`)
  const inventoryPurchasesCents = [...facts.values()]
    .flatMap((f) => f.purchases)
    .filter((p) => !p.isOpening && p.date >= `${year}-01-01` && p.date <= end)
    .reduce((s, p) => s + p.costCents, 0)
  const booksPurchasesCents = (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
         WHERE e.status = 'posted' AND e.source <> ? AND e.entry_date BETWEEN ? AND ?
           AND (a.subtype = 'inventory' OR a.tax_category IN ('cogs_materials', 'cogs_purchases'))`
      )
      .get(INVENTORY_SOURCE, `${year}-01-01`, end) as { c: number }
  ).c
  return {
    year,
    firstYear,
    filed: filedMethod(db, year),
    methods,
    notCounted,
    history: filedMethods(db).filter((h) => h.year === year),
    check: { inventoryPurchasesCents, booksPurchasesCents },
    adjustment: currentAdjustment(db, end),
    inventoryBalanceCents: inventoryBalance(db, end)
  }
}

/** Default accounts for the adjustment: the first inventory account, and Materials (or Merchandise purchases). */
export function adjustmentAccounts(db: Database.Database): {
  inventoryAccountId: number | null
  cogsAccountId: number | null
} {
  const inv = db
    .prepare("SELECT id FROM accounts WHERE subtype = 'inventory' AND is_active = 1 ORDER BY number LIMIT 1")
    .get() as { id: number } | undefined
  const cogs = db
    .prepare(
      `SELECT id FROM accounts WHERE is_active = 1 AND subtype = 'cogs'
       ORDER BY CASE tax_category WHEN 'cogs_materials' THEN 0 WHEN 'cogs_purchases' THEN 1 ELSE 2 END, number LIMIT 1`
    )
    .get() as { id: number } | undefined
  return { inventoryAccountId: inv?.id ?? null, cogsAccountId: cogs?.id ?? null }
}

/** Posts (or replaces) the year-end adjustment for the filed method: the inventory accounts end the year at the method's
 * ending value; the difference goes to cost of goods sold. Returns the entry id (null when no change was needed). */
export function postInventoryAdjustment(
  db: Database.Database,
  year: number,
  booksStart: string,
  inventoryAccountId: number,
  cogsAccountId: number,
  now: Date = new Date()
): number | null {
  const method = filedMethod(db, year)
  if (!method) throw new LedgerError(`Choose the filed method for ${year} first (ask your accountant).`)
  const acct = db.prepare('SELECT subtype, type, is_active FROM accounts WHERE id = ?')
  const inv = acct.get(inventoryAccountId) as { subtype: string; type: string; is_active: number } | undefined
  const cogs = acct.get(cogsAccountId) as { subtype: string; type: string; is_active: number } | undefined
  if (!inv || inv.subtype !== 'inventory' || !inv.is_active)
    throw new LedgerError('Choose an active inventory account.')
  if (!cogs || cogs.type !== 'expense' || !cogs.is_active)
    throw new LedgerError('Choose an active cost of goods sold account.')
  const end = `${year}-12-31`
  const report = inventoryYear(db, year, booksStart)
  const value = report.methods.find((m) => m.method === method)!.endCents

  return db.transaction(() => {
    const old = currentAdjustment(db, end)
    if (old?.entryId) voidEntry(db, old.entryId, `Replaced by a new ${year} inventory adjustment`)
    const diff = value - inventoryBalance(db, end)
    let entryId: number | null = null
    if (diff !== 0) {
      entryId = postEntry(db, {
        date: end,
        memo: `Inventory adjustment ${year} (${methodLabel(method)}): ending inventory ${formatCents(value)}`,
        source: INVENTORY_SOURCE,
        lines: [
          { accountId: inventoryAccountId, amountCents: diff, memo: 'Ending inventory per the filed method' },
          {
            accountId: cogsAccountId,
            amountCents: -diff,
            memo: diff > 0 ? 'Materials still on hand' : 'Inventory used up'
          }
        ]
      })
    }
    db.prepare(
      'INSERT INTO inventory_adjustments (as_of_date, method, value_cents, entry_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(end, method, value, entryId, now.toISOString())
    return entryId
  })()
}
