import type Database from 'better-sqlite3'
import type { ChartAccount, ChartView, MissingAccount } from '../shared/chart'
import type { EntityAccountChanges } from '../shared/company'
import { getEntityType, type EntityTypeId } from '../shared/entities'
import { getTaxLine, taxTableFor, type AccountType, type TaxCategoryKey } from '../shared/taxLines'
import { buildChart, type NormalBalance, type TemplateAccount, type TemplateId } from '../shared/templates'
import { accountBalances } from './ledger'

/** Adds the template's accounts for this entity type, skipping any account
 * number that already exists (the owner's own accounts always win).
 * Records the template on the company. Returns how many were added. */
export function applyChart(db: Database.Database, template: TemplateId, entity: EntityTypeId, now = new Date()): number {
  const stamp = now.toISOString()
  const exists = db.prepare('SELECT 1 FROM accounts WHERE number = ?')
  const insert = db.prepare(
    `INSERT INTO accounts (number, name, type, subtype, normal_balance, tax_category, accountant_note, created_at, updated_at)
     VALUES (@number, @name, @type, @subtype, @normalBalance, @taxCategory, @accountantNote, @stamp, @stamp)`
  )
  return db.transaction(() => {
    let added = 0
    for (const a of buildChart(template, entity)) {
      if (exists.get(a.number)) continue
      insert.run({ ...a, stamp })
      added++
    }
    db.prepare('UPDATE company_profile SET template = ? WHERE id = 1').run(template)
    return added
  })()
}

/** Works out where each wanted account goes, and (when `stamp` is given) adds them.
 * An account is skipped quietly if one with the same name already exists (so renumbered
 * accounts don't return). If its number already holds an account with the same tax category,
 * that account is taken to cover it and the skip is reported. If the number is held by a
 * different kind of account (e.g. "Owner's capital" on 3000), it gets the next free number
 * in the same range and is reported with the number it wanted; with no free number it is
 * reported as not added. Never changes or removes existing accounts. */
function placeAccounts(db: Database.Database, wanted: TemplateAccount[], stamp: string | null): EntityAccountChanges {
  const byNumber = db.prepare('SELECT name, tax_category AS taxCategory FROM accounts WHERE number = ?')
  const byName = db.prepare('SELECT 1 FROM accounts WHERE lower(name) = lower(?)')
  const insert = db.prepare(
    `INSERT INTO accounts (number, name, type, subtype, normal_balance, tax_category, accountant_note, created_at, updated_at)
     VALUES (@number, @name, @type, @subtype, @normalBalance, @taxCategory, @accountantNote, @stamp, @stamp)`
  )
  const reserved = new Set<string>()
  const taken = (n: string): boolean => reserved.has(n) || !!byNumber.get(n)
  const result: EntityAccountChanges = { added: [], notAdded: [], covered: [] }
  for (const a of wanted) {
    if (byName.get(a.name)) continue
    let number = a.number
    if (taken(number)) {
      const holder = byNumber.get(number) as { name: string; taxCategory: string | null } | undefined
      if (holder && holder.taxCategory === a.taxCategory) {
        result.covered.push({ number: a.number, name: a.name, by: holder.name })
        continue
      }
      const rangeEnd = Math.floor(Number(a.number) / 1000) * 1000 + 1000
      let candidate = Number(a.number) + 10
      while (candidate < rangeEnd && taken(String(candidate))) candidate += 10
      if (candidate >= rangeEnd) {
        result.notAdded.push({ number: a.number, name: a.name })
        continue
      }
      number = String(candidate)
    }
    reserved.add(number)
    if (stamp) insert.run({ ...a, number, stamp })
    result.added.push({ number, name: a.name, wantedNumber: a.number })
  }
  return result
}

/** Adds the accounts the new entity type needs that the old one didn't have (e.g. Partners'
 * capital, the payroll set). Accounts the old entity type already had are left out, so ones
 * the owner deleted or renumbered don't return. See `placeAccounts` for the rest. */
export function addEntityAccounts(
  db: Database.Database,
  template: TemplateId,
  oldEntity: EntityTypeId,
  newEntity: EntityTypeId,
  now = new Date()
): EntityAccountChanges {
  const oldKeys = new Set(buildChart(template, oldEntity).map((a) => `${a.number}|${a.name.toLowerCase()}`))
  const wanted = buildChart(template, newEntity).filter((a) => !oldKeys.has(`${a.number}|${a.name.toLowerCase()}`))
  return placeAccounts(db, wanted, now.toISOString())
}

/** Standard accounts for this template and entity type that the chart doesn't have (deleted
 * or never added), with the number each would get. */
export function missingAccounts(db: Database.Database, template: TemplateId, entity: EntityTypeId): MissingAccount[] {
  return placeAccounts(db, buildChart(template, entity), null).added
}

/** Adds back the standard accounts with these template numbers (as listed by `missingAccounts`). */
export function restoreAccounts(
  db: Database.Database,
  template: TemplateId,
  entity: EntityTypeId,
  wantedNumbers: string[],
  now = new Date()
): EntityAccountChanges {
  const wanted = buildChart(template, entity).filter((a) => wantedNumbers.includes(a.number))
  return db.transaction(() => placeAccounts(db, wanted, now.toISOString()))()
}

export function accountCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n
}

/** The chart of accounts with tax lines for the company's current return and balances as of `today`. */
export function getChart(db: Database.Database, entity: EntityTypeId, today: string): ChartView {
  const form = getEntityType(entity).taxForm
  const taxYear = Number(today.slice(0, 4))
  const balances = new Map(accountBalances(db, today).map((b) => [b.accountId, b.balanceCents]))
  const rows = db
    .prepare(
      `SELECT a.id, a.number, a.name, a.type, a.subtype, a.normal_balance, a.is_active, a.tax_category,
         a.accountant_note, a.description, a.parent_id,
         EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id = a.id) AS used,
         EXISTS (SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                 WHERE l.account_id = a.id AND e.status <> 'draft') AS posted
       FROM accounts a ORDER BY a.number`
    )
    .all() as {
    id: number
    number: string
    name: string
    type: AccountType
    subtype: string
    normal_balance: NormalBalance
    is_active: number
    tax_category: TaxCategoryKey | null
    accountant_note: string
    description: string
    parent_id: number | null
    used: number
    posted: number
  }[]

  const accounts: ChartAccount[] = rows.map((r) => {
    const raw = balances.get(r.id) ?? 0
    return {
      id: r.id,
      number: r.number,
      name: r.name,
      type: r.type,
      subtype: r.subtype,
      normalBalance: r.normal_balance,
      isActive: r.is_active === 1,
      taxCategory: r.tax_category,
      taxLine: r.tax_category ? getTaxLine(r.tax_category, form, taxYear) : null,
      accountantNote: r.accountant_note,
      description: r.description,
      parentId: r.parent_id,
      balanceCents: r.normal_balance === 'credit' ? 0 - raw : raw,
      usedInEntries: r.used === 1,
      hasPostings: r.posted === 1
    }
  })
  const template = (db.prepare('SELECT template FROM company_profile WHERE id = 1').get() as { template: TemplateId | null })
    .template
  const missing = template ? missingAccounts(db, template, entity) : []
  return { form, taxYear, tableYear: taxTableFor(taxYear).year, accounts, missing }
}
