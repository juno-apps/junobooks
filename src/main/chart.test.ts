import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENTITY_TYPES, type EntityTypeId, type TaxForm } from '../shared/entities'
import { getTaxCategory, getTaxLine, TAX_CATEGORIES, TAX_LINE_TABLES, taxTableFor } from '../shared/taxLines'
import { buildChart, TEMPLATES, type TemplateId } from '../shared/templates'
import { accountCount, applyChart, getChart } from './chart'
import { createCompany, DB_FILE, openCompany } from './companyStore'
import { getSchemaVersion, LATEST_SCHEMA_VERSION, runMigrations } from './db/migrations'
import { postEntry } from './ledger'

const FORMS: TaxForm[] = ['schedule_c', '1065', '1120s', '1120']
const ALL_COMBOS = TEMPLATES.flatMap((t) => ENTITY_TYPES.map((e) => [t.id, e.id] as [TemplateId, EntityTypeId]))

describe('tax line tables', () => {
  it('map every category on every form, every year', () => {
    for (const table of TAX_LINE_TABLES) {
      for (const form of FORMS) {
        for (const cat of TAX_CATEGORIES) {
          const line = table.forms[form][cat.key]
          expect(line, `${table.year} ${form} ${cat.key}`).toBeDefined()
          expect(line.label.length).toBeGreaterThan(0)
        }
        expect(Object.keys(table.forms[form]).sort()).toEqual(TAX_CATEGORIES.map((c) => c.key).sort())
      }
    }
  })

  it('uses the latest published year for later years, and the earliest for years before any table', () => {
    expect(taxTableFor(2025).year).toBe(2025)
    expect(taxTableFor(2026).year).toBe(2025)
    expect(taxTableFor(2020).year).toBe(2025)
  })

  it('spot-checks lines against the 2025 forms', () => {
    expect(getTaxLine('advertising', 'schedule_c', 2025)).toEqual({ ref: 'Line 8', label: 'Advertising' })
    expect(getTaxLine('meals', 'schedule_c', 2025).ref).toBe('Line 24b')
    expect(getTaxLine('officer_comp', '1120s', 2025).ref).toBe('Line 7')
    expect(getTaxLine('advertising', '1065', 2025).ref).toBe('Line 21')
    expect(getTaxLine('guaranteed_payments', '1065', 2025).ref).toBe('Line 10')
    expect(getTaxLine('officer_comp', '1120', 2025).ref).toBe('Line 12')
    expect(getTaxLine('cash', '1120s', 2025).ref).toBe('Schedule L, line 1')
    expect(getTaxLine('cash', 'schedule_c', 2025).ref).toBeNull()
  })
})

describe('buildChart', () => {
  it.each(ALL_COMBOS)('%s / %s: unique numbers, known categories matching account types', (template, entity) => {
    const chart = buildChart(template, entity)
    const numbers = chart.map((a) => a.number)
    expect(new Set(numbers).size).toBe(numbers.length)
    for (const a of chart) {
      expect(a.number, a.name).toMatch(/^\d{4}$/)
      const cat = getTaxCategory(a.taxCategory)
      expect(cat, `${a.number} ${a.name}`).toBeDefined()
      expect(cat!.accountType, `${a.number} ${a.name}`).toBe(a.type)
      const range = { asset: '1', liability: '2', equity: '3', income: '4', expense: a.subtype === 'cogs' ? '5' : '6' }
      expect(a.number[0], `${a.number} ${a.name}`).toBe(range[a.type])
    }
  })

  it('gives each entity type the right equity and payroll accounts', () => {
    const names = (e: EntityTypeId): string[] => buildChart('general', e).map((a) => a.name)
    expect(names('smllc')).toContain('Owner draws')
    expect(names('smllc')).not.toContain('Officer compensation')
    expect(names('mmllc')).toContain('Guaranteed payments to partners')
    expect(names('s_corp')).toEqual(expect.arrayContaining(['Shareholder distributions', 'Officer compensation', 'Retained earnings']))
    expect(names('llc_s_corp')).toContain("Members' capital")
    expect(names('c_corp')).toEqual(expect.arrayContaining(['Dividends paid', 'Federal income tax']))
  })

  it('adds inventory and cost-of-goods accounts only for product and retail', () => {
    const hasInventory = (t: TemplateId): boolean => buildChart(t, 'smllc').some((a) => a.subtype === 'inventory')
    expect(hasInventory('product')).toBe(true)
    expect(hasInventory('retail')).toBe(true)
    expect(hasInventory('general')).toBe(false)
    expect(hasInventory('service')).toBe(false)
  })

  it('flags every account mapped to "Other expenses" for the accountant', () => {
    for (const [template, entity] of ALL_COMBOS) {
      for (const a of buildChart(template, entity).filter((x) => x.taxCategory === 'other_expenses')) {
        expect(a.accountantNote, a.name).not.toBe('')
      }
    }
  })

  it('marks contra accounts with the opposite normal balance', () => {
    const chart = buildChart('product', 'smllc')
    const side = (n: string): string => chart.find((a) => a.number === n)!.normalBalance
    expect(side('1000')).toBe('debit')
    expect(side('1510')).toBe('credit') // accumulated depreciation
    expect(side('4000')).toBe('credit')
    expect(side('4090')).toBe('debit') // refunds
    expect(side('3200')).toBe('debit') // owner draws
  })
})

describe('applyChart and getChart', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    db.prepare("INSERT INTO company_profile (id, name, books_start_date, created_at) VALUES (1, 'X', '2026-01-01', 'x')").run()
  })
  afterEach(() => db.close())

  it('inserts the chart once and never duplicates or overwrites', () => {
    const expected = buildChart('product', 'smllc').length
    expect(applyChart(db, 'product', 'smllc')).toBe(expected)
    db.prepare("UPDATE accounts SET name = 'Chase checking' WHERE number = '1000'").run()
    expect(applyChart(db, 'product', 'smllc')).toBe(0)
    expect(accountCount(db)).toBe(expected)
    expect(db.prepare("SELECT name FROM accounts WHERE number = '1000'").get()).toEqual({ name: 'Chase checking' })
    expect(db.prepare('SELECT template FROM company_profile').get()).toEqual({ template: 'product' })
  })

  it('adds only the new accounts when the entity type changes', () => {
    applyChart(db, 'product', 'smllc')
    const added = applyChart(db, 'product', 's_corp')
    expect(added).toBeGreaterThan(0)
    const numbers = (db.prepare('SELECT number FROM accounts').all() as { number: string }[]).map((r) => r.number)
    expect(numbers).toContain('6010') // officer compensation
  })

  it('shows tax lines for the current return and balances on the normal side', () => {
    applyChart(db, 'product', 'smllc')
    const id = (n: string): number => (db.prepare('SELECT id FROM accounts WHERE number = ?').get(n) as { id: number }).id
    postEntry(db, {
      date: '2026-03-15',
      lines: [
        { accountId: id('1000'), amountCents: 9_350 },
        { accountId: id('6100'), amountCents: 650 },
        { accountId: id('4000'), amountCents: -10_000 }
      ]
    })
    const chart = getChart(db, 'smllc', '2026-09-25')
    expect(chart).toMatchObject({ form: 'schedule_c', taxYear: 2026, tableYear: 2025 })
    const row = (n: string) => chart.accounts.find((a) => a.number === n)!
    expect(row('4000').balanceCents).toBe(10_000) // income shows positive
    expect(row('1000').balanceCents).toBe(9_350)
    expect(row('6100').taxLine).toEqual({ ref: 'Line 10', label: 'Commissions and fees' })
    expect(row('6100').accountantNote).not.toBe('')

    const asScorp = getChart(db, 's_corp', '2026-09-25')
    expect(asScorp.accounts.find((a) => a.number === '6100')!.taxLine!.ref).toBe('Line 20')
  })
})

describe('companies and charts', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'junobooks-chart-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const input = { name: 'Juno Jewelry', entityType: 'smllc', homeState: 'CA', booksStartDate: '2026-01-01', template: 'product' }

  it('creates a company with its chart in one step', () => {
    const books = openCompany(root, createCompany(root, input))
    expect(books.profile().template).toBe('product')
    expect(books.chart().accounts).toHaveLength(buildChart('product', 'smllc').length)
    books.close()
  })

  it('refuses to create a company without a template', () => {
    expect(() => createCompany(root, { ...input, template: '' })).toThrow(/chart of accounts/)
  })

  it('upgrades a pre-template company, then sets up its chart once', () => {
    const dir = join(root, 'Old Co')
    mkdirSync(join(dir, 'backups'), { recursive: true })
    const v3 = new Database(join(dir, DB_FILE))
    runMigrations(v3, 3)
    v3.prepare("INSERT INTO company_profile VALUES (1, 'Old Co', '2026-01-01', 'x')").run()
    v3.prepare("INSERT INTO entity_type_history (entity_type, effective_date, created_at) VALUES ('s_corp', '2026-01-01', 'x')").run()
    v3.prepare("INSERT INTO home_state_history (state_code, effective_date, created_at) VALUES ('CA', '2026-01-01', 'x')").run()
    v3.close()

    const books = openCompany(root, 'Old Co')
    expect(getSchemaVersion(books.db)).toBe(LATEST_SCHEMA_VERSION)
    expect(books.profile().template).toBeNull()
    expect(() => books.setupChart('nonsense')).toThrow(/Choose/)
    const profile = books.setupChart('general')
    expect(profile.template).toBe('general')
    expect(books.chart().accounts.some((a) => a.name === 'Officer compensation')).toBe(true)
    expect(() => books.setupChart('general')).toThrow(/already has/)

    // The new columns are captured by the audit log.
    const logged = books.db
      .prepare("SELECT new_values FROM audit_log WHERE table_name = 'accounts' AND action = 'insert' LIMIT 1")
      .get() as { new_values: string }
    expect(JSON.parse(logged.new_values)).toHaveProperty('tax_category')
    books.close()
  })
})
