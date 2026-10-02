import type Database from 'better-sqlite3'
import { ENTITY_TYPES, TAX_FORM_LABELS, getEntityType, type EntityTypeId } from '../shared/entities'
import { methodLabel } from '../shared/inventory'
import { formatCents } from '../shared/money'
import type { AccountantNote } from '../shared/pkg'
import { getStateName } from '../shared/states'
import { tieOut } from './form1099k'
import { filedMethod } from './inventory'
import { inventoryYear } from './inventoryReport'
import { getLockedThrough } from './ledger'
import { fixedAssetReport, mileageReport, necReport, getHomeOffice } from './records'
import { taxLineSummary } from './reportsExtra'
import { salesTaxReport } from './salesTax'

/** Everything the accountant should know about a year, in plain words: notes on accounts used, and situations to check. */
export function accountantNotes(db: Database.Database, year: number, booksStart: string): AccountantNote[] {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const notes: AccountantNote[] = []
  const add = (area: string, kind: AccountantNote['kind'], text: string): void => void notes.push({ area, kind, text })

  // Company: entity type and home state, and any changes during the year.
  const entityRows = db
    .prepare('SELECT entity_type AS e, effective_date AS d FROM entity_type_history ORDER BY effective_date')
    .all() as { e: EntityTypeId; d: string }[]
  const entityAt = (date: string): EntityTypeId => (entityRows.filter((r) => r.d <= date).pop() ?? entityRows[0]).e
  const yearEntity = getEntityType(entityAt(to))
  add('Company', 'note', `Entity type at year end: ${yearEntity.label} (${TAX_FORM_LABELS[yearEntity.taxForm]}).`)
  for (const r of entityRows.filter((x) => x.d > from && x.d <= to)) {
    const label = ENTITY_TYPES.find((t) => t.id === r.e)?.label ?? r.e
    add(
      'Company',
      'check',
      `Entity type changed to ${label} on ${r.d}. Check the return(s) needed for the parts of the year.`
    )
  }
  for (const r of db
    .prepare(
      'SELECT state_code AS s, effective_date AS d FROM home_state_history WHERE effective_date > ? AND effective_date <= ?'
    )
    .all(from, to) as { s: string; d: string }[]) {
    add('Company', 'check', `Home state changed to ${getStateName(r.s)} on ${r.d}.`)
  }
  if (booksStart > from && booksStart <= to)
    add('Company', 'note', `These books start on ${booksStart}; earlier ${year} activity isn't in them.`)
  const locked = getLockedThrough(db)
  if (!locked || locked < to)
    add(
      'Company',
      'check',
      `The books aren't closed through ${to} yet (Close the year), so entries for ${year} can still change.`
    )

  // Accounts used in the year that carry an accountant note.
  const used = db
    .prepare(
      `SELECT DISTINCT a.number, a.name, a.accountant_note AS note FROM accounts a
       JOIN journal_lines l ON l.account_id = a.id JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND a.accountant_note <> '' ORDER BY a.number`
    )
    .all(from, to) as { number: string; name: string; note: string }[]
  for (const a of used) add('Accounts', 'note', `${a.number} ${a.name}: ${a.note}`)
  const tl = taxLineSummary(db, year)
  for (const u of tl.unmapped)
    add('Accounts', 'check', `${u.number} ${u.name} (${formatCents(u.cents)}) has no tax category.`)

  // Opening balance equity should be cleared out.
  const obe = (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id WHERE a.subtype = 'opening_balance' AND e.status = 'posted' AND e.entry_date <= ?`
      )
      .get(to) as { c: number }
  ).c
  if (obe !== 0)
    add(
      'Equity',
      'check',
      `Opening balance equity holds ${formatCents(-obe)} at year end. It should be moved into the right equity accounts.`
    )

  // Marketplace payment accounts holding money at year end.
  for (const a of db
    .prepare(
      `SELECT a.name, COALESCE(SUM(l.amount_cents), 0) AS c FROM accounts a JOIN journal_lines l ON l.account_id = a.id
       JOIN journal_entries e ON e.id = l.entry_id
       WHERE a.name IN ('Etsy payment account', 'Amazon payment account') AND e.status = 'posted' AND e.entry_date <= ?
       GROUP BY a.id HAVING c <> 0`
    )
    .all(to) as { name: string; c: number }[]) {
    add(
      'Marketplaces',
      'note',
      `${a.name} holds ${formatCents(a.c)} at year end (sales not yet paid out, or reserves).`
    )
  }

  // Inventory.
  const inv = inventoryYear(db, year, booksStart)
  const hasInventory =
    inv.methods.some((m) => m.purchasesCents || m.endCents || m.beginCents) || inv.inventoryBalanceCents !== 0
  if (hasInventory) {
    const method = filedMethod(db, year)
    if (!method)
      add(
        'Inventory',
        'check',
        `No filed inventory method chosen for ${year}. All four are in the workbook for comparison.`
      )
    else if (!inv.adjustment)
      add('Inventory', 'check', `The year-end inventory entry for ${year} hasn't been posted yet.`)
    else
      add(
        'Inventory',
        'note',
        `Filed method: ${methodLabel(method)}; ending inventory ${formatCents(inv.adjustment.valueCents)}.`
      )
    if (inv.notCounted.length) add('Inventory', 'check', `Not counted on ${to}: ${inv.notCounted.join(', ')}.`)
    if (inv.check.inventoryPurchasesCents !== inv.check.booksPurchasesCents) {
      add(
        'Inventory',
        'check',
        `Material purchases recorded on the Inventory screen (${formatCents(inv.check.inventoryPurchasesCents)}) differ from the books (${formatCents(inv.check.booksPurchasesCents)}).`
      )
    }
  }

  // Sales tax.
  const st = salesTaxReport(db, from, to)
  for (const x of st.otherExempt)
    add(
      'Sales tax',
      'check',
      `Invoice ${x.number} (${x.customerName}, ${formatCents(x.subtotalCents)}) had no sales tax and no valid resale certificate.`
    )
  if (st.computedTaxCents !== st.chargedCents && st.taxableCents !== 0) {
    add(
      'Sales tax',
      'check',
      `Sales tax at the rates in force (${formatCents(st.computedTaxCents)}) differs from the tax charged (${formatCents(st.chargedCents)}).`
    )
  }
  if (st.missingRate) add('Sales tax', 'check', 'Some months have taxable sales but no sales tax rate entered.')
  if (st.owedAtEndCents !== 0)
    add('Sales tax', 'note', `Sales tax payable at year end: ${formatCents(st.owedAtEndCents)}.`)

  // 1099-K.
  for (const r of tieOut(db, year)) {
    if (r.imported && r.importedCents > 0 && r.formCents === null)
      add(
        '1099-K',
        'check',
        `${r.platform}: enter box 1a from the 1099-K when it arrives (imported gross ${formatCents(r.importedCents)}).`
      )
    if (r.differenceCents)
      add(
        '1099-K',
        'check',
        `${r.platform}: the 1099-K (${formatCents(r.formCents!)}) differs from the imported gross by ${formatCents(r.differenceCents)}.`
      )
    if (r.notes) add('1099-K', 'note', `${r.platform}: ${r.notes}`)
  }

  // Contractors.
  const nec = necReport(db, year)
  for (const r of nec.rows.filter((x) => x.overThreshold)) {
    add(
      '1099-NEC',
      r.w9OnFile ? 'note' : 'check',
      `${r.name} was paid ${formatCents(r.paidCents)}: a 1099-NEC is likely needed${r.w9OnFile ? '' : ' (no W-9 on file)'}.`
    )
  }
  if (nec.unmatched.length)
    add('1099-NEC', 'check', `${nec.unmatched.length} contract-labor payment(s) aren't matched to a contractor.`)

  // Bank: unreviewed lines and reconciliation.
  const waiting = (
    db
      .prepare("SELECT COUNT(*) AS n FROM bank_lines WHERE status = 'new' AND txn_date BETWEEN ? AND ?")
      .get(from, to) as { n: number }
  ).n
  if (waiting) add('Bank', 'check', `${waiting} imported bank line(s) from ${year} haven't been reviewed.`)
  for (const a of db
    .prepare(
      `SELECT a.id, a.name, (SELECT MAX(r.statement_date) FROM reconciliations r WHERE r.account_id = a.id AND r.status = 'finished') AS last
       FROM accounts a WHERE a.subtype IN ('bank', 'credit_card') AND EXISTS (
         SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_id = a.id AND e.status = 'posted' AND e.entry_date BETWEEN ? AND ?)`
    )
    .all(from, to) as { id: number; name: string; last: string | null }[]) {
    if (!a.last) add('Bank', 'check', `${a.name} hasn't been reconciled yet (it should be, through ${to}).`)
    else if (a.last < to) add('Bank', 'check', `${a.name} is reconciled only through ${a.last}, not ${to}.`)
  }

  // Fixed assets, mileage, home office.
  const fa = fixedAssetReport(db, year)
  if (fa.totalCostCents !== fa.booksCents) {
    add(
      'Fixed assets',
      'check',
      `The fixed-asset list (${formatCents(fa.totalCostCents)}) doesn't match the fixed-asset accounts (${formatCents(fa.booksCents)}).`
    )
  }
  for (const a of fa.assets.filter((x) => x.placedThisYear))
    add(
      'Fixed assets',
      'note',
      `New in ${year}: ${a.name}, ${formatCents(a.costCents)}, in service ${a.inServiceDate}.`
    )
  const mi = mileageReport(db, year)
  if (mi.trips.length && mi.rateTenthCents === null)
    add('Mileage', 'check', `Business miles are logged but no standard mileage rate was entered for ${year}.`)
  const ho = getHomeOffice(db, year)
  if (ho.details)
    add(
      'Home office',
      'note',
      `Home office ${ho.details.officeSqft} of ${ho.details.homeSqft} sq ft (${(ho.percentBp / 100).toFixed(2)}%).`
    )

  return notes
}
