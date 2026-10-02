import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const num = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id
const post = (date: string, memo: string, lines: [string, number][]) =>
  books.postManualEntry({ date, memo, lines: lines.map(([n, c]) => ({ accountId: num(n), amountCents: c, memo: '' })) })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-rx-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'X',
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

describe('sales by channel', () => {
  it('groups sales income and refunds by where they came from', () => {
    post('2026-02-01', 'Fair', [
      ['1000', 5000],
      ['4000', -5000]
    ])
    post('2026-02-02', 'Refund', [
      ['4090', 500],
      ['1000', -500]
    ])
    const c = books.addCustomer({ name: 'Shop', email: '', phone: '', address: '', notes: '', isWholesale: false })[0]
      .id
    books.finalizeInvoice(
      books.saveInvoiceDraft(null, {
        number: '1001',
        customerId: c,
        issueDate: '2026-02-05',
        dueDate: '2026-03-05',
        memo: '',
        taxRateMilli: 0,
        taxExempt: false,
        exemptReason: '',
        lines: [
          { description: 'x', quantityMilli: 1000, unitPriceCents: 20000, accountId: num('4000'), taxable: false }
        ]
      }).id
    )
    const r = books.salesByChannel('2026-01-01', '2026-12-31')
    expect(r.channels.map((x) => [x.name, x.salesCents, x.refundsCents, x.netCents])).toEqual([
      ['Invoices (direct sales)', 20000, 0, 20000],
      ['Typed in (New income, journal entries)', 5000, 500, 4500]
    ])
    expect(r.totalNetCents).toBe(24500)
  })
})

describe('tax-line summary', () => {
  it('groups accounts by Schedule C line, with balance-sheet lines and unmapped accounts', () => {
    post('2026-02-01', 'Sale', [
      ['1000', 5000],
      ['4000', -5000]
    ])
    post('2026-02-02', 'Ship', [
      ['1000', 700],
      ['4010', -700]
    ])
    post('2026-02-03', 'Fees', [
      ['6100', 300],
      ['1000', -300]
    ])
    // An account without a tax category (possible in older files) is listed as not mapped.
    books.db
      .prepare(
        "INSERT INTO accounts (number, name, type, subtype, normal_balance, created_at, updated_at) VALUES ('6999', 'Mystery', 'expense', '', 'debit', 'x', 'x')"
      )
      .run()
    post('2026-02-04', 'Odd', [
      ['6999', 100],
      ['1000', -100]
    ])
    const s = books.taxLineSummary(2026)
    expect(s.formLabel).toMatch(/Schedule C/)
    const line1 = s.lines.find((l) => l.ref === 'Line 1')!
    expect(line1.cents).toBe(5700)
    expect(line1.accounts.map((a) => a.number)).toEqual(['4000', '4010'])
    expect(s.lines.find((l) => l.ref === 'Line 10')!.cents).toBe(300)
    expect(s.lines.some((l) => l.part === 'balance')).toBe(true)
    expect(s.unmapped.map((u) => u.number)).toEqual(['6999'])
  })
})

describe('cost of goods sold schedule', () => {
  it('beginning + purchases + labor + materials + other − ending equals cost of goods sold in the books', () => {
    books.saveOpeningBalances([{ accountId: num('1300'), amountCents: 20000 }])
    post('2026-03-01', 'Silver', [
      ['5000', 35000],
      ['1000', -35000]
    ])
    post('2026-03-02', 'Boxes', [
      ['5300', 2000],
      ['1000', -2000]
    ])
    post('2026-03-03', 'Stones into stock', [
      ['1300', 4000],
      ['1000', -4000]
    ])
    // Year-end: count says 29,000 on hand (FIFO), post the adjustment.
    const item = books.addInventoryItem({ name: 'Silver', unit: 'g', notes: '' }).items[0].id
    books.addInventoryPurchase({
      itemId: item,
      date: '2026-01-01',
      quantityMilli: 100000,
      costCents: 20000,
      isOpening: true,
      memo: ''
    })
    books.addInventoryPurchase({
      itemId: item,
      date: '2026-03-01',
      quantityMilli: 100000,
      costCents: 35000,
      isOpening: false,
      memo: ''
    })
    books.saveCount('2026-12-31', [{ itemId: item, quantityMilli: 82857 }])
    books.setFiledMethod(2026, 'fifo', '')
    const { inventoryAccountId, cogsAccountId } = books.inventoryAdjustmentAccounts()
    books.postInventoryAdjustment(2026, inventoryAccountId!, cogsAccountId!)

    const s = books.cogsSchedule(2026)
    expect(s.beginningCents).toBe(20000)
    expect(s.materialsCents).toBe(35000)
    expect(s.otherCents).toBe(2000)
    expect(s.purchasesCents).toBe(4000)
    expect(s.endingCents).toBe(29000)
    expect(s.filedMethod).toMatch(/FIFO/)
    expect(s.yearEndEntryPosted).toBe(true)
    const pl = books.profitAndLoss('2026-01-01', '2026-12-31')
    expect(s.cogsCents).toBe(pl.cogs.total[0])
  })
})
