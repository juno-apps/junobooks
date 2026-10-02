import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { quarters, rateOn } from '../shared/salesTax'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

const ETSY = readFileSync(join(__dirname, '..', '..', 'samples', 'etsy', 'etsy_statement_2026_3.csv'), 'utf8')

let root: string
let books: CompanyBooks
const num = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-stax-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'T',
      entityType: 'smllc',
      homeState: 'CA',
      booksStartDate: '2026-01-01',
      template: 'product'
    })
  )
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

describe('rates as dated data', () => {
  it('the rate in force is the latest started on or before the date', () => {
    books.addSalesTaxRate({
      stateCode: 'CA',
      place: 'San Diego',
      rateMilli: 7750,
      effectiveDate: '2026-01-01',
      notes: ''
    })
    books.addSalesTaxRate({
      stateCode: 'CA',
      place: 'San Diego',
      rateMilli: 8000,
      effectiveDate: '2026-04-01',
      notes: 'district rate change'
    })
    expect(books.homeRateOn('2026-03-31')!.rateMilli).toBe(7750)
    expect(books.homeRateOn('2026-04-01')!.rateMilli).toBe(8000)
    expect(books.homeRateOn('2025-12-31')).toBeNull()
    expect(() =>
      books.addSalesTaxRate({
        stateCode: 'CA',
        place: 'San Diego',
        rateMilli: 1,
        effectiveDate: '2026-04-01',
        notes: ''
      })
    ).toThrow(/already a rate/)
    expect(rateOn(books.salesTaxRates(), 'TX', '2026-05-01')).toBeNull()
    expect(quarters(2026)[1]).toEqual({ label: 'Q2 2026', from: '2026-04-01', to: '2026-06-30' })
  })
})

describe('sales tax report', () => {
  it('separates marketplace, resale and taxable sales, and compares tax charged with tax at the rate', () => {
    books.addSalesTaxRate({ stateCode: 'CA', place: '', rateMilli: 7250, effectiveDate: '2026-01-01', notes: '' })
    // Etsy sales (marketplace collected the tax)
    books.addEtsyAccounts()
    const ep = books.previewEtsy({ statementText: ETSY, ordersText: null })
    books.importEtsy({
      statementText: ETSY,
      ordersText: null,
      fileName: 'e.csv',
      mapping: ep.mapping,
      depositAccountId: ep.depositAccountId
    })
    // A wholesale invoice with a certificate, an exempt one without, and a taxable retail invoice
    const shop = books
      .addCustomer({ name: 'Shop', email: '', phone: '', address: '', notes: '', isWholesale: true })
      .find((c) => c.name === 'Shop')!.id
    books.addCertificate({
      customerId: shop,
      certNumber: 'SR 1',
      stateCode: 'CA',
      issuedDate: '2026-01-01',
      expiresDate: null,
      notes: '',
      filePath: null
    })
    const other = books
      .addCustomer({ name: 'Other', email: '', phone: '', address: '', notes: '', isWholesale: false })
      .find((c) => c.name === 'Other')!.id
    const inv = (customerId: number, number: string, cents: number, exempt: boolean) =>
      books.finalizeInvoice(
        books.saveInvoiceDraft(null, {
          number,
          customerId,
          issueDate: '2026-02-10',
          dueDate: '2026-03-10',
          memo: '',
          taxRateMilli: exempt ? 0 : 7250,
          taxExempt: exempt,
          exemptReason: exempt ? 'resale' : '',
          lines: [
            { description: 'x', quantityMilli: 1000, unitPriceCents: cents, accountId: num('4000'), taxable: true }
          ]
        }).id
      )
    inv(shop, '1001', 50000, true)
    inv(other, '1002', 2000, true)
    inv(other, '1003', 10000, false)
    // A cash sale typed on the Income screen, with tax
    books.postManualEntry({
      date: '2026-03-20',
      memo: 'Craft fair',
      lines: [
        { accountId: num('1000'), amountCents: 21450, memo: '' },
        { accountId: num('4000'), amountCents: -20000, memo: '' },
        { accountId: num('2200'), amountCents: -1450, memo: '' }
      ]
    })
    // A non-marketplace refund
    books.postManualEntry({
      date: '2026-03-25',
      memo: 'Refund',
      lines: [
        { accountId: num('4090'), amountCents: 3000, memo: '' },
        { accountId: num('1000'), amountCents: -3000, memo: '' }
      ]
    })

    const r = books.salesTaxReport('2026-01-01', '2026-03-31')
    const etsySales = 6400 + 12000
    expect(r.grossSalesCents).toBe(etsySales + 50000 + 2000 + 10000 + 20000)
    expect(r.marketplaceCents).toBe(etsySales)
    expect(r.marketplaceByChannel).toEqual([{ channel: 'etsy', cents: etsySales }])
    expect(r.resale.map((x) => [x.number, x.certificate])).toEqual([['1001', 'SR 1 (CA)']])
    expect(r.otherExempt.map((x) => x.number)).toEqual(['1002'])
    expect(r.refundsCents).toBe(3000)
    expect(r.taxableCents).toBe(10000 + 20000 - 3000)
    expect(r.computedTaxCents).toBe(Math.round(10000 * 0.0725) + Math.round((20000 - 3000) * 0.0725))
    expect(r.chargedCents).toBe(725 + 1450)
    expect(r.owedAtEndCents).toBe(725 + 1450)
    expect(r.months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(r.missingRate).toBe(false)

    books.recordSalesTaxPayment({ date: '2026-04-28', amountCents: 2175, bankAccountId: num('1000'), memo: 'Q1 CDTFA' })
    const q2 = books.salesTaxReport('2026-04-01', '2026-06-30')
    expect(q2.paidCents).toBe(2175)
    expect(q2.owedAtEndCents).toBe(0)
  })

  it('flags a missing rate', () => {
    books.postManualEntry({
      date: '2026-01-05',
      memo: 'Sale',
      lines: [
        { accountId: num('1000'), amountCents: 100, memo: '' },
        { accountId: num('4000'), amountCents: -100, memo: '' }
      ]
    })
    expect(books.salesTaxReport('2026-01-01', '2026-01-31').missingRate).toBe(true)
  })
})
