import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SupplierInput } from '../shared/contacts'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const acct = (n: string) => books.chart().accounts.find((a) => a.number === n)!
const supplier = (over: Partial<SupplierInput> = {}): SupplierInput => ({
  name: 'Rio Grande',
  kind: 'supplier',
  contactPerson: 'Sam',
  email: 'orders@example.com',
  phone: '800-555-0100',
  website: 'riogrande.example',
  address: '7500 Bluewater Rd',
  accountNumber: 'C-1234',
  termsDays: 30,
  defaultAccountId: null,
  notes: '',
  ...over
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-contacts-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'Contacts',
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

describe('suppliers', () => {
  it('adds, edits and turns off a supplier; names are unique ignoring case', () => {
    const list = books.saveSupplier(null, supplier({ defaultAccountId: acct('5000').id }))
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'Rio Grande', termsDays: 30, accountNumber: 'C-1234', isActive: true })
    expect(() => books.saveSupplier(null, supplier({ name: ' rio grande ' }))).toThrow(/already a supplier/)

    const id = list[0].id
    books.saveSupplier(id, supplier({ name: 'Rio Grande Inc', kind: 'metal_dealer', termsDays: null }))
    expect(books.suppliers()[0]).toMatchObject({ name: 'Rio Grande Inc', kind: 'metal_dealer', termsDays: null })
    // editing without saying active/inactive keeps it as it was
    expect(books.suppliers()[0].isActive).toBe(true)
    books.saveSupplier(id, { ...supplier({ name: 'Rio Grande Inc' }), isActive: false })
    expect(books.suppliers()[0].isActive).toBe(false)
  })

  it('refuses bad input and accounts that money for purchases can’t go to', () => {
    expect(() => books.saveSupplier(null, supplier({ name: '  ' }))).toThrow(/name/)
    expect(() => books.saveSupplier(null, supplier({ email: 'not-an-email' }))).toThrow(/email/)
    expect(() => books.saveSupplier(null, supplier({ termsDays: 400 }))).toThrow(/0 to 365/)
    expect(() => books.saveSupplier(null, supplier({ defaultAccountId: acct('1000').id }))).toThrow(/expense/)
    expect(() => books.saveSupplier(null, supplier({ defaultAccountId: acct('4000').id }))).toThrow(/expense/)
  })

  it('can’t be deleted, and every change is in the audit log', () => {
    books.saveSupplier(null, supplier())
    expect(() => books.db.prepare('DELETE FROM suppliers').run()).toThrow(/can't be deleted/)
    const log = books.db.prepare("SELECT action FROM audit_log WHERE table_name = 'suppliers'").all()
    expect(log).toEqual([{ action: 'insert' }])
  })

  it('the contacts list shows suppliers, customers and contractors together by name', () => {
    books.saveSupplier(null, supplier({ name: 'Hoover & Strong', kind: 'metal_dealer' }))
    books.addCustomer({ name: 'Bead Shop', email: '', phone: '', address: '', notes: '', isWholesale: true })
    books.saveContractor(null, { name: 'Casey Polisher', address: '', w9OnFile: false, tinLast4: '', matchText: 'Casey', notes: '' })
    expect(books.contacts().map((c) => [c.name, c.role, c.detail])).toEqual([
      ['Bead Shop', 'customer', 'Customer (wholesale)'],
      ['Casey Polisher', 'contractor', 'Contractor (no W-9 yet)'],
      ['Hoover & Strong', 'supplier', 'Refiner or metal dealer']
    ])
  })
})

describe('schema v15', () => {
  it('a v14 company file opens with a backup first and gains the suppliers table', () => {
    const folder = createCompany(root, {
      name: 'Older',
      entityType: 'sole_prop',
      homeState: 'CA',
      booksStartDate: '2026-01-01',
      template: 'general'
    })
    const file = join(root, folder, 'books.sqlite')
    // Rebuild the file as a v14 company: drop what v15 added and set the version back.
    const db = new Database(file)
    db.exec('DROP TABLE suppliers')
    db.pragma('user_version = 14')
    db.close()

    const older = openCompany(root, folder)
    expect(older.suppliers()).toEqual([])
    older.saveSupplier(null, supplier())
    expect(older.suppliers()).toHaveLength(1)
    older.close()
    const backups = readdirSync(join(root, folder, 'backups'))
    expect(backups.some((f) => f.includes('before-upgrade-v14-to-v15'))).toBe(true)
  })
})
