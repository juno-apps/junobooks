import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCompany, DB_FILE, openCompany } from '../companyStore'
import { getSchemaVersion, LATEST_SCHEMA_VERSION, runMigrations } from './migrations'

let root: string
let db: Database.Database
const now = '2026-01-01T00:00:00.000Z'

function freshDb(): Database.Database {
  const d = new Database(':memory:')
  d.pragma('foreign_keys = ON')
  runMigrations(d)
  return d
}

function addAccount(number: string, type = 'asset'): number {
  return Number(
    db
      .prepare('INSERT INTO accounts (number, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(number, `Account ${number}`, type, now, now).lastInsertRowid
  )
}

function draft(lines: [number, number][], date = '2026-03-15'): number {
  const id = Number(
    db.prepare('INSERT INTO journal_entries (entry_date, created_at) VALUES (?, ?)').run(date, now).lastInsertRowid
  )
  const add = db.prepare('INSERT INTO journal_lines (entry_id, line_no, account_id, amount_cents) VALUES (?, ?, ?, ?)')
  lines.forEach(([account, cents], i) => add.run(id, i + 1, account, cents))
  return id
}

function post(id: number): void {
  db.prepare("UPDATE journal_entries SET status = 'posted', posted_at = ? WHERE id = ?").run(now, id)
}

let cash: number
let sales: number

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-schema-'))
  db = freshDb()
  cash = addAccount('1000', 'asset')
  sales = addAccount('4000', 'income')
})

afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

describe('posting', () => {
  it('posts a balanced entry', () => {
    const id = draft([[cash, 12_345], [sales, -12_345]])
    post(id)
    expect(db.prepare('SELECT status FROM journal_entries WHERE id = ?').get(id)).toEqual({ status: 'posted' })
  })

  it('rejects an unbalanced entry', () => {
    const id = draft([[cash, 12_345], [sales, -12_300]])
    expect(() => post(id)).toThrow(/doesn't balance/)
  })

  it('rejects an entry with fewer than two lines', () => {
    expect(() => post(draft([]))).toThrow(/doesn't balance/)
  })

  it('rejects creating an entry already posted', () => {
    expect(() =>
      db.prepare("INSERT INTO journal_entries (entry_date, status, created_at, posted_at) VALUES ('2026-01-01', 'posted', ?, ?)").run(now, now)
    ).toThrow(/must start as drafts/)
  })

  it('rejects fractional cents and zero-amount lines', () => {
    expect(() => draft([[cash, 10.5], [sales, -10.5]])).toThrow()
    expect(() => draft([[cash, 0]])).toThrow()
  })

  it('rejects a malformed date', () => {
    expect(() => draft([], '3/15/2026')).toThrow()
  })
})

describe('posted entries are locked', () => {
  let id: number
  beforeEach(() => {
    id = draft([[cash, 500], [sales, -500]])
    post(id)
  })

  it('refuses edits to the entry', () => {
    expect(() => db.prepare("UPDATE journal_entries SET memo = 'x' WHERE id = ?").run(id)).toThrow(/Void or reverse/)
    expect(() => db.prepare("UPDATE journal_entries SET entry_date = '2026-04-01' WHERE id = ?").run(id)).toThrow()
    expect(() => db.prepare("UPDATE journal_entries SET status = 'draft' WHERE id = ?").run(id)).toThrow()
  })

  it('refuses adding, changing or deleting lines', () => {
    expect(() =>
      db.prepare('INSERT INTO journal_lines (entry_id, line_no, account_id, amount_cents) VALUES (?, 3, ?, 1)').run(id, cash)
    ).toThrow(/draft/)
    expect(() => db.prepare('UPDATE journal_lines SET amount_cents = 999 WHERE entry_id = ?').run(id)).toThrow()
    expect(() => db.prepare('DELETE FROM journal_lines WHERE entry_id = ?').run(id)).toThrow()
  })

  it('refuses deleting the entry', () => {
    expect(() => db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id)).toThrow(/can't be deleted/)
  })

  it('allows voiding with a reason, and then nothing else', () => {
    const voidIt = db.prepare("UPDATE journal_entries SET status = 'void', voided_at = ?, void_reason = ? WHERE id = ?")
    expect(() => voidIt.run(now, '  ', id)).toThrow()
    voidIt.run(now, 'Entered twice', id)
    expect(() => db.prepare("UPDATE journal_entries SET void_reason = 'changed' WHERE id = ?").run(id)).toThrow(/voided/)
    expect(() => db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id)).toThrow()
  })

  it("locks the type of accounts used in posted entries, and they can't be deleted", () => {
    expect(() => db.prepare("UPDATE accounts SET type = 'expense' WHERE id = ?").run(sales)).toThrow(/type can't/)
    expect(() => db.prepare('DELETE FROM accounts WHERE id = ?').run(sales)).toThrow()
    db.prepare("UPDATE accounts SET name = 'Sales - Etsy' WHERE id = ?").run(sales)
  })
})

describe('drafts', () => {
  it('can be edited and deleted along with their lines', () => {
    const id = draft([[cash, 100], [sales, -90]])
    db.prepare('UPDATE journal_lines SET amount_cents = -100 WHERE entry_id = ? AND line_no = 2').run(id)
    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM journal_lines').get()).toEqual({ n: 0 })
  })
})

describe('audit log', () => {
  it('records inserts, updates and deletes with before/after values', () => {
    db.prepare("UPDATE accounts SET name = 'Checking' WHERE id = ?").run(cash)
    const row = db
      .prepare("SELECT old_values, new_values FROM audit_log WHERE table_name = 'accounts' AND action = 'update'")
      .get() as { old_values: string; new_values: string }
    expect(JSON.parse(row.old_values).name).toBe('Account 1000')
    expect(JSON.parse(row.new_values).name).toBe('Checking')

    const id = draft([[cash, 1], [sales, -1]])
    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id)
    const actions = db
      .prepare("SELECT action FROM audit_log WHERE table_name = 'journal_entries' ORDER BY id")
      .all()
      .map((r) => (r as { action: string }).action)
    expect(actions).toEqual(['insert', 'delete'])
  })

  it("can't be changed or deleted", () => {
    expect(() => db.prepare("UPDATE audit_log SET action = 'insert'").run()).toThrow(/audit log/)
    expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow(/audit log/)
  })

  it('rolls back with a failed change', () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n
    expect(() =>
      db.transaction(() => {
        addAccount('5000', 'expense')
        addAccount('5000', 'expense') // duplicate number fails the whole transaction
      })()
    ).toThrow()
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: before })
  })
})

describe('upgrading an existing company', () => {
  it('backs up a v1 file, upgrades it, and keeps its data', () => {
    const dir = join(root, 'Old Co')
    mkdirSync(join(dir, 'backups'), { recursive: true })
    const v1 = new Database(join(dir, DB_FILE))
    v1.pragma('journal_mode = WAL')
    runMigrations(v1, 1)
    v1.prepare("INSERT INTO company_profile VALUES (1, 'Old Co', '2026-01-01', ?)").run(now)
    v1.prepare("INSERT INTO entity_type_history (entity_type, effective_date, created_at) VALUES ('smllc', '2026-01-01', ?)").run(now)
    v1.prepare("INSERT INTO home_state_history (state_code, effective_date, created_at) VALUES ('CA', '2026-01-01', ?)").run(now)
    v1.close()

    const books = openCompany(root, 'Old Co')
    expect(getSchemaVersion(books.db)).toBe(LATEST_SCHEMA_VERSION)
    expect(books.profile()).toMatchObject({ name: 'Old Co', entityType: 'smllc', homeState: 'CA' })
    const baseline = books.db.prepare("SELECT table_name FROM audit_log WHERE action = 'baseline' ORDER BY id").all()
    expect(baseline).toEqual([
      { table_name: 'company_profile' },
      { table_name: 'entity_type_history' },
      { table_name: 'home_state_history' }
    ])
    books.close()

    const backups = readdirSync(join(dir, 'backups'))
    const preUpgrade = backups.find((f) => f.includes('before-upgrade-v1-to-v2'))
    expect(preUpgrade).toBeDefined()
    const saved = new Database(join(dir, 'backups', preUpgrade!), { readonly: true })
    expect(getSchemaVersion(saved)).toBe(1)
    saved.close()
  })

  it('new companies start at the latest version with their setup in the audit log', () => {
    const folder = createCompany(root, {
      name: 'New Co',
      entityType: 's_corp',
      homeState: 'CA',
      booksStartDate: '2026-01-01'
    })
    const books = openCompany(root, folder)
    expect(getSchemaVersion(books.db)).toBe(LATEST_SCHEMA_VERSION)
    const inserts = books.db.prepare("SELECT table_name FROM audit_log WHERE action = 'insert'").all()
    expect(inserts).toHaveLength(3)
    books.close()
  })
})
