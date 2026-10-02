import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const id = (number: string): number => books.chart().accounts.find((a) => a.number === number)!.id

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-register-'))
  const folder = createCompany(root, { name: 'Reg Co', entityType: 'smllc', homeState: 'CA', booksStartDate: '2026-01-01', template: 'product' })
  books = openCompany(root, folder)
})

afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

function post(date: string, memo: string, lines: [string, number][]): number {
  return books.postManualEntry({ date, memo, lines: lines.map(([n, c]) => ({ accountId: id(n), amountCents: c, memo: '' })) })
}

describe('accountRegister', () => {
  it('lists lines oldest first with a running balance on the normal side', () => {
    post('2026-02-01', 'Sale', [['1000', 10000], ['4000', -10000]])
    post('2026-01-15', 'Supplies', [['6650', 2500], ['1000', -2500]])
    const r = books.register({ accountId: id('1000') })
    expect(r.rows.map((x) => [x.date, x.increaseCents, x.decreaseCents, x.balanceCents])).toEqual([
      ['2026-01-15', 0, 2500, -2500],
      ['2026-02-01', 10000, 0, 7500]
    ])
    expect(r.rows[1].otherSide).toBe('Sales')
    expect(r.closingCents).toBe(7500)

    // A credit-side account (income) increases on credits.
    const inc = books.register({ accountId: id('4000') })
    expect(inc.rows[0].increaseCents).toBe(10000)
    expect(inc.closingCents).toBe(10000)
  })

  it('starts a date range from the balance carried forward', () => {
    post('2026-01-10', 'A', [['1000', 5000], ['4000', -5000]])
    post('2026-03-10', 'B', [['1000', 2000], ['4000', -2000]])
    post('2026-05-10', 'C', [['1000', 1000], ['4000', -1000]])
    const r = books.register({ accountId: id('1000'), from: '2026-03-01', to: '2026-03-31' })
    expect(r.openingCents).toBe(5000)
    expect(r.rows).toHaveLength(1)
    expect(r.closingCents).toBe(7000)
  })

  it('shows splits, and voided entries only on request without moving the balance', () => {
    post('2026-01-10', 'Split', [['1000', -3000], ['6650', 1000], ['6000', 2000]])
    const v = post('2026-01-11', 'Mistake', [['1000', -999], ['6650', 999]])
    books.voidEntry(v, 'typo')
    const hidden = books.register({ accountId: id('1000') })
    expect(hidden.rows).toHaveLength(1)
    expect(hidden.rows[0].otherSide).toBe('Split (2 accounts)')
    const shown = books.register({ accountId: id('1000'), includeVoided: true })
    expect(shown.rows).toHaveLength(2)
    expect(shown.rows[1].status).toBe('void')
    expect(shown.rows[1].balanceCents).toBe(-3000)
  })

  it('refuses bad dates', () => {
    expect(() => books.register({ accountId: id('1000'), from: '2026-05-01', to: '2026-04-01' })).toThrow(/after/)
    expect(() => books.register({ accountId: id('1000'), from: '2026-13-01' })).toThrow(/valid date/)
  })
})
