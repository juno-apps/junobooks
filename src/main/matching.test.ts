import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guessMapping, parseCsv } from '../shared/csvImport'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const id = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id
const bal = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.balanceCents

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-match-'))
  books = openCompany(root, createCompany(root, { name: 'M', entityType: 'smllc', homeState: 'CA', booksStartDate: '2026-01-01', template: 'product' }))
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

function typed(date: string, memo: string, cents: number, other = '5000', bank = '1000'): number {
  return books.postManualEntry({
    date,
    memo,
    lines: [
      { accountId: id(bank), amountCents: cents, memo: '' },
      { accountId: id(other), amountCents: -cents, memo: '' }
    ]
  })
}

function importLines(csv: string, account = '1000', isCard = false): void {
  const text = `Date,Description,Amount\n${csv}`
  books.stageImport({ accountId: id(account), fileName: 'x.csv', text, mapping: guessMapping(parseCsv(text), isCard) })
}

describe('matching imported lines to entries already in the books', () => {
  it('suggests entries on the same account for the same amount within 10 days, closest first', () => {
    const near = typed('2026-03-03', 'Rio Grande (typed)', -24510)
    const far = typed('2026-02-25', 'Rio Grande again', -24510)
    typed('2026-02-01', 'Too early', -24510)
    typed('2026-03-04', 'Other amount', -24500)
    importLines('03/06/2026,RIO GRANDE,-245.10')
    const [line] = books.linesToReview()
    expect(line.matches.map((m) => m.entryId)).toEqual([near, far])
    expect(line.matches[0]).toMatchObject({ memo: 'Rio Grande (typed)', otherSide: 'Materials', date: '2026-03-03' })
  })

  it('matching links the line without posting anything new', () => {
    const e = typed('2026-03-03', 'Rio Grande', -24510)
    importLines('03/06/2026,RIO GRANDE,-245.10')
    const [line] = books.linesToReview()
    books.matchBankLine(line.id, e)
    expect(books.linesToReview()).toEqual([])
    expect(bal('1000')).toBe(-24510)
    expect(books.entries()).toHaveLength(1)
    // An entry tied to one imported line isn't offered for another line of the same account.
    importLines('03/07/2026,RIO GRANDE DUP,-245.10')
    expect(books.linesToReview()[0].matches).toEqual([])
  })

  it('a card payment posted from the checking side matches the card line', () => {
    importLines('03/16/2026,AMEX EPAYMENT,-530.40')
    const [checking] = books.linesToReview(id('1000'))
    const { posted } = books.postBankLines([{ lineId: checking.id, accountId: id('2100'), memo: 'Card payment' }])
    importLines('03/17/2026,AUTOPAY PAYMENT - THANK YOU,-530.40\n03/04/2026,STULLER,512.00', '2100', true)
    const [card] = books.linesToReview(id('2100')).filter((l) => l.amountCents > 0)
    expect(card.matches.map((m) => m.entryId)).toEqual([posted[0].entryId])
    books.matchBankLine(card.id, posted[0].entryId)
    expect(bal('2100')).toBe(-53040)
  })

  it('refuses a non-matching entry, and a voided match sends the line back', () => {
    const e = typed('2026-03-03', 'Rio Grande', -24510)
    const other = typed('2026-03-03', 'Other', -100)
    importLines('03/06/2026,RIO GRANDE,-245.10')
    const [line] = books.linesToReview()
    expect(() => books.matchBankLine(line.id, other)).toThrow(/doesn't match/)
    books.matchBankLine(line.id, e)
    books.voidEntry(e, 'typo')
    const back = books.linesToReview()
    expect(back).toHaveLength(1)
    expect(back[0].entryVoided).toBe(true)
  })

  it('does not suggest reversed entries or reversals', () => {
    const e = typed('2026-03-03', 'Rio Grande', -24510)
    books.reverseEntry(e, '2026-03-04')
    importLines('03/06/2026,RIO GRANDE,-245.10')
    expect(books.linesToReview()[0].matches).toEqual([])
  })
})
