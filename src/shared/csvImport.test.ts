import { describe, expect, it } from 'vitest'
import {
  applyMapping,
  dateOrderAmbiguous,
  guessMapping,
  numberedFingerprints,
  parseAmountCell,
  parseCsv,
  parseDateCell
} from './csvImport'

describe('parseCsv', () => {
  it('handles quotes, embedded commas and quotes, CRLF, BOM and blank lines', () => {
    const text = '﻿Date,Description,Amount\r\n03/01/2026,"RIO GRANDE, INC.",-45.10\r\n\r\n03/02/2026,"He said ""hi""",12\r\n'
    expect(parseCsv(text)).toEqual([
      ['Date', 'Description', 'Amount'],
      ['03/01/2026', 'RIO GRANDE, INC.', '-45.10'],
      ['03/02/2026', 'He said "hi"', '12']
    ])
  })

  it('detects semicolon and tab separators', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('cells', () => {
  it('reads dates in each order', () => {
    expect(parseDateCell('3/5/26', 'MDY')).toBe('2026-03-05')
    expect(parseDateCell('05/03/2026', 'DMY')).toBe('2026-03-05')
    expect(parseDateCell('2026-03-05', 'YMD')).toBe('2026-03-05')
    expect(parseDateCell('2026/3/5 10:22:01', 'YMD')).toBe('2026-03-05')
    expect(parseDateCell('13/05/2026', 'MDY')).toBeNull()
    expect(parseDateCell('02/30/2026', 'MDY')).toBeNull()
    expect(parseDateCell('Pending', 'MDY')).toBeNull()
  })

  it('reads amounts in common bank styles', () => {
    expect(parseAmountCell('$1,234.56')).toBe(123456)
    expect(parseAmountCell('-12.00')).toBe(-1200)
    expect(parseAmountCell('(45.10)')).toBe(-4510)
    expect(parseAmountCell('45.10-')).toBe(-4510)
    expect(parseAmountCell('-$7.5')).toBe(-750)
    expect(parseAmountCell('+5')).toBe(500)
    expect(parseAmountCell('')).toBeNull()
    expect(parseAmountCell('12.345')).toBeNull()
    expect(parseAmountCell('abc')).toBeNull()
  })
})

const chaseChecking = parseCsv(`Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,03/02/2026,"RIO GRANDE ALBUQUERQUE NM",-245.10,DEBIT_CARD,4754.90,,
CREDIT,03/03/2026,"ETSY INC PAYOUT",1180.55,ACH_CREDIT,5935.45,,
CHECK,03/05/2026,"CHECK 1043",-300.00,CHECK_PAID,5635.45,1043,`)

const amex = parseCsv(`Date,Description,Amount
03/04/2026,STULLER INC,512.00
03/09/2026,USPS PO 0512,18.40
03/20/2026,AUTOPAY PAYMENT - THANK YOU,-600.00`)

const capitalOne = parseCsv(`Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit
2026-03-04,2026-03-05,1234,ADOBE CREATIVE CLD,Software,54.99,
2026-03-15,2026-03-15,1234,CAPITAL ONE AUTOPAY PYMT,Payment,,200.00`)

const wellsFargo = parseCsv(`"03/02/2026","-45.10","*","","PURCHASE AUTHORIZED ON 03/01 FIRE MOUNTAIN GEMS"
"03/03/2026","800.00","*","","ONLINE TRANSFER FROM SAVINGS"`)

describe('guessMapping + applyMapping', () => {
  it('Chase checking: signed amount column, check number added to the description', () => {
    const m = guessMapping(chaseChecking)
    expect(m).toMatchObject({ hasHeader: true, dateCol: 1, descCol: 2, amountMode: 'single', amountCol: 3, extraCol: 6, flipSign: false })
    const r = applyMapping(chaseChecking, m)
    expect(r.problems).toEqual([])
    expect(r.lines.map((l) => [l.date, l.amountCents])).toEqual([
      ['2026-03-02', -24510],
      ['2026-03-03', 118055],
      ['2026-03-05', -30000]
    ])
    expect(r.lines[2].description).toBe('CHECK 1043')
    const other = applyMapping([['03/01/2026', 'Paper Co', '-5', '881']], { ...m, hasHeader: false, dateCol: 0, descCol: 1, amountCol: 2, extraCol: 3 })
    expect(other.lines[0].description).toBe('Paper Co · 881')
  })

  it('American Express card: charges positive in the file, so the sign flips', () => {
    const m = guessMapping(amex, true)
    expect(m.flipSign).toBe(true)
    const r = applyMapping(amex, m)
    expect(r.lines.map((l) => l.amountCents)).toEqual([-51200, -1840, 60000])
  })

  it('Capital One card: separate debit and credit columns', () => {
    const m = guessMapping(capitalOne, true)
    expect(m).toMatchObject({ amountMode: 'split', outCol: 5, inCol: 6, dateCol: 0, descCol: 3, dateFormat: 'YMD' })
    expect(applyMapping(capitalOne, m).lines.map((l) => l.amountCents)).toEqual([-5499, 20000])
  })

  it('Wells Fargo: no header row', () => {
    const m = guessMapping(wellsFargo)
    expect(m).toMatchObject({ hasHeader: false, dateCol: 0, amountCol: 1, descCol: 4 })
    const r = applyMapping(wellsFargo, m)
    expect(r.lines).toHaveLength(2)
    expect(r.lines[1]).toMatchObject({ row: 2, amountCents: 80000, description: 'ONLINE TRANSFER FROM SAVINGS' })
  })

  it('lists unreadable rows and skips zero rows', () => {
    const rows = parseCsv('Date,Description,Amount\n03/01/2026,A,1.00\nPending,B,2.00\n03/02/2026,C,abc\n03/03/2026,D,0.00')
    const r = applyMapping(rows, guessMapping(rows))
    expect(r.lines).toHaveLength(1)
    expect(r.problems.map((p) => p.row)).toEqual([3, 4])
    expect(r.zeroRows).toBe(1)
  })

  it('flags ambiguous day/month order', () => {
    const rows = parseCsv('Date,Description,Amount\n03/04/2026,A,1\n05/06/2026,B,2')
    expect(dateOrderAmbiguous(rows, 0, true)).toBe(true)
    expect(dateOrderAmbiguous(amex, 0, true)).toBe(false)
  })
})

describe('fingerprints', () => {
  it('number repeats within a file so identical genuine charges both count', () => {
    const l = { date: '2026-03-01', amountCents: -500, description: 'Coffee  Shop' }
    const fps = numberedFingerprints([l, { ...l, description: 'COFFEE SHOP' }, { ...l, amountCents: -600 }])
    expect(fps[0]).toBe('2026-03-01|-500|coffeeshop#1')
    expect(fps[1]).toBe('2026-03-01|-500|coffeeshop#2')
    expect(fps[2]).toBe('2026-03-01|-600|coffeeshop#1')
  })
})
