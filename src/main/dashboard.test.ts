import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guessMapping, parseCsv } from '../shared/csvImport'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const num = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id
const post = (date: string, memo: string, lines: [string, number][]) =>
  books.postManualEntry({ date, memo, lines: lines.map(([n, c]) => ({ accountId: num(n), amountCents: c, memo: '' })) })
const NOW = new Date('2026-05-10T12:00:00')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-dash-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'D',
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

describe('dashboard', () => {
  it('shows the year so far, cash, owed both ways, and things to do', () => {
    post('2026-02-01', 'Sale', [
      ['1000', 50000],
      ['4000', -50000]
    ])
    post('2026-02-02', 'Fair sale with tax', [
      ['1000', 10725],
      ['4000', -10000],
      ['2200', -725]
    ])
    post('2026-03-01', 'Materials on card', [
      ['5000', 12000],
      ['2100', -12000]
    ])
    const c = books.addCustomer({ name: 'Shop', email: '', phone: '', address: '', notes: '', isWholesale: false })[0]
      .id
    books.finalizeInvoice(
      books.saveInvoiceDraft(null, {
        number: '1001',
        customerId: c,
        issueDate: '2026-03-01',
        dueDate: '2026-03-31',
        memo: '',
        taxRateMilli: 0,
        taxExempt: false,
        exemptReason: '',
        lines: [
          { description: 'x', quantityMilli: 1000, unitPriceCents: 20000, accountId: num('4000'), taxable: false }
        ]
      }).id
    )
    const text = 'Date,Description,Amount\n04/01/2026,COFFEE,-4.50'
    books.stageImport({ accountId: num('1000'), fileName: 'b.csv', text, mapping: guessMapping(parseCsv(text)) })

    const d = books.dashboard(NOW)
    expect(d).toMatchObject({
      year: 2026,
      salesCents: 80000,
      expensesCents: 12000,
      netIncomeCents: 68000,
      cashTotalCents: 60725
    })
    expect(d.owedToYou).toEqual([{ name: 'Accounts receivable', cents: 20000 }])
    expect(d.youOwe.map((x) => [x.name, x.cents])).toEqual([
      ['Credit card', 12000],
      ['Sales tax payable', 725]
    ])
    const todo = d.todo.map((x) => x.action)
    expect(todo).toEqual(['review', 'invoices', 'reconcile', 'reconcile', 'salesTax', 'close'])
    expect(d.todo[1].text).toBe('1 invoice is overdue ($200.00)')
    expect(d.todo[2].text).toBe('Reconcile Checking account (never reconciled)')
    expect(d.todo[5].text).toContain('close them through 2026-04-30')
  })
})
