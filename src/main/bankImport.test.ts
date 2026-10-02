import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guessMapping, parseCsv } from '../shared/csvImport'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'
import { readImportFile } from './bankImport'
import { setLockedThrough } from './ledger'

let root: string
let books: CompanyBooks
const id = (number: string): number => books.chart().accounts.find((a) => a.number === number)!.id
const bal = (number: string): number => books.chart().accounts.find((a) => a.number === number)!.balanceCents

const MARCH = `Date,Description,Amount
03/02/2026,RIO GRANDE ALBUQUERQUE,-245.10
03/03/2026,ETSY PAYOUT,1180.55
03/09/2026,COFFEE,-4.50
03/09/2026,COFFEE,-4.50
12/30/2025,OLD THING,-1.00`

const MARCH_AND_APRIL = `Date,Description,Amount
03/03/2026,ETSY PAYOUT,1180.55
03/09/2026,COFFEE,-4.50
03/09/2026,COFFEE,-4.50
04/01/2026,STULLER,-80.00`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-import-'))
  const folder = createCompany(root, { name: 'Imp Co', entityType: 'smllc', homeState: 'CA', booksStartDate: '2026-01-01', template: 'product' })
  books = openCompany(root, folder)
})

afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

function stage(text: string, account = '1000', fileName = 'march.csv') {
  return books.stageImport({ accountId: id(account), fileName, text, mapping: guessMapping(parseCsv(text)) })
}

describe('staging an import', () => {
  it('stages new lines, leaves out lines before the books start, and remembers the mapping', () => {
    const r = stage(MARCH)
    expect(r).toMatchObject({ added: 4, duplicates: 0, early: 1, problems: [] })
    const lines = books.linesToReview(id('1000'))
    expect(lines.map((l) => [l.date, l.amountCents])).toEqual([
      ['2026-03-02', -24510],
      ['2026-03-03', 118055],
      ['2026-03-09', -450],
      ['2026-03-09', -450]
    ])
    expect(books.savedMapping(id('1000'), MARCH, true)).toMatchObject({ dateCol: 0, descCol: 1, amountCol: 2 })
    expect(books.savedMapping(id('1010'), MARCH, true)).toBeNull()
    expect(books.reviewCounts()).toEqual([{ accountId: id('1000'), count: 4 }])
  })

  it('skips lines already imported when downloads overlap, but keeps genuine repeats', () => {
    stage(MARCH)
    const r = stage(MARCH_AND_APRIL, '1000', 'april.csv')
    expect(r).toMatchObject({ added: 1, duplicates: 3 })
    // The same file into a different account is not a duplicate.
    expect(stage(MARCH_AND_APRIL, '1010').added).toBe(4)
    const hist = books.importHistory()
    expect(hist[0]).toMatchObject({ fileName: 'march.csv', added: 4 })
    expect(hist).toHaveLength(3)
  })

  it('refuses a file where nothing can be read, and an income account', () => {
    const text = 'Date,Description,Amount\nnope,x,1'
    expect(() => stage(text)).toThrow(/None of the rows/)
    expect(() => stage(MARCH, '4000')).toThrow(/bank, cash or card/)
  })
})

describe('reviewing imported lines', () => {
  it('posts lines as balanced entries against the chosen accounts', () => {
    stage(MARCH)
    const [rio, etsy] = books.linesToReview()
    const r = books.postBankLines([
      { lineId: rio.id, accountId: id('5000'), memo: 'Rio Grande' },
      { lineId: etsy.id, accountId: id('4000'), memo: '' }
    ])
    expect(r.failed).toEqual([])
    expect(bal('1000')).toBe(118055 - 24510)
    expect(bal('5000')).toBe(24510)
    expect(bal('4000')).toBe(118055)
    const entry = books.entries().find((e) => e.id === r.posted[0].entryId)!
    expect(entry).toMatchObject({ memo: 'Rio Grande', source: 'import', date: '2026-03-02' })
    expect(books.entries().find((e) => e.id === r.posted[1].entryId)!.memo).toBe('ETSY PAYOUT')
    expect(books.linesToReview()).toHaveLength(2)
  })

  it('a credit card charge credits the card', () => {
    const text = 'Date,Description,Amount\n03/04/2026,STULLER,512.00\n03/20/2026,PAYMENT THANK YOU,-600.00'
    books.stageImport({ accountId: id('2100'), fileName: 'card.csv', text, mapping: guessMapping(parseCsv(text), true) })
    const [charge] = books.linesToReview()
    books.postBankLines([{ lineId: charge.id, accountId: id('5000'), memo: '' }])
    expect(bal('2100')).toBe(51200) // owed on the card
    expect(bal('5000')).toBe(51200)
  })

  it('reports per-line failures without stopping the others', () => {
    stage(MARCH)
    const [a, b] = books.linesToReview()
    setLockedThrough(books.db, '2026-03-02')
    const r = books.postBankLines([
      { lineId: a.id, accountId: id('5000'), memo: '' },
      { lineId: b.id, accountId: id('1000'), memo: '' },
      { lineId: b.id, accountId: id('4000'), memo: '' }
    ])
    expect(r.failed.map((f) => f.lineId)).toEqual([a.id, b.id])
    expect(r.failed[1].error).toMatch(/different account/)
    expect(r.posted).toHaveLength(1)
    // Posting the same line twice is refused.
    expect(books.postBankLines([{ lineId: b.id, accountId: id('4000'), memo: '' }]).failed[0].error).toMatch(/already dealt with/)
  })

  it('ignore and bring back; a voided entry sends its line back to review', () => {
    stage(MARCH)
    const [a, b] = books.linesToReview()
    books.ignoreBankLines([a.id])
    expect(books.linesToReview().map((l) => l.id)).not.toContain(a.id)
    expect(books.ignoredLines(id('1000')).map((l) => l.id)).toEqual([a.id])
    books.restoreBankLine(a.id)
    expect(books.linesToReview().map((l) => l.id)).toContain(a.id)

    const { posted } = books.postBankLines([{ lineId: b.id, accountId: id('4000'), memo: '' }])
    expect(books.linesToReview().map((l) => l.id)).not.toContain(b.id)
    books.voidEntry(posted[0].entryId, 'wrong category')
    const back = books.linesToReview().find((l) => l.id === b.id)!
    expect(back.entryVoided).toBe(true)
    books.postBankLines([{ lineId: b.id, accountId: id('4900'), memo: '' }])
    expect(bal('4900')).toBe(118055)
  })

  it('the database keeps what the bank said', () => {
    stage(MARCH)
    const [a] = books.linesToReview()
    expect(() => books.db.prepare('UPDATE bank_lines SET amount_cents = 1 WHERE id = ?').run(a.id)).toThrow(/can't be changed/)
    expect(() => books.db.prepare('DELETE FROM bank_lines WHERE id = ?').run(a.id)).toThrow(/kept on record/)
    expect(() => books.db.prepare('DELETE FROM import_batches').run()).toThrow()
  })
})

describe('readImportFile', () => {
  it('reads UTF-8 and falls back to Windows-1252', () => {
    const p1 = join(root, 'a.csv')
    writeFileSync(p1, 'Date,Description\n03/01/2026,Café')
    expect(readImportFile(p1).text).toContain('Café')
    const p2 = join(root, 'b.csv')
    writeFileSync(p2, Buffer.from([0x43, 0x61, 0x66, 0xe9])) // "Café" in Windows-1252
    expect(readImportFile(p2)).toEqual({ fileName: 'b.csv', text: 'Café' })
  })
})
