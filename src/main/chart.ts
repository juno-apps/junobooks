import type Database from 'better-sqlite3'
import type { ChartAccount, ChartView } from '../shared/chart'
import { getEntityType, type EntityTypeId } from '../shared/entities'
import { getTaxLine, taxTableFor, type AccountType, type TaxCategoryKey } from '../shared/taxLines'
import { buildChart, type NormalBalance, type TemplateId } from '../shared/templates'
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
         a.accountant_note, a.description,
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
      balanceCents: r.normal_balance === 'credit' ? -raw : raw,
      usedInEntries: r.used === 1,
      hasPostings: r.posted === 1
    }
  })
  return { form, taxYear, tableYear: taxTableFor(taxYear).year, accounts }
}
