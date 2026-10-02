import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { homeOfficeSummary, necThresholdCents, parseMiles } from '../shared/records'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const num = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id
const post = (date: string, memo: string, lines: [string, number][]) =>
  books.postManualEntry({ date, memo, lines: lines.map(([n, c]) => ({ accountId: num(n), amountCents: c, memo: '' })) })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-records-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'Rec',
      entityType: 'smllc',
      homeState: 'CA',
      booksStartDate: '2026-01-01',
      template: 'product'
    })
  )
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

describe('1099-NEC list', () => {
  it('totals bank payments per contractor, leaves card payments out, and lists unmatched payments', () => {
    books.saveContractor(null, {
      name: 'Ana Polishing',
      address: '',
      w9OnFile: true,
      tinLast4: '1234',
      matchText: 'ana polish',
      notes: ''
    })
    books.saveContractor(null, {
      name: 'Photo Bob',
      address: '',
      w9OnFile: false,
      tinLast4: '',
      matchText: '',
      notes: ''
    })
    expect(() =>
      books.saveContractor(null, { name: 'X', address: '', w9OnFile: false, tinLast4: '12', matchText: '', notes: '' })
    ).toThrow(/last four/)
    post('2026-02-01', 'Ana Polishing - Feb', [
      ['6200', 150000],
      ['1000', -150000]
    ])
    post('2026-03-01', 'ana polishing march', [
      ['6200', 80000],
      ['1000', -80000]
    ])
    post('2026-03-05', 'Photo Bob shoot', [
      ['6200', 50000],
      ['2100', -50000]
    ])
    post('2026-03-09', 'Unknown helper', [
      ['6200', 10000],
      ['1000', -10000]
    ])
    const r = books.necReport(2026)
    expect(r.thresholdCents).toBe(200000)
    expect(r.rows.map((x) => [x.name, x.paidCents, x.paidByCardCents, x.overThreshold])).toEqual([
      ['Ana Polishing', 230000, 0, true],
      ['Photo Bob', 0, 50000, false]
    ])
    expect(r.unmatched.map((u) => u.memo)).toEqual(['Unknown helper'])
    expect(necThresholdCents(2025)).toBe(60000)
  })
})

describe('fixed assets', () => {
  it('lists assets in service during the year and compares with the books', () => {
    books.saveFixedAsset(null, {
      name: 'Rolling mill',
      accountId: num('1500'),
      inServiceDate: '2026-04-01',
      costCents: 120000,
      disposedDate: null,
      notes: ''
    })
    books.saveFixedAsset(null, {
      name: 'Old kiln',
      accountId: num('1500'),
      inServiceDate: '2026-01-02',
      costCents: 30000,
      disposedDate: '2026-06-30',
      notes: 'sold'
    })
    expect(() =>
      books.saveFixedAsset(null, {
        name: 'x',
        accountId: null,
        inServiceDate: '2026-05-01',
        costCents: 1,
        disposedDate: '2026-04-01',
        notes: ''
      })
    ).toThrow(/after/)
    post('2026-04-01', 'Mill', [
      ['1500', 120000],
      ['1000', -120000]
    ])
    const r = books.fixedAssetReport(2026)
    expect(r.assets.map((a) => [a.name, a.placedThisYear, a.disposedThisYear])).toEqual([
      ['Old kiln', true, true],
      ['Rolling mill', true, false]
    ])
    expect(r.totalCostCents).toBe(120000)
    expect(r.booksCents).toBe(120000)
    expect(books.fixedAssetReport(2027).assets.map((a) => a.name)).toEqual(['Rolling mill'])
  })
})

describe('mileage and home office', () => {
  it('totals miles and multiplies by the rate typed in', () => {
    expect(parseMiles('12.3')).toBe(123)
    books.addTrip({
      date: '2026-02-01',
      milesTenths: 123,
      purpose: 'Bank deposit',
      fromPlace: 'Studio',
      toPlace: 'Bank'
    })
    let r = books.addTrip({ date: '2026-02-03', milesTenths: 400, purpose: 'Supply run', fromPlace: '', toPlace: '' })
    expect(r.totalTenths).toBe(523)
    expect(r.amountCents).toBeNull()
    r = books.setMileageRate(2026, 700)
    expect(r.amountCents).toBe(3661) // 52.3 miles × 70¢ = $36.61
    expect(() =>
      books.addTrip({ date: '2026-02-05', milesTenths: 10, purpose: ' ', fromPlace: '', toPlace: '' })
    ).toThrow(/purpose/)
    r = books.removeTrip(r.trips[0].id, 2026)
    expect(r.totalTenths).toBe(400)
  })

  it('home office: simplified and regular amounts', () => {
    const h = {
      year: 2026,
      officeSqft: 150,
      homeSqft: 1500,
      rentCents: 2400000,
      mortgageInterestCents: 0,
      propertyTaxCents: 0,
      utilitiesCents: 300000,
      insuranceCents: 0,
      repairsCents: 0,
      otherCents: 0,
      notes: ''
    }
    const s = books.saveHomeOffice(h)
    expect(s).toMatchObject({ percentBp: 1000, simplifiedCents: 75000, regularCents: 270000 })
    expect(homeOfficeSummary({ ...h, officeSqft: 400, homeSqft: 2000 }).simplifiedCents).toBe(150000)
    expect(() => books.saveHomeOffice({ ...h, officeSqft: 2000 })).toThrow(/bigger/)
  })
})
