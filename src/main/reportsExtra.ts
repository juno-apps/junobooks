import type Database from 'better-sqlite3'
import { getEntityType, TAX_FORM_LABELS, type EntityTypeId } from '../shared/entities'
import { methodLabel } from '../shared/inventory'
import type { ChannelSales, CogsSchedule, TaxLineSummary } from '../shared/reportsExtra'
import { getTaxLine, taxTableFor, type TaxCategoryKey } from '../shared/taxLines'
import { filedMethod } from './inventory'
import { INVENTORY_SOURCE } from './inventoryReport'
import { LedgerError } from './ledger'

/** Year-end detail reports: sales by channel, tax-line summary, cost of goods sold schedule. */

const CHANNEL_NAMES: Record<string, string> = {
  etsy: 'Etsy',
  amazon: 'Amazon',
  invoice: 'Invoices (direct sales)',
  import: 'Bank and card imports',
  manual: 'Typed in (New income, journal entries)',
  opening: 'Opening balances'
}

export function salesByChannel(db: Database.Database, from: string, to: string): ChannelSales {
  const rows = db
    .prepare(
      `SELECT e.source, a.tax_category AS cat, SUM(l.amount_cents) AS c
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
       WHERE e.status = 'posted' AND e.source <> 'closing' AND e.entry_date BETWEEN ? AND ?
         AND a.tax_category IN ('gross_receipts', 'returns_allowances')
       GROUP BY e.source, a.tax_category`
    )
    .all(from, to) as { source: string; cat: string; c: number }[]
  const by = new Map<string, { salesCents: number; refundsCents: number }>()
  for (const r of rows) {
    const x = by.get(r.source) ?? { salesCents: 0, refundsCents: 0 }
    if (r.cat === 'gross_receipts') x.salesCents += -r.c
    else x.refundsCents += r.c
    by.set(r.source, x)
  }
  const channels = [...by]
    .map(([source, v]) => ({
      source,
      name: CHANNEL_NAMES[source] ?? source,
      ...v,
      netCents: v.salesCents - v.refundsCents
    }))
    .sort((a, b) => b.salesCents - a.salesCents)
  return {
    from,
    to,
    channels,
    totalSalesCents: channels.reduce((s, c) => s + c.salesCents, 0),
    totalRefundsCents: channels.reduce((s, c) => s + c.refundsCents, 0),
    totalNetCents: channels.reduce((s, c) => s + c.netCents, 0)
  }
}

function entityOn(db: Database.Database, date: string): EntityTypeId {
  const r =
    (db
      .prepare(
        'SELECT entity_type AS e FROM entity_type_history WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1'
      )
      .get(date) as { e: EntityTypeId } | undefined) ??
    (db.prepare('SELECT entity_type AS e FROM entity_type_history ORDER BY effective_date LIMIT 1').get() as {
      e: EntityTypeId
    })
  return r.e
}

/** Income and expense accounts for the year (and balance-sheet accounts at year end), grouped by the line they go on
 * for the entity's return. Accounts without a tax category are listed as not mapped. */
export function taxLineSummary(db: Database.Database, year: number): TaxLineSummary {
  if (!Number.isInteger(year)) throw new LedgerError('Choose a year.')
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const entity = entityOn(db, to)
  const form = getEntityType(entity).taxForm
  const accounts = db
    .prepare(
      `SELECT a.id, a.number, a.name, a.type, a.tax_category AS cat, a.accountant_note AS note,
         COALESCE((SELECT SUM(l.amount_cents) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                   WHERE l.account_id = a.id AND e.status = 'posted'
                     AND e.entry_date <= @to AND (a.type IN ('asset', 'liability', 'equity') OR (e.entry_date >= @from AND e.source <> 'closing'))), 0) AS c
       FROM accounts a ORDER BY a.number`
    )
    .all({ from, to }) as {
    id: number
    number: string
    name: string
    type: string
    cat: TaxCategoryKey | null
    note: string
    c: number
  }[]
  const groups = new Map<string, TaxLineSummary['lines'][number]>()
  const unmapped: TaxLineSummary['unmapped'] = []
  for (const a of accounts) {
    if (a.c === 0) continue
    const amount = a.type === 'income' || a.type === 'liability' || a.type === 'equity' ? -a.c : a.c
    const part: 'income' | 'balance' = a.type === 'income' || a.type === 'expense' ? 'income' : 'balance'
    if (!a.cat) {
      unmapped.push({ accountId: a.id, number: a.number, name: a.name, cents: amount })
      continue
    }
    const line = getTaxLine(a.cat, form, year)
    const key = `${part}|${line.ref ?? ''}|${line.label}`
    const g = groups.get(key) ?? { part, ref: line.ref, label: line.label, cents: 0, accounts: [] }
    g.cents += amount
    g.accounts.push({ accountId: a.id, number: a.number, name: a.name, cents: amount, note: a.note })
    groups.set(key, g)
  }
  return {
    year,
    form,
    formLabel: TAX_FORM_LABELS[form],
    tableYear: taxTableFor(year).year,
    lines: [...groups.values()],
    unmapped
  }
}

/** Schedule C Part III style cost of goods sold for a year, from the books. */
export function cogsSchedule(db: Database.Database, year: number): CogsSchedule {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const inventoryBefore = (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
         WHERE a.subtype = 'inventory' AND e.status = 'posted' AND (e.entry_date < ? OR (e.source = 'opening' AND e.entry_date <= ?))`
      )
      .get(from, to) as { c: number }
  ).c
  const inventoryEnd = (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id WHERE a.subtype = 'inventory' AND e.status = 'posted' AND e.entry_date <= ?`
      )
      .get(to) as { c: number }
  ).c
  const byCat = new Map(
    (
      db
        .prepare(
          `SELECT a.tax_category AS cat, SUM(l.amount_cents) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           JOIN accounts a ON a.id = l.account_id
           WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND e.source NOT IN (?, 'closing') AND a.subtype = 'cogs'
           GROUP BY a.tax_category`
        )
        .all(from, to, INVENTORY_SOURCE) as { cat: string; c: number }[]
    ).map((r) => [r.cat, r.c])
  )
  // Bought straight into an inventory account during the year (not opening balances or the year-end entry).
  const intoInventory = (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
         WHERE a.subtype = 'inventory' AND e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND e.source NOT IN ('opening', ?)`
      )
      .get(from, to, INVENTORY_SOURCE) as { c: number }
  ).c
  const purchases = (byCat.get('cogs_purchases') ?? 0) + intoInventory
  const labor = byCat.get('cogs_labor') ?? 0
  const materials = byCat.get('cogs_materials') ?? 0
  const other =
    (byCat.get('cogs_other') ?? 0) +
    [...byCat]
      .filter(([k]) => !['cogs_purchases', 'cogs_labor', 'cogs_materials', 'cogs_other'].includes(k))
      .reduce((s, [, c]) => s + c, 0)
  const method = filedMethod(db, year)
  const adjusted = !!db
    .prepare(
      `SELECT 1 FROM inventory_adjustments a JOIN journal_entries e ON e.id = a.entry_id WHERE a.as_of_date = ? AND e.status = 'posted'
       UNION SELECT 1 FROM inventory_adjustments WHERE as_of_date = ? AND entry_id IS NULL`
    )
    .get(to, to)
  const subtotal = inventoryBefore + purchases + labor + materials + other
  return {
    year,
    beginningCents: inventoryBefore,
    purchasesCents: purchases,
    laborCents: labor,
    materialsCents: materials,
    otherCents: other,
    subtotalCents: subtotal,
    endingCents: inventoryEnd,
    cogsCents: subtotal - inventoryEnd,
    filedMethod: method ? methodLabel(method) : null,
    yearEndEntryPosted: adjusted
  }
}
