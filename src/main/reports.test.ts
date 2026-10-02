import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toCsv, plainCents } from '../shared/reports'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const num = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-rep-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'R',
      entityType: 'smllc',
      homeState: 'CA',
      booksStartDate: '2025-01-01',
      template: 'product'
    })
  )
  const post = (date: string, memo: string, lines: [string, number][]) =>
    books.postManualEntry({
      date,
      memo,
      lines: lines.map(([n, c]) => ({ accountId: num(n), amountCents: c, memo: '' }))
    })
  books.saveOpeningBalances([{ accountId: num('1000'), amountCents: 100000 }])
  post('2025-06-01', 'Old sale', [
    ['1000', 5000],
    ['4000', -5000]
  ])
  post('2026-01-10', 'Sale', [
    ['1000', 30000],
    ['4000', -30000]
  ])
  post('2026-01-12', 'Shipping', [
    ['1000', 1500],
    ['4010', -1500]
  ])
  post('2026-02-03', 'Materials', [
    ['5000', 8000],
    ['2100', -8000]
  ])
  post('2026-02-20', 'Refund', [
    ['4090', 2000],
    ['1000', -2000]
  ])
  post('2026-03-01', 'Ads', [
    ['6000', 1200],
    ['1000', -1200]
  ])
  const v = post('2026-03-02', 'Mistake', [
    ['6650', 999],
    ['1000', -999]
  ])
  books.voidEntry(v, 'typo')
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

describe('profit and loss', () => {
  it('income, cost of goods sold, expenses and net income for a period (voided entries never count)', () => {
    const pl = books.profitAndLoss('2026-01-01', '2026-03-31')
    expect(pl.columns).toEqual(['Total'])
    expect(pl.income.rows.map((r) => [r.number, r.values[0]])).toEqual([
      ['4000', 30000],
      ['4010', 1500],
      ['4090', -2000]
    ])
    expect(pl.income.total).toEqual([29500])
    expect(pl.cogs.total).toEqual([8000])
    expect(pl.grossProfit).toEqual([21500])
    expect(pl.expenses.rows.map((r) => r.number)).toEqual(['6000'])
    expect(pl.netIncome).toEqual([20300])
  })

  it('month columns add up to the total', () => {
    const pl = books.profitAndLoss('2026-01-01', '2026-03-31', true)
    expect(pl.columns).toEqual(['2026-01', '2026-02', '2026-03', 'Total'])
    expect(pl.netIncome).toEqual([31500, -10000, -1200, 20300])
  })
})

describe('balance sheet and trial balance', () => {
  it('balances, splitting this year’s profit from earlier years', () => {
    const bs = books.balanceSheet('2026-03-31')
    expect(bs.assets.total).toEqual([100000 + 5000 + 30000 + 1500 - 2000 - 1200])
    expect(bs.liabilities.total).toEqual([8000])
    expect(bs.equity.total).toEqual([100000])
    expect(bs.currentYearProfit).toBe(20300)
    expect(bs.priorYearsProfit).toBe(5000)
    expect(bs.balanced).toBe(true)
  })

  it('trial balance debits equal credits', () => {
    const tb = books.trialBalance('2026-03-31')
    expect(tb.totalDebit).toBe(tb.totalCredit)
    expect(tb.rows.find((r) => r.number === '2100')).toMatchObject({ debit: 0, credit: 8000 })
  })
})

describe('general ledger', () => {
  it('lists each account with activity, opening balance, lines and closing balance', () => {
    const gl = books.generalLedger('2026-01-01', '2026-03-31')
    const checking = gl.accounts.find((a) => a.number === '1000')!
    expect(checking.opening).toBe(105000)
    expect(checking.lines.map((l) => [l.debit, l.credit])).toEqual([
      [30000, 0],
      [1500, 0],
      [0, 2000],
      [0, 1200]
    ])
    expect(checking.closing).toBe(133300)
    expect(gl.accounts.some((a) => a.number === '6650')).toBe(false) // only a voided line
    expect(gl.accounts.find((a) => a.number === '3999')!.lines).toEqual([]) // balance only
  })
})

describe('csv', () => {
  it('quotes cells that need it and writes plain amounts', () => {
    expect(
      toCsv([
        ['a', 'b,c', 'say "hi"'],
        [1, plainCents(-5)]
      ])
    ).toBe('a,"b,c","say ""hi"""\r\n1,-0.05\r\n')
  })
})
