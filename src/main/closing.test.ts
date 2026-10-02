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
const JAN_2027 = new Date('2027-01-15T12:00:00')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-close-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'C',
      entityType: 'smllc',
      homeState: 'CA',
      booksStartDate: '2026-01-01',
      template: 'product'
    })
  )
  post('2026-03-01', 'Sale', [
    ['1000', 50000],
    ['4000', -50000]
  ])
  post('2026-04-01', 'Materials', [
    ['5000', 12000],
    ['1000', -12000]
  ])
  post('2026-05-01', 'Ads', [
    ['6000', 3000],
    ['1000', -3000]
  ])
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

describe('closing the books through a date', () => {
  it('closes and reopens with a reason, keeping history', () => {
    let v = books.setBooksClosed('2026-03-31', '')
    expect(v.lockedThrough).toBe('2026-03-31')
    expect(() =>
      post('2026-03-15', 'late', [
        ['6000', 1],
        ['1000', -1]
      ])
    ).toThrow(/closed through/)
    expect(() => books.setBooksClosed('2026-01-31', '')).toThrow(/reason/)
    v = books.setBooksClosed('2026-01-31', 'Forgot a receipt')
    expect(v.history.map((h) => h.lockedThrough)).toEqual(['2026-01-31', '2026-03-31'])
    expect(() => books.setBooksClosed('2999-01-01', '')).toThrow(/hasn't ended/)
  })
})

describe('year-end close', () => {
  it('moves income and expenses into equity, locks the year, and the year’s reports still show the activity', () => {
    const info = books.yearCloseInfo(2026, JAN_2027)
    expect(info).toMatchObject({ netIncomeCents: 35000, existingEntryId: null, ended: true })
    expect(info.defaultEquityAccountId).toBe(num('3000'))
    expect(() => books.closeYear(2026, num('3000'))).toThrow(/hasn't ended/) // today is in 2026
    const v = books.closeYear(2026, num('3000'), JAN_2027)
    expect(v.lockedThrough).toBe('2026-12-31')
    expect(v.closings).toEqual([
      expect.objectContaining({ year: 2026, equityAccount: "Owner's capital", netIncomeCents: 35000 })
    ])

    const pl = books.profitAndLoss('2026-01-01', '2026-12-31')
    expect(pl.netIncome).toEqual([35000])
    const bs = books.balanceSheet('2026-12-31')
    expect(bs.equity.total[0]).toBe(35000)
    expect(bs.currentYearProfit).toBe(0)
    expect(bs.balanced).toBe(true)
    const tb = books.trialBalance('2026-12-31')
    expect(tb.rows.find((r) => r.number === '4000')!.credit).toBe(50000) // before closing at year end
    expect(books.taxLineSummary(2026).lines.find((l) => l.ref === 'Line 1')!.cents).toBe(50000)
    expect(books.salesByChannel('2026-01-01', '2026-12-31').totalSalesCents).toBe(50000)
    expect(books.cogsSchedule(2026).cogsCents).toBe(12000)
    // Next year starts clean.
    expect(books.balanceSheet('2027-01-31').priorYearsProfit).toBe(0)
  })

  it('redo after reopening replaces the closing entry; refuses Opening balance equity', () => {
    books.closeYear(2026, num('3000'), JAN_2027)
    expect(() => books.closeYear(2026, num('3000'), JAN_2027)).toThrow(/Reopen 2026/)
    books.setBooksClosed('2026-11-30', 'Late invoice', JAN_2027)
    post('2026-12-20', 'Late sale', [
      ['1000', 1000],
      ['4000', -1000]
    ])
    expect(() => books.closeYear(2026, num('3999'), JAN_2027)).toThrow(/not Opening balance equity/)
    const v = books.closeYear(2026, num('3000'), JAN_2027)
    expect(v.closings).toHaveLength(1)
    expect(v.closings[0].netIncomeCents).toBe(36000)
    expect(
      books
        .entries()
        .filter((e) => e.source === 'closing')
        .map((e) => e.status)
        .sort()
    ).toEqual(['posted', 'void'])
  })
})
