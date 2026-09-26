import { describe, expect, it } from 'vitest'
import { blankRow, mirrorPair, rowsToLines, rowTotals, type EntryRow } from './journal'

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

describe('mirrorPair', () => {
  const edit = (rows: EntryRow[], i: number, patch: Partial<EntryRow>) =>
    mirrorPair(rows, rows.map((r, j) => (j === i ? { ...r, ...patch } : r)), i)

  it('keeps a balanced two-line entry balanced when line 1 changes', () => {
    const rows = [row(1, '100'), row(2, '', '100'), blankRow()]
    expect(edit(rows, 0, { debit: '150' }).map((r) => [r.debit, r.credit])).toEqual([
      ['150', ''],
      ['', '150'],
      ['', '']
    ])
    expect(edit([row(1, '', '20'), row(2, '20')], 0, { credit: '25' })[1].debit).toBe('25')
  })
  it('never changes an earlier line, so a split can be typed on line 2', () => {
    const rows = [row(1, '100'), row(2, '', '100')]
    expect(edit(rows, 1, { credit: '60' })[0].debit).toBe('100')
  })
  it('leaves unbalanced entries, three-line entries and side switches alone', () => {
    expect(edit([row(1, '100'), row(2, '', '60')], 0, { debit: '90' })[1].credit).toBe('60')
    const three = [row(1, '100'), row(2, '', '60'), row(3, '', '40')]
    expect(edit(three, 0, { debit: '90' })).toEqual([row(1, '90'), row(2, '', '60'), row(3, '', '40')])
    expect(edit([row(1, '100'), row(2, '', '100')], 0, { debit: '', credit: '100' })[1].credit).toBe('100')
  })
})
