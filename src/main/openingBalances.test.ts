import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'
import { setLockedThrough } from './ledger'

let root: string
let books: CompanyBooks
const id = (number: string): number => books.chart().accounts.find((a) => a.number === number)!.id
const bal = (number: string): number => books.chart().accounts.find((a) => a.number === number)!.balanceCents

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-opening-'))
  const folder = createCompany(root, { name: 'Open Co', entityType: 'smllc', homeState: 'CA', booksStartDate: '2026-01-01', template: 'product' })
  books = openCompany(root, folder)
})

afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

describe('opening balances', () => {
  it('lists balance-sheet accounts only, without Opening balance equity', () => {
    const v = books.openingBalances()
    expect(v.date).toBe('2026-01-01')
    expect(v.entryId).toBeNull()
    expect(v.accounts.some((a) => a.number === '1000')).toBe(true)
    expect(v.accounts.some((a) => a.number === '3999' || a.number === '4000')).toBe(false)
  })

  it('posts one balanced entry on the books start date, the difference going to Opening balance equity', () => {
    const entryId = books.saveOpeningBalances([
      { accountId: id('1000'), amountCents: 500000 },
      { accountId: id('2100'), amountCents: 120000 },
      { accountId: id('1510'), amountCents: 30000 }
    ])
    expect(entryId).not.toBeNull()
    expect(bal('1000')).toBe(500000)
    expect(bal('2100')).toBe(120000)
    expect(bal('1510')).toBe(30000)
    expect(bal('3999')).toBe(350000)
    const v = books.openingBalances()
    expect(v.entryId).toBe(entryId)
    expect(v.equityCents).toBe(350000)
    expect(v.accounts.find((a) => a.number === '2100')!.amountCents).toBe(120000)
    const e = books.entries().find((x) => x.id === entryId)!
    expect(e.date).toBe('2026-01-01')
    expect(e.source).toBe('opening')
  })

  it('replacing voids the old entry and keeps it on record', () => {
    const first = books.saveOpeningBalances([{ accountId: id('1000'), amountCents: 1000 }])!
    const second = books.saveOpeningBalances([{ accountId: id('1000'), amountCents: 2500 }])!
    expect(second).not.toBe(first)
    expect(bal('1000')).toBe(2500)
    expect(books.entries().find((x) => x.id === first)!.status).toBe('void')
    expect(books.saveOpeningBalances([{ accountId: id('1000'), amountCents: 0 }])).toBeNull()
    expect(bal('1000')).toBe(0)
    expect(books.openingBalances().entryId).toBeNull()
  })

  it('refuses income accounts, Opening balance equity itself, and a closed period', () => {
    expect(() => books.saveOpeningBalances([{ accountId: id('4000'), amountCents: 100 }])).toThrow(/can't have an opening balance/)
    expect(() => books.saveOpeningBalances([{ accountId: id('3999'), amountCents: 100 }])).toThrow(/can't have an opening balance/)
    setLockedThrough(books.db, '2026-01-31')
    expect(() => books.saveOpeningBalances([{ accountId: id('1000'), amountCents: 100 }])).toThrow()
    expect(books.openingBalances().entryId).toBeNull()
  })

  it('refuses when Opening balance equity is turned off', () => {
    books.setAccountActive(id('3999'), false)
    expect(() => books.saveOpeningBalances([{ accountId: id('1000'), amountCents: 100 }])).toThrow(/inactive/)
  })
})
