import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NewCompanyInput } from '../shared/company'
import {
  BACKUPS_TO_KEEP,
  createCompany,
  DB_FILE,
  folderNameFor,
  listCompanies,
  openCompany,
  pruneBackups
} from './companyStore'
import { getSchemaVersion, LATEST_SCHEMA_VERSION } from './db/migrations'

let root: string

const juno: NewCompanyInput = {
  name: 'Juno Jewelry',
  entityType: 'smllc',
  homeState: 'CA',
  booksStartDate: '2026-01-01',
  template: 'product'
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('folderNameFor', () => {
  it('replaces characters Windows forbids and trims trailing dots', () => {
    expect(folderNameFor('  A/B: "C" Co.  ')).toBe('A-B- -C- Co')
  })
  it('avoids reserved device names', () => {
    expect(folderNameFor('CON')).toBe('CON company')
  })
})

describe('createCompany', () => {
  it('creates the folder layout and a database at the latest schema version', () => {
    const folder = createCompany(root, juno)
    const dir = join(root, folder)
    for (const sub of ['backups', 'receipts', 'exports']) expect(existsSync(join(dir, sub))).toBe(true)
    const db = new Database(join(dir, DB_FILE), { readonly: true })
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION)
    db.close()
  })

  it('rejects a duplicate company, ignoring case', () => {
    createCompany(root, juno)
    expect(() => createCompany(root, { ...juno, name: 'juno jewelry' })).toThrow(/already exists/)
  })

  it('rejects invalid input without creating anything', () => {
    expect(() => createCompany(root, { ...juno, name: '   ' })).toThrow(/company name/)
    expect(() => createCompany(root, { ...juno, entityType: 'llc' })).toThrow(/entity type/)
    expect(() => createCompany(root, { ...juno, homeState: 'ZZ' })).toThrow(/home state/)
    expect(() => createCompany(root, { ...juno, booksStartDate: '2026-02-30' })).toThrow(/start date/)
    expect(readdirSync(root)).toEqual([])
  })
})

describe('listCompanies', () => {
  it('lists companies sorted by name and skips non-company folders', () => {
    createCompany(root, juno)
    createCompany(root, { ...juno, name: 'Acme Services', entityType: 's_corp', homeState: 'NY' })

    // An old Phase 0 smoke-test file (schema version 0) must be ignored.
    mkdirSync(join(root, 'Sample Company'))
    const old = new Database(join(root, 'Sample Company', DB_FILE))
    old.exec('CREATE TABLE smoke_test (id INTEGER)')
    old.close()
    // A folder with no books file is ignored too.
    mkdirSync(join(root, 'Random Folder'))

    const list = listCompanies(root)
    expect(list.map((c) => c.name)).toEqual(['Acme Services', 'Juno Jewelry'])
    expect(list[0]).toMatchObject({ entityType: 's_corp', homeState: 'NY' })
  })

  it('returns an empty list when the Companies folder does not exist yet', () => {
    expect(listCompanies(join(root, 'missing'))).toEqual([])
  })
})

describe('openCompany', () => {
  it('opens a company and reads its profile', () => {
    const folder = createCompany(root, juno)
    const books = openCompany(root, folder)
    expect(books.profile(new Date(2026, 5, 1))).toMatchObject({
      name: 'Juno Jewelry',
      entityType: 'smllc',
      homeState: 'CA',
      booksStartDate: '2026-01-01',
      schemaVersion: LATEST_SCHEMA_VERSION
    })
    books.close()
  })

  it('uses the entity type in force on the given date', () => {
    const folder = createCompany(root, juno)
    const books = openCompany(root, folder)
    books.db
      .prepare('INSERT INTO entity_type_history (entity_type, effective_date, created_at) VALUES (?, ?, ?)')
      .run('llc_s_corp', '2027-01-01', new Date().toISOString())
    expect(books.profile(new Date(2026, 11, 31)).entityType).toBe('smllc')
    expect(books.profile(new Date(2027, 0, 1)).entityType).toBe('llc_s_corp')
    books.close()
  })

  it('writes a backup when closed', () => {
    const folder = createCompany(root, juno)
    openCompany(root, folder).close()
    expect(readdirSync(join(root, folder, 'backups'))).toHaveLength(1)
  })

  it('refuses a file that is not a JunoBooks company, without changing it', () => {
    mkdirSync(join(root, 'Sample Company'))
    const old = new Database(join(root, 'Sample Company', DB_FILE))
    old.exec('CREATE TABLE smoke_test (id INTEGER)')
    old.close()
    expect(() => openCompany(root, 'Sample Company')).toThrow(/isn't a JunoBooks company/)
    const check = new Database(join(root, 'Sample Company', DB_FILE), { readonly: true })
    expect(getSchemaVersion(check)).toBe(0)
    check.close()
  })

  it('refuses a file from a newer version of the app', () => {
    const folder = createCompany(root, juno)
    const db = new Database(join(root, folder, DB_FILE))
    db.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    db.close()
    expect(() => openCompany(root, folder)).toThrow(/newer version/)
  })

  it('rejects folder names that try to reach outside Companies', () => {
    expect(() => openCompany(root, '..')).toThrow(/Invalid/)
    expect(() => openCompany(root, 'a\\..\\b')).toThrow(/Invalid/)
  })
})

describe('pruneBackups', () => {
  it(`keeps only the newest ${BACKUPS_TO_KEEP}`, () => {
    const dir = join(root, 'backups')
    mkdirSync(dir)
    for (let i = 0; i < BACKUPS_TO_KEEP + 5; i++) {
      writeFileSync(join(dir, `books-2026-01-${String(i + 1).padStart(2, '0')}T00-00-00-000Z.sqlite`), '')
    }
    pruneBackups(dir)
    const left = readdirSync(dir).sort()
    expect(left).toHaveLength(BACKUPS_TO_KEEP)
    expect(left[0]).toBe('books-2026-01-06T00-00-00-000Z.sqlite')
  })
})
