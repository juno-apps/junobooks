import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { receiptFileName, safeNamePart } from '../shared/attachments'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
let src: string
const id = (number: string): number => books.chart().accounts.find((a) => a.number === number)!.id

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-receipts-'))
  src = mkdtempSync(join(tmpdir(), 'junobooks-receipt-src-'))
  const folder = createCompany(root, { name: 'Rcpt Co', entityType: 'smllc', homeState: 'CA', booksStartDate: '2026-01-01', template: 'product' })
  books = openCompany(root, folder)
})

afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(src, { recursive: true, force: true })
})

function file(name: string, content = name): string {
  const p = join(src, name)
  writeFileSync(p, content)
  return p
}

function expense(memo = 'Rio Grande, Inc.'): number {
  return books.postManualEntry({
    date: '2026-03-05',
    memo,
    lines: [
      { accountId: id('5000'), amountCents: 1250, memo: '' },
      { accountId: id('1000'), amountCents: -1250, memo: '' }
    ]
  })
}

describe('receipt names', () => {
  it('follow date_vendor_amount.ext and stay Windows-safe', () => {
    expect(safeNamePart('Rio Grande, Inc.')).toBe('Rio-Grande-Inc')
    expect(receiptFileName('2026-03-05', 'Rio Grande, Inc.', 1250, 'PDF', 7)).toBe('2026-03-05_Rio-Grande-Inc_12.50.pdf')
    expect(receiptFileName('2026-03-05', '', 5, 'jpg', 7)).toBe('2026-03-05_entry-7_0.05.jpg')
  })
})

describe('attachments', () => {
  it('copies files into receipts\\<year>\\ and lists them on the entry', () => {
    const e = expense()
    const r = books.attach(e, [file('scan.pdf'), file('photo.JPG', 'other')])
    expect(r.skipped).toEqual([])
    expect(r.added.map((a) => a.storedPath)).toEqual([
      'receipts/2026/2026-03-05_Rio-Grande-Inc_12.50.pdf',
      'receipts/2026/2026-03-05_Rio-Grande-Inc_12.50.jpg'
    ])
    const dir = join(root, books.folder)
    expect(readFileSync(join(dir, 'receipts', '2026', '2026-03-05_Rio-Grande-Inc_12.50.pdf'), 'utf8')).toBe('scan.pdf')
    expect(books.attachments(e).map((a) => a.originalName)).toEqual(['scan.pdf', 'photo.JPG'])
    expect(books.entries().find((x) => x.id === e)!.receiptCount).toBe(2)
  })

  it('numbers a second file with the same name, and skips duplicates and unsupported files', () => {
    const e = expense()
    books.attach(e, [file('a.pdf', 'one')])
    const r = books.attach(e, [file('b.pdf', 'two'), file('c.pdf', 'one'), file('virus.exe'), join(src, 'missing.pdf')])
    expect(r.added.map((a) => a.storedPath)).toEqual(['receipts/2026/2026-03-05_Rio-Grande-Inc_12.50-2.pdf'])
    expect(r.skipped.map((s) => s.name)).toEqual(['c.pdf', 'virus.exe', 'missing.pdf'])
    expect(r.skipped[0].reason).toMatch(/already attached/)
  })

  it('removing keeps the record and moves the file to receipts\\_removed\\', () => {
    const e = expense()
    const [a] = books.attach(e, [file('scan.pdf')]).added
    const dir = join(root, books.folder)
    books.removeAttachment(a.id, 'wrong receipt')
    expect(books.attachments(e)).toEqual([])
    expect(existsSync(join(dir, a.storedPath))).toBe(false)
    expect(existsSync(join(dir, 'receipts', '_removed', '2026-03-05_Rio-Grande-Inc_12.50.pdf'))).toBe(true)
    const row = books.db.prepare('SELECT removed_at, remove_reason FROM attachments WHERE id = ?').get(a.id) as {
      removed_at: string
      remove_reason: string
    }
    expect(row.removed_at).not.toBeNull()
    expect(row.remove_reason).toBe('wrong receipt')
    expect(() => books.attachmentFile(a.id)).toThrow(/removed/)
  })

  it('the database refuses erasing a receipt record or changing it after removal', () => {
    const e = expense()
    const [a] = books.attach(e, [file('scan.pdf')]).added
    expect(() => books.db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id)).toThrow(/record is kept/)
    expect(() => books.db.prepare('UPDATE attachments SET entry_id = 99 WHERE id = ?').run(a.id)).toThrow(/only be marked removed/)
    books.removeAttachment(a.id)
    expect(() => books.db.prepare("UPDATE attachments SET remove_reason = 'x' WHERE id = ?").run(a.id)).toThrow()
    const audit = books.db.prepare("SELECT action FROM audit_log WHERE table_name = 'attachments' ORDER BY id").all()
    expect(audit).toEqual([{ action: 'insert' }, { action: 'update' }])
  })

  it('works on voided entries and refuses a missing entry', () => {
    const e = expense()
    books.voidEntry(e, 'test')
    expect(books.attach(e, [file('scan.pdf')]).added).toHaveLength(1)
    expect(() => books.attach(9999, [file('x.pdf')])).toThrow(/no longer exists/)
  })
})
