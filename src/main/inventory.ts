import type Database from 'better-sqlite3'
import { isValidDate } from '../shared/dates'
import type {
  InventoryCountRow,
  InventoryItem,
  InventoryMethod,
  InventoryPurchase,
  ItemFacts
} from '../shared/inventory'
import type { CountSheet, ItemInput, PurchaseInput } from '../shared/inventoryView'
import { getLockedThrough, LedgerError } from './ledger'

/** Inventory facts: items, purchases (quantity and cost only; the money side is in the ledger) and counts. */

function assertOpen(db: Database.Database, date: string, what: string): void {
  const locked = getLockedThrough(db)
  if (locked && date <= locked)
    throw new LedgerError(`Your books are closed through ${locked}, so ${what} dated ${date} can't change.`)
}

export function listItems(db: Database.Database): InventoryItem[] {
  return (
    db.prepare('SELECT id, name, unit, notes, is_active AS isActive FROM inventory_items ORDER BY name').all() as (Omit<
      InventoryItem,
      'isActive'
    > & { isActive: number })[]
  ).map((i) => ({ ...i, isActive: !!i.isActive }))
}

function checkItem(input: ItemInput): void {
  if (!input.name.trim()) throw new LedgerError('Give the item a name, e.g. "Sterling silver sheet 22ga".')
  if (!input.unit.trim()) throw new LedgerError('Choose the unit you count it in, e.g. g, dwt, ozt or each.')
  if (input.name.trim().length > 100 || input.unit.trim().length > 20)
    throw new LedgerError('That name or unit is too long.')
}

export function addItem(db: Database.Database, input: ItemInput, now: Date = new Date()): number {
  checkItem(input)
  if (db.prepare('SELECT 1 FROM inventory_items WHERE name = ?').get(input.name.trim())) {
    throw new LedgerError(`There is already an item called "${input.name.trim()}".`)
  }
  const stamp = now.toISOString()
  return Number(
    db
      .prepare('INSERT INTO inventory_items (name, unit, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(input.name.trim(), input.unit.trim(), input.notes.trim(), stamp, stamp).lastInsertRowid
  )
}

export function updateItem(
  db: Database.Database,
  id: number,
  input: ItemInput & { isActive: boolean },
  now: Date = new Date()
): void {
  checkItem(input)
  const clash = db.prepare('SELECT id FROM inventory_items WHERE name = ? AND id <> ?').get(input.name.trim(), id)
  if (clash) throw new LedgerError(`There is already an item called "${input.name.trim()}".`)
  const r = db
    .prepare('UPDATE inventory_items SET name = ?, unit = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?')
    .run(input.name.trim(), input.unit.trim(), input.notes.trim(), input.isActive ? 1 : 0, now.toISOString(), id)
  if (r.changes === 0) throw new LedgerError('That item no longer exists.')
}

const PURCHASE = `SELECT id, item_id AS itemId, purchase_date AS date, quantity_milli AS quantityMilli, cost_cents AS costCents,
  is_opening AS isOpening, memo FROM inventory_purchases WHERE removed_at IS NULL`

type PurchaseRow = Omit<InventoryPurchase, 'isOpening'> & { isOpening: number }
const toPurchase = (r: PurchaseRow): InventoryPurchase => ({ ...r, isOpening: !!r.isOpening })

export function listPurchases(db: Database.Database): InventoryPurchase[] {
  return (db.prepare(`${PURCHASE} ORDER BY purchase_date DESC, id DESC`).all() as PurchaseRow[]).map(toPurchase)
}

function checkPurchase(db: Database.Database, input: PurchaseInput, booksStart: string): void {
  if (!isValidDate(input.date)) throw new LedgerError('Enter the date.')
  if (input.date < booksStart)
    throw new LedgerError(`Your books start on ${booksStart}; date opening stock on that day.`)
  const item = db.prepare('SELECT is_active FROM inventory_items WHERE id = ?').get(input.itemId) as
    { is_active: number } | undefined
  if (!item) throw new LedgerError('Choose an item.')
  if (!item.is_active) throw new LedgerError('That item is turned off.')
  if (!Number.isSafeInteger(input.quantityMilli) || input.quantityMilli <= 0)
    throw new LedgerError('Enter how much you bought (more than zero).')
  if (!Number.isSafeInteger(input.costCents) || input.costCents < 0)
    throw new LedgerError('Enter what it cost in total.')
  assertOpen(db, input.date, 'a purchase')
}

export function addPurchase(
  db: Database.Database,
  input: PurchaseInput,
  booksStart: string,
  now: Date = new Date()
): number {
  checkPurchase(db, input, booksStart)
  const stamp = now.toISOString()
  return Number(
    db
      .prepare(
        `INSERT INTO inventory_purchases (item_id, purchase_date, quantity_milli, cost_cents, is_opening, memo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.itemId,
        input.date,
        input.quantityMilli,
        input.costCents,
        input.isOpening ? 1 : 0,
        input.memo.trim(),
        stamp,
        stamp
      ).lastInsertRowid
  )
}

export function updatePurchase(
  db: Database.Database,
  id: number,
  input: PurchaseInput,
  booksStart: string,
  now: Date = new Date()
): void {
  const old = db.prepare(`${PURCHASE} AND id = ?`).get(id) as PurchaseRow | undefined
  if (!old) throw new LedgerError('That purchase no longer exists.')
  assertOpen(db, old.date, 'a purchase')
  checkPurchase(db, input, booksStart)
  db.prepare(
    `UPDATE inventory_purchases SET item_id = ?, purchase_date = ?, quantity_milli = ?, cost_cents = ?, is_opening = ?, memo = ?,
       updated_at = ? WHERE id = ?`
  ).run(
    input.itemId,
    input.date,
    input.quantityMilli,
    input.costCents,
    input.isOpening ? 1 : 0,
    input.memo.trim(),
    now.toISOString(),
    id
  )
}

export function removePurchase(db: Database.Database, id: number, now: Date = new Date()): void {
  const old = db.prepare(`${PURCHASE} AND id = ?`).get(id) as PurchaseRow | undefined
  if (!old) throw new LedgerError('That purchase no longer exists.')
  assertOpen(db, old.date, 'a purchase')
  db.prepare('UPDATE inventory_purchases SET removed_at = ?, updated_at = ? WHERE id = ?').run(
    now.toISOString(),
    now.toISOString(),
    id
  )
}

export function countDates(db: Database.Database): { date: string; items: number }[] {
  return db
    .prepare(
      'SELECT count_date AS date, COUNT(*) AS items FROM inventory_counts GROUP BY count_date ORDER BY count_date DESC'
    )
    .all() as { date: string; items: number }[]
}

/** The count sheet for a date: every active item (plus any item counted that day), with the counted quantity if any
 * and what the books expect from earlier counts and purchases. */
export function countSheet(db: Database.Database, date: string): CountSheet {
  if (!isValidDate(date)) throw new LedgerError('Enter the count date.')
  const counted = new Map(
    (
      db
        .prepare('SELECT item_id AS itemId, quantity_milli AS q FROM inventory_counts WHERE count_date = ?')
        .all(date) as {
        itemId: number
        q: number
      }[]
    ).map((r) => [r.itemId, r.q])
  )
  const facts = itemFacts(db)
  const items = listItems(db).filter((i) => i.isActive || counted.has(i.id))
  return {
    date,
    rows: items.map((i) => {
      const f = facts.get(i.id) ?? { purchases: [], counts: [] }
      const before = { purchases: f.purchases, counts: f.counts.filter((c) => c.date < date) }
      const prior = before.counts.length || f.purchases.some((p) => p.date <= date)
      const expected = prior ? expectedOnHand(before, date) : null
      return {
        itemId: i.id,
        name: i.name,
        unit: i.unit,
        quantityMilli: counted.get(i.id) ?? null,
        expectedMilli: expected
      }
    })
  }
}

function expectedOnHand(f: ItemFacts, date: string): number {
  const count = f.counts.filter((c) => c.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0]
  const from = count?.date ?? ''
  return (
    (count?.quantityMilli ?? 0) +
    f.purchases.filter((p) => p.date > from && p.date <= date).reduce((s, p) => s + p.quantityMilli, 0)
  )
}

/** Saves a count: a quantity per item (null clears that item's count for the date). */
export function saveCount(
  db: Database.Database,
  date: string,
  rows: { itemId: number; quantityMilli: number | null }[],
  booksStart: string,
  now: Date = new Date()
): void {
  if (!isValidDate(date)) throw new LedgerError('Enter the count date.')
  if (date < booksStart) throw new LedgerError(`Your books start on ${booksStart}; a count can't be earlier.`)
  assertOpen(db, date, 'a count')
  const stamp = now.toISOString()
  db.transaction(() => {
    for (const r of rows) {
      if (r.quantityMilli === null) {
        db.prepare('DELETE FROM inventory_counts WHERE count_date = ? AND item_id = ?').run(date, r.itemId)
        continue
      }
      if (!Number.isSafeInteger(r.quantityMilli) || r.quantityMilli < 0)
        throw new LedgerError('Counted quantities must be zero or more.')
      db.prepare(
        `INSERT INTO inventory_counts (count_date, item_id, quantity_milli, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (count_date, item_id) DO UPDATE SET quantity_milli = excluded.quantity_milli, updated_at = excluded.updated_at`
      ).run(date, r.itemId, r.quantityMilli, stamp, stamp)
    }
  })()
}

/** Purchases and counts per item, for the method calculations. */
export function itemFacts(db: Database.Database): Map<number, ItemFacts> {
  const out = new Map<number, ItemFacts>()
  const get = (id: number): ItemFacts => {
    let f = out.get(id)
    if (!f) out.set(id, (f = { purchases: [], counts: [] }))
    return f
  }
  for (const i of listItems(db)) get(i.id)
  for (const p of (db.prepare(`${PURCHASE} ORDER BY purchase_date, id`).all() as PurchaseRow[]).map(toPurchase))
    get(p.itemId).purchases.push(p)
  for (const c of db
    .prepare(
      'SELECT item_id AS itemId, count_date AS date, quantity_milli AS quantityMilli FROM inventory_counts ORDER BY count_date'
    )
    .all() as InventoryCountRow[])
    get(c.itemId).counts.push(c)
  return out
}

/** The filed method for each year (latest choice), with history. */
export function filedMethods(
  db: Database.Database
): { year: number; method: InventoryMethod | null; reason: string; createdAt: string }[] {
  return db
    .prepare('SELECT year, method, reason, created_at AS createdAt FROM inventory_methods ORDER BY year DESC, id DESC')
    .all() as { year: number; method: InventoryMethod | null; reason: string; createdAt: string }[]
}

export function filedMethod(db: Database.Database, year: number): InventoryMethod | null {
  const r = db.prepare('SELECT method FROM inventory_methods WHERE year = ? ORDER BY id DESC LIMIT 1').get(year) as
    { method: InventoryMethod | null } | undefined
  return r?.method ?? null
}

/** Records the filed method for a year. Changing an existing choice needs a reason (it's kept). */
export function setFiledMethod(
  db: Database.Database,
  year: number,
  method: InventoryMethod | null,
  reason: string,
  now: Date = new Date()
): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new LedgerError('Choose a year.')
  const current = filedMethod(db, year)
  if (current === method) return
  if (current !== null && !reason.trim()) {
    throw new LedgerError('Changing the filed method needs a reason (for example, your accountant filed Form 3115).')
  }
  const locked = getLockedThrough(db)
  if (locked && locked >= `${year}-12-31`)
    throw new LedgerError(`Your books are closed through ${locked}, so ${year}'s method can't change.`)
  db.prepare('INSERT INTO inventory_methods (year, method, reason, created_at) VALUES (?, ?, ?, ?)').run(
    year,
    method,
    reason.trim(),
    now.toISOString()
  )
}
