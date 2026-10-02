import { readFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guessMapping, parseCsv } from '../shared/csvImport'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'
import { setLockedThrough } from './ledger'

const sample = (n: string): string => readFileSync(join(__dirname, '..', '..', 'samples', 'etsy', n), 'utf8')
const STATEMENT = sample('etsy_statement_2026_3.csv')
const ORDERS = sample('EtsySoldOrders2026-3.csv')

let root: string
let books: CompanyBooks
const acct = (name: string) => books.chart().accounts.find((a) => a.name === name)!
const bal = (name: string): number => acct(name).balanceCents
const num = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-etsy-'))
  books = openCompany(root, createCompany(root, { name: 'E', entityType: 'smllc', homeState: 'CA', booksStartDate: '2026-01-01', template: 'product' }))
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

function importAll(statementText = STATEMENT, ordersText: string | null = ORDERS) {
  const p = books.previewEtsy({ statementText, ordersText })
  return books.importEtsy({ statementText, ordersText, fileName: 'etsy.csv', mapping: p.mapping, depositAccountId: p.depositAccountId })
}

describe('Etsy accounts', () => {
  it('adds the missing Etsy accounts once, with accountant notes', () => {
    expect(books.etsyAccounts().every((a) => a.accountId === null)).toBe(true)
    const after = books.addEtsyAccounts()
    expect(after.every((a) => a.accountId !== null)).toBe(true)
    expect(acct('Etsy payment account')).toMatchObject({ number: '1210', type: 'asset' })
    expect(acct('Sales tax collected by Etsy').accountantNote).toMatch(/marketplace facilitator/)
    books.addEtsyAccounts()
    expect(books.chart().accounts.filter((a) => a.name.includes('Etsy')).length).toBe(8)
  })
})

describe('previewing and importing a statement', () => {
  beforeEach(() => books.addEtsyAccounts())

  it('previews totals per kind and default accounts', () => {
    const p = books.previewEtsy({ statementText: STATEMENT, ordersText: ORDERS })
    expect(p).toMatchObject({ rows: 14, newRows: 14, alreadyImported: 0, sales: 2, salesWithOrder: 2, ordersRead: 2, days: 8 })
    const total = (t: string) => p.totals.find((x) => x.target === t)?.cents
    expect(total('sale')).toBe(-16600)
    expect(total('shipping')).toBe(-1800)
    expect(total('sales_tax')).toBe(0)
    expect(p.deposits).toEqual([{ date: '2026-03-15', cents: 11065 }])
    expect(p.mapping.sale).toBe(num('4000'))
    expect(p.mapping.clearing).toBe(acct('Etsy payment account').id)
    expect(p.depositAccountId).toBe(num('1000'))
  })

  it('posts daily entries and the deposit, balances add up, and re-importing skips everything', () => {
    const r = importAll()
    expect(r).toMatchObject({ entries: 8, deposits: 1, rowsImported: 14 })
    expect(bal('Sales')).toBe(16600)
    expect(bal('Shipping income')).toBe(1800)
    expect(bal('Refunds and returns')).toBe(2000)
    expect(bal('Etsy transaction fees')).toBe(371 + 42 + 780)
    expect(bal('Etsy payment processing fees')).toBe(217 + 385 - 45)
    expect(bal('Etsy Offsite Ads fees')).toBe(1800)
    expect(bal('Etsy Ads')).toBe(1240)
    expect(bal('Postage and shipping')).toBe(525)
    expect(bal('Etsy listing fees')).toBe(20)
    expect(bal('Etsy other fees')).toBe(13 + 1000)
    expect(bal('Sales tax collected by Etsy')).toBe(0)
    expect(bal('Checking account')).toBe(11065)
    expect(bal('Etsy payment account')).toBe(-1013)
    expect(books.entries().every((e) => e.source === 'etsy')).toBe(true)

    expect(() => importAll()).toThrow(/already imported/)
    expect(books.previewEtsy({ statementText: STATEMENT, ordersText: null }).alreadyImported).toBe(14)
  })

  it('a longer statement later only adds the new rows', () => {
    const lines = STATEMENT.trim().split(/\r?\n/)
    importAll(lines.slice(0, 8).join('\n'))
    const r = importAll()
    expect(r.alreadyImported).toBe(6) // the first 7 lines hold one $0.00 row, which is skipped
    expect(r.rowsImported).toBe(8)
    expect(bal('Sales')).toBe(16600)
  })

  it('refuses a missing account choice, the clearing account for a kind, and a closed period (nothing posted)', () => {
    const p = books.previewEtsy({ statementText: STATEMENT, ordersText: ORDERS })
    const base = { statementText: STATEMENT, ordersText: ORDERS, fileName: 'x', depositAccountId: p.depositAccountId }
    expect(() => books.importEtsy({ ...base, mapping: { ...p.mapping, offsite_ads: null } })).toThrow(/Offsite Ads/)
    expect(() => books.importEtsy({ ...base, mapping: { ...p.mapping, sale: p.mapping.clearing } })).toThrow(/can't use the Etsy payment account/)
    expect(() => books.importEtsy({ ...base, mapping: p.mapping, depositAccountId: null })).toThrow(/Etsy deposits/)
    setLockedThrough(books.db, '2026-03-04')
    expect(() => books.importEtsy({ ...base, mapping: p.mapping })).toThrow()
    expect(books.entries()).toEqual([])
    expect(books.previewEtsy({ statementText: STATEMENT, ordersText: null }).alreadyImported).toBe(0)
  })

  it('remembers account choices and orders for the next import', () => {
    const p = books.previewEtsy({ statementText: STATEMENT, ordersText: ORDERS })
    books.importEtsy({ statementText: STATEMENT, ordersText: ORDERS, fileName: 'x', mapping: { ...p.mapping, shipping_label: num('5300') }, depositAccountId: p.depositAccountId })
    const again = books.previewEtsy({ statementText: STATEMENT, ordersText: null })
    expect(again.mapping.shipping_label).toBe(num('5300'))
    const stored = books.db.prepare('SELECT ship_state FROM marketplace_orders ORDER BY order_id').all()
    expect(stored).toEqual([{ ship_state: 'OR' }, { ship_state: 'TX' }])
  })
})

describe('payouts tie-out', () => {
  it('shows each deposit as missing, waiting in bank review, or matched', () => {
    books.addEtsyAccounts()
    importAll()
    expect(books.etsyPayouts()).toMatchObject([{ date: '2026-03-15', cents: 11065, status: 'missing', depositAccountName: 'Checking account' }])
    const text = 'Date,Description,Amount\n03/16/2026,ETSY INC PAYOUT,110.65'
    books.stageImport({ accountId: num('1000'), fileName: 'bank.csv', text, mapping: guessMapping(parseCsv(text)) })
    expect(books.etsyPayouts()[0]).toMatchObject({ status: 'waiting', bankLineDate: '2026-03-16' })
    const [line] = books.linesToReview()
    expect(line.matches[0].memo).toBe('Etsy deposit to bank')
    books.matchBankLine(line.id, line.matches[0].entryId)
    expect(books.etsyPayouts()[0]).toMatchObject({ status: 'matched', bankLineDate: '2026-03-16' })
  })
})
