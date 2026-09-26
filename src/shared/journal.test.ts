import { describe, expect, it } from 'vitest'
import { blankRow, rowsToLines, rowTotals, type EntryRow } from './journal'

function row(accountId: number | null, debit = '', credit = '', memo = ''): EntryRow {
  return { accountId, debit, credit, memo }
}

describe('rowTotals', () => {
  it('adds debits and credits and ignores unreadable boxes', () => {
    const t = rowTotals([row(1, '1,000.50'), row(2, '', '400'), row(3, 'abc'), row(4, '', '-5')])
    expect(t).toEqual({ debits: 100_050, credits: 40_000, difference: 60_050 })
  })
})

describe('rowsToLines', () => {
  it('turns debits positive and credits negative, skipping blank rows', () => {
    const r = rowsToLines([row(1, '42.10', '', ' supplies '), blankRow(), row(2, '', '42.10'), blankRow()])
    expect(r).toEqual({
      lines: [
        { accountId: 1, amountCents: 4_210, memo: 'supplies' },
        { accountId: 2, amountCents: -4_210, memo: '' }
      ]
    })
  })
  it('needs an account on every used row', () => {
    expect(rowsToLines([row(null, '5'), row(2, '', '5')])).toEqual({ error: 'Line 1: choose an account.' })
  })
  it('refuses a row with both a debit and a credit', () => {
    expect(rowsToLines([row(1, '5', '5'), row(2, '', '5')])).toEqual({
      error: 'Line 1: fill in a debit or a credit, not both.'
    })
  })
  it('refuses a missing, unreadable, negative or zero amount', () => {
    expect(rowsToLines([row(1), row(2, '', '5')])).toEqual({ error: 'Line 1: enter an amount.' })
    expect(rowsToLines([row(1, '5'), row(2, '', '5.001')])).toEqual({ error: 'Line 2: "5.001" isn\'t an amount.' })
    expect('error' in rowsToLines([row(1, '-5'), row(2, '5')])).toBe(true)
    expect(rowsToLines([row(1, '0'), row(2, '', '0')])).toEqual({ error: "Line 1: amount can't be zero." })
  })
  it('needs at least two lines', () => {
    expect(rowsToLines([row(1, '5'), blankRow()])).toEqual({ error: 'An entry needs at least two lines.' })
  })
})
