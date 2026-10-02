import ExcelJS from 'exceljs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import JSZip from 'jszip'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const num = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id
const post = (date: string, memo: string, lines: [string, number][]) =>
  books.postManualEntry({ date, memo, lines: lines.map(([n, c]) => ({ accountId: num(n), amountCents: c, memo: '' })) })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-pkg-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'Pkg Co',
      entityType: 'smllc',
      homeState: 'CA',
      booksStartDate: '2026-01-01',
      template: 'product'
    })
  )
  books.saveOpeningBalances([{ accountId: num('1000'), amountCents: 50000 }])
  post('2026-02-01', 'Fair sale', [
    ['1000', 30000],
    ['4000', -30000]
  ])
  const e = post('2026-02-03', 'Rio Grande', [
    ['5000', 8000],
    ['1000', -8000]
  ])
  const f = join(root, 'rio.pdf')
  writeFileSync(f, '%PDF receipt')
  books.attach(e, [f])
  post('2026-03-01', 'Ana Polishing', [
    ['6200', 250000],
    ['1000', -250000]
  ])
  books.saveContractor(null, {
    name: 'Ana Polishing',
    address: '',
    w9OnFile: false,
    tinLast4: '',
    matchText: '',
    notes: ''
  })
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

describe('notes for the accountant', () => {
  it('collects account notes and situations to check', () => {
    const notes = books.accountantNotes(2026)
    const text = notes.map((n) => `${n.kind}|${n.area}|${n.text}`)
    expect(text.some((t) => t.startsWith('note|Company|Entity type at year end: Single-member LLC'))).toBe(true)
    expect(text.some((t) => t.includes('5000 Materials:'))).toBe(true) // template note on an account used
    expect(text.some((t) => t.startsWith('check|Equity|Opening balance equity holds $500.00'))).toBe(true)
    expect(
      text.some((t) => t.startsWith('check|1099-NEC|Ana Polishing was paid $2,500.00') && t.includes('no W-9'))
    ).toBe(true)
    expect(text.some((t) => t.startsWith("check|Bank|Checking account hasn't been reconciled yet"))).toBe(
      true
    )
    expect(text.some((t) => t.startsWith("check|Company|The books aren't closed through 2026-12-31"))).toBe(true)
  })
})

describe('accountant package', () => {
  it('writes one ZIP with the workbook, CSVs, notes, receipts and the PDF', async () => {
    const r = await books.buildPackage(2026, Buffer.from('%PDF summary'))
    expect(r.zipPath).toBe(join(root, books.folder, 'exports', 'Accountant package 2026.zip'))
    expect(r.receipts).toBe(1)
    const zip = await JSZip.loadAsync(readFileSync(r.zipPath))
    const names = Object.keys(zip.files)
    for (const f of [
      'Pkg Co 2026 accountant workbook.xlsx',
      'Pkg Co 2026 summary.pdf',
      'general-ledger.csv',
      'transactions.csv',
      'inventory-count-sheet.csv',
      'fixed-assets.csv',
      'notes-for-accountant.txt',
      'receipts/2026-02-03_Rio-Grande_80.00.pdf',
      'receipts/index.csv'
    ])
      expect(names).toContain(f)
    const tx = await zip.file('transactions.csv')!.async('string')
    expect(tx).toContain('2026-02-01')
    expect(tx).toContain('300.00')

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await zip.file('Pkg Co 2026 accountant workbook.xlsx')!.async('arraybuffer'))
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Profit and loss',
      'Balance sheet',
      'Trial balance',
      'General ledger',
      'Transactions',
      'Sales by channel',
      'Tax lines',
      'Cost of goods sold',
      'Inventory methods',
      'Inventory count',
      'Fixed assets',
      '1099-NEC',
      '1099-K',
      'Sales tax',
      'Mileage',
      'Home office',
      'Notes for accountant'
    ])
    const summary = wb.getWorksheet('Summary')!
    const netRow = summary.getRows(1, summary.rowCount)!.find((row) => row.getCell(1).text === 'Net income')!
    expect(netRow.getCell(2).value).toBe(300 - 80 - 2500)
  })
})
