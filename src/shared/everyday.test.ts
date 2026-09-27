import { describe, expect, it } from 'vitest'
import type { ChartAccount } from './chart'
import { buildExpense, expenseCategoryGroups, expenseTotal, filterGroups, paidFromGroups } from './everyday'

function acct(id: number, name: string, type: ChartAccount['type'], extra: Partial<ChartAccount> = {}): ChartAccount {
  return {
    id,
    number: String(id),
    name,
    type,
    subtype: '',
    normalBalance: type === 'asset' || type === 'expense' ? 'debit' : 'credit',
    isActive: true,
    taxCategory: null,
    taxLine: null,
    accountantNote: '',
    description: '',
    balanceCents: 0,
    usedInEntries: false,
    hasPostings: false,
    ...extra
  } as ChartAccount
}

const chart = [
  acct(1, 'Checking', 'asset', { subtype: 'bank', taxCategory: 'cash' }),
  acct(2, 'Petty cash', 'asset', { taxCategory: 'cash' }),
  acct(3, 'Inventory', 'asset', { subtype: 'inventory' }),
  acct(4, 'Equipment', 'asset', { subtype: 'fixed_asset' }),
  acct(5, 'Accounts payable', 'liability', { taxCategory: 'accounts_payable' }),
  acct(6, 'Credit card', 'liability', { subtype: 'credit_card' }),
  acct(7, 'Owner contributions', 'equity'),
  acct(8, 'Supplies', 'expense'),
  acct(9, 'Materials', 'expense', { subtype: 'cogs' }),
  acct(10, 'Old account', 'expense', { isActive: false }),
  acct(11, 'Sales', 'income')
]

describe('paidFromGroups', () => {
  it('groups bank/cash, cards, bills and other balance-sheet accounts; skips inactive and income/expense', () => {
    const g = paidFromGroups(chart)
    expect(g.map((x) => [x.title.split(' (')[0], x.accounts.map((a) => a.name)])).toEqual([
      ['Bank and cash', ['Checking', 'Petty cash']],
      ['Credit cards', ['Credit card']],
      ['Not paid yet', ['Accounts payable']],
      ['Other accounts', ['Inventory', 'Equipment', 'Owner contributions']]
    ])
  })
})

describe('expenseCategoryGroups', () => {
  it('offers expenses, cost of goods sold, and inventory/equipment, but not inactive accounts', () => {
    expect(expenseCategoryGroups(chart).map((x) => [x.title, x.accounts.map((a) => a.name)])).toEqual([
      ['Expenses', ['Supplies']],
      ['Cost of goods sold', ['Materials']],
      ['Inventory and equipment', ['Inventory', 'Equipment']]
    ])
  })
})

const line = (accountId: number | null, amount: string, memo = '') => ({ accountId, amount, memo })

describe('buildExpense', () => {
  it('debits the category and credits what it was paid from', () => {
    const r = buildExpense({
      date: '2026-03-05',
      paidTo: ' Staples ',
      paidFromId: 1,
      lines: [line(8, '42.10', ' pens '), line(null, '')]
    })
    expect(r).toEqual({
      entry: {
        date: '2026-03-05',
        memo: 'Staples',
        lines: [
          { accountId: 8, amountCents: 4_210, memo: 'pens' },
          { accountId: 1, amountCents: -4_210, memo: '' }
        ]
      }
    })
  })

  it('splits across categories with one credit for the total', () => {
    const r = buildExpense({ date: '2026-03-05', paidTo: '', paidFromId: 6, lines: [line(8, '10'), line(9, '5.50')] })
    expect('entry' in r && r.entry.lines.map((l) => l.amountCents)).toEqual([1_000, 550, -1_550])
    expect(expenseTotal([line(8, '10'), line(9, '5.50'), line(9, 'abc')])).toBe(1_550)
  })

  it('explains each problem in plain English', () => {
    const f = { date: '2026-03-05', paidTo: '', paidFromId: 1, lines: [line(8, '5')] }
    expect(buildExpense({ ...f, date: 'nope' })).toEqual({ error: 'Enter a valid date.' })
    expect(buildExpense({ ...f, paidFromId: null })).toEqual({ error: 'Choose how you paid.' })
    expect(buildExpense({ ...f, lines: [line(null, ''), line(null, '')] })).toEqual({
      error: 'Enter what it was for and how much.'
    })
    expect(buildExpense({ ...f, lines: [line(null, '5')] })).toEqual({ error: 'choose what it was for.' })
    expect(buildExpense({ ...f, lines: [line(8, '')] })).toEqual({ error: 'enter an amount.' })
    expect(buildExpense({ ...f, lines: [line(8, '0')] })).toEqual({ error: "amount can't be zero." })
    expect(buildExpense({ ...f, lines: [line(8, '5'), line(9, '-1')] })).toEqual({
      error: "Line 2: amounts can't be negative."
    })
    expect(buildExpense({ ...f, lines: [line(1, '5')] })).toEqual({
      error: "The account you paid from can't also be what it was for."
    })
  })
})

describe('filterGroups', () => {
  const names = (text: string) => filterGroups(paidFromGroups(chart), text).flatMap((g) => g.accounts.map((a) => a.name))
  it('narrows by any typed words, in any order, ignoring case, and drops empty groups', () => {
    expect(names('')).toHaveLength(7)
    expect(names('CARD')).toEqual(['Credit card'])
    expect(names('cash petty')).toEqual(['Petty cash'])
    expect(names('2')).toEqual(['Petty cash'])
    expect(filterGroups(paidFromGroups(chart), 'check').map((g) => g.title)).toEqual(['Bank and cash'])
    expect(names('zzz')).toEqual([])
  })
})
