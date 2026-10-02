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
import { buildExpense, buildIncome, buildTransfer } from '../shared/everyday'
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

describe('postManualEntry', () => {
  function idOf(books: ReturnType<typeof openCompany>, number: string): number {
    return books.chart().accounts.find((a) => a.number === number)!.id
  }

  it('posts a balanced manual entry that shows in balances', () => {
    const books = openCompany(root, createCompany(root, juno))
    try {
      const [cash, other] = books.chart().accounts.filter((a) => a.type === 'asset').map((a) => a.number)
      const id = books.postManualEntry({
        date: '2026-02-01',
        memo: 'Move money',
        lines: [
          { accountId: idOf(books, cash), amountCents: 2_500, memo: '' },
          { accountId: idOf(books, other), amountCents: -2_500, memo: '' }
        ]
      })
      expect(id).toBeGreaterThan(0)
      const source = books.db.prepare('SELECT source, status FROM journal_entries WHERE id = ?').get(id)
      expect(source).toEqual({ source: 'manual', status: 'posted' })
      expect(books.chart().accounts.find((a) => a.number === cash)!.balanceCents).toBe(2_500)
    } finally {
      books.close()
    }
  })

  it('refuses an entry dated before the books start, or unbalanced', () => {
    const books = openCompany(root, createCompany(root, juno))
    try {
      const [a, b] = books.chart().accounts.slice(0, 2).map((x) => x.id)
      const lines = [
        { accountId: a, amountCents: 100, memo: '' },
        { accountId: b, amountCents: -100, memo: '' }
      ]
      expect(() => books.postManualEntry({ date: '2025-12-31', memo: '', lines })).toThrow(/books start on 2026-01-01/)
      expect(() =>
        books.postManualEntry({ date: '2026-01-05', memo: '', lines: [lines[0], { ...lines[1], amountCents: -99 }] })
      ).toThrow(/off by \$0.01/)
      expect(books.db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get()).toEqual({ n: 0 })
    } finally {
      books.close()
    }
  })
})

describe('entries, voidEntry, reverseEntry', () => {
  function setup() {
    const books = openCompany(root, createCompany(root, juno))
    const [a, b] = books.chart().accounts.filter((x) => x.type === 'asset')
    const post = (date: string, cents: number, memo = '') =>
      books.postManualEntry({
        date,
        memo,
        lines: [
          { accountId: a.id, amountCents: cents, memo: 'in' },
          { accountId: b.id, amountCents: -cents, memo: '' }
        ]
      })
    const balance = () => books.chart().accounts.find((x) => x.id === a.id)!.balanceCents
    return { books, a, b, post, balance }
  }

  it('lists entries newest first with lines, account names and debit total', () => {
    const { books, a, b, post } = setup()
    try {
      const first = post('2026-02-01', 1_000, 'older')
      const second = post('2026-03-01', 2_500, 'newer')
      const list = books.entries()
      expect(list.map((e) => e.id)).toEqual([second, first])
      expect(list[0]).toMatchObject({ date: '2026-03-01', memo: 'newer', status: 'posted', amountCents: 2_500 })
      expect(list[0].lines).toEqual([
        { accountId: a.id, accountNumber: a.number, accountName: a.name, amountCents: 2_500, memo: 'in' },
        { accountId: b.id, accountNumber: b.number, accountName: b.name, amountCents: -2_500, memo: '' }
      ])
    } finally {
      books.close()
    }
  })

  it('voids an entry: marked voided with its reason, dropped from balances', () => {
    const { books, post, balance } = setup()
    try {
      const id = post('2026-02-01', 1_000)
      expect(() => books.voidEntry(id, '  ')).toThrow(/needs a reason/)
      const list = books.voidEntry(id, 'Entered twice')
      expect(list[0]).toMatchObject({ id, status: 'void', voidReason: 'Entered twice' })
      expect(balance()).toBe(0)
      expect(() => books.voidEntry(id, 'again')).toThrow(/already voided/)
    } finally {
      books.close()
    }
  })

  it('reverses an entry: both linked, balances cancel, and the original can no longer be voided', () => {
    const { books, post, balance } = setup()
    try {
      const id = post('2026-02-01', 1_000, 'Rent')
      expect(() => books.reverseEntry(id, '2026-01-31')).toThrow(/can't be dated before/)
      const list = books.reverseEntry(id, '2026-02-10')
      const reversal = list.find((e) => e.reversesEntryId === id)!
      expect(reversal).toMatchObject({ date: '2026-02-10', memo: 'Reversal of entry #1: Rent', source: 'reversal' })
      expect(list.find((e) => e.id === id)!.reversedById).toBe(reversal.id)
      expect(balance()).toBe(0)
      expect(() => books.voidEntry(id, 'oops')).toThrow(/already reversed/)
    } finally {
      books.close()
    }
  })
})

describe('everyday screens end to end', () => {
  it('income, expense and transfer entries post and move the right balances', () => {
    const books = openCompany(root, createCompany(root, juno))
    try {
      const accts = books.chart().accounts
      const id = (name: string) => accts.find((a) => a.name === name)!.id
      const bal = (name: string) => books.chart().accounts.find((a) => a.name === name)!.balanceCents
      const post = (r: ReturnType<typeof buildExpense>) => {
        if ('error' in r) throw new Error(r.error)
        return books.postManualEntry(r.entry)
      }
      const line = (accountId: number, amount: string) => ({ accountId, amount, memo: '' })

      // Income: $100 sale + $8.25 sales tax deposited to Checking
      post(buildIncome({ date: '2026-03-01', receivedFrom: 'Customer', depositToId: id('Checking account'),
        lines: [line(id('Sales'), '100'), line(id('Sales tax payable'), '8.25')] }))
      expect(bal('Checking account')).toBe(10_825)
      expect(bal('Sales')).toBe(10_000)
      expect(bal('Sales tax payable')).toBe(825)

      // Expense on the credit card, split across two categories
      post(buildExpense({ date: '2026-03-02', paidTo: 'Supplier', paidFromId: id('Credit card'),
        lines: [line(id('Office expense'), '10'), line(id('Materials'), '5.50')] }))
      expect(bal('Credit card')).toBe(1_550)
      expect(bal('Office expense')).toBe(1_000)
      expect(bal('Materials')).toBe(550)

      // Transfers: pay the card from Checking, move money to Savings
      post(buildTransfer({ date: '2026-03-03', memo: '', fromId: id('Checking account'), toId: id('Credit card'), amount: '15.50' }))
      post(buildTransfer({ date: '2026-03-03', memo: '', fromId: id('Checking account'), toId: id('Savings account'), amount: '50' }))
      expect(bal('Credit card')).toBe(0)
      expect(bal('Savings account')).toBe(5_000)
      expect(bal('Checking account')).toBe(10_825 - 1_550 - 5_000)

      // Whole ledger still balances and every entry is balanced
      const total = books.db.prepare('SELECT SUM(amount_cents) AS t FROM journal_lines').get() as { t: number }
      expect(total.t).toBe(0)
      expect(books.entries()).toHaveLength(4)
    } finally {
      books.close()
    }
  })
})
