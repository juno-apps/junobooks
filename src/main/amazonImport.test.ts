import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guessMapping, parseCsv } from '../shared/csvImport'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

const TEXT = readFileSync(join(__dirname, '..', '..', 'samples', 'amazon', 'settlement-24000000001.txt'), 'utf8')
const ETSY = readFileSync(join(__dirname, '..', '..', 'samples', 'etsy', 'etsy_statement_2026_3.csv'), 'utf8')

let root: string
let books: CompanyBooks
const bal = (name: string): number => books.chart().accounts.find((a) => a.name === name)!.balanceCents

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-amazon-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'A',
      entityType: 'smllc',
      homeState: 'CA',
      booksStartDate: '2026-01-01',
      template: 'product'
    })
  )
  books.addAmazonAccounts()
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

function importIt() {
  const p = books.previewAmazon(TEXT)
  return books.importAmazon({ text: TEXT, fileName: 's.txt', mapping: p.mapping, depositAccountId: p.depositAccountId })
}

describe('Amazon import', () => {
  it('adds the Amazon accounts and previews the settlement', () => {
    expect(books.amazonAccounts().every((a) => a.accountId !== null)).toBe(true)
    const p = books.previewAmazon(TEXT)
    expect(p).toMatchObject({
      settlementId: '24000000001',
      newRows: 15,
      days: 4,
      deposit: { date: '2026-03-17', cents: 5939 },
      reserveCents: -252
    })
    expect(p.mapping.referral_fee).toBe(books.chart().accounts.find((a) => a.name === 'Amazon referral fees')!.id)
  })

  it('posts daily entries and the payout; balances add up; re-import skips everything', () => {
    expect(importIt()).toMatchObject({ entries: 4, deposits: 1, rowsImported: 15 })
    expect(bal('Sales')).toBe(8500 + 6000)
    expect(bal('Shipping income')).toBe(500)
    expect(bal('Refunds and returns')).toBe(600 + 2000)
    expect(bal('Amazon referral fees')).toBe(1350 + 810 - 60 - 300)
    expect(bal('Postage and shipping')).toBe(410)
    expect(bal('Amazon other fees')).toBe(3999)
    expect(bal('Sales tax collected by Amazon')).toBe(0)
    expect(bal('Checking account')).toBe(5939)
    expect(bal('Amazon payment account')).toBe(252)
    expect(() => importIt()).toThrow(/already imported/)
  })
})

describe('1099-K tie-out', () => {
  it('compares the typed 1099-K gross with the imported gross per platform and month', () => {
    importIt()
    books.addEtsyAccounts()
    const ep = books.previewEtsy({ statementText: ETSY, ordersText: null })
    books.importEtsy({
      statementText: ETSY,
      ordersText: null,
      fileName: 'e.csv',
      mapping: ep.mapping,
      depositAccountId: ep.depositAccountId
    })
    let rows = books.tieOut1099k(2026)
    const amazon = rows.find((r) => r.platform === 'Amazon')!
    const etsy = rows.find((r) => r.platform === 'Etsy')!
    expect(amazon.importedCents).toBe(8500 + 500 + 698 + 6000)
    expect(amazon.monthlyCents[2]).toBe(amazon.importedCents)
    expect(etsy.importedCents).toBe(6400 + 12000 + 512)
    expect(amazon.formCents).toBeNull()
    rows = books.set1099k(2026, 'Amazon', 16000, 'from the form')
    expect(rows.find((r) => r.platform === 'Amazon')!.differenceCents).toBe(16000 - 15698)
    rows = books.set1099k(2026, 'PayPal', 5000, '')
    expect(rows.find((r) => r.platform === 'PayPal')).toMatchObject({ imported: false, formCents: 5000 })
    rows = books.set1099k(2026, 'PayPal', null, '')
    expect(rows.find((r) => r.platform === 'PayPal')).toBeUndefined()
    expect(books.tieOut1099k(2025)[0].importedCents).toBe(0)
  })

  it('bank import of the payout matches the Amazon payout entry', () => {
    importIt()
    const text = 'Date,Description,Amount\n03/18/2026,AMAZON.COM SERVICES PAYOUT,59.39'
    books.stageImport({
      accountId: books.chart().accounts.find((a) => a.number === '1000')!.id,
      fileName: 'b.csv',
      text,
      mapping: guessMapping(parseCsv(text))
    })
    expect(books.linesToReview()[0].matches[0].memo).toMatch(/Amazon payout/)
    expect(books.amazonPayouts()[0]).toMatchObject({ status: 'waiting', cents: 5939 })
  })
})
