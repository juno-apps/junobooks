import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from './db/migrations'
import {
  accountBalances,
  getEntry,
  getLockedThrough,
  postEntry,
  reverseEntry,
  setLockedThrough,
  voidEntry,
  type EntryInput
} from './ledger'

let db: Database.Database
let cash: number
let sales: number
let fees: number

function addAccount(number: string, type: string, active = 1): number {
  const now = new Date().toISOString()
  return Number(
    db
      .prepare('INSERT INTO accounts (number, name, type, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(number, `Account ${number}`, type, active, now, now).lastInsertRowid
  )
}

function balanceOf(accountId: number, asOf?: string): number {
  return accountBalances(db, asOf).find((b) => b.accountId === accountId)!.balanceCents
}

/** A $100 Etsy sale with a $6.50 fee, deposited net. */
function sale(date = '2026-03-15'): EntryInput {
  return {
    date,
    memo: 'Etsy order',
    lines: [
      { accountId: cash, amountCents: 9_350 },
      { accountId: fees, amountCents: 650 },
      { accountId: sales, amountCents: -10_000 }
    ]
  }
}

function entryCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get() as { n: number }).n
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  cash = addAccount('1000', 'asset')
  sales = addAccount('4000', 'income')
  fees = addAccount('6100', 'expense')
})

afterEach(() => db.close())

describe('postEntry', () => {
  it('posts a balanced split entry and updates balances', () => {
    const id = postEntry(db, sale())
    expect(getEntry(db, id)).toMatchObject({ status: 'posted', source: 'manual', memo: 'Etsy order' })
    expect(getEntry(db, id)!.lines).toHaveLength(3)
    expect(balanceOf(cash)).toBe(9_350)
    expect(balanceOf(fees)).toBe(650)
    expect(balanceOf(sales)).toBe(-10_000)
  })

  it('keeps the trial balance at zero', () => {
    postEntry(db, sale())
    postEntry(db, sale('2026-04-01'))
    expect(accountBalances(db).reduce((s, b) => s + b.balanceCents, 0)).toBe(0)
  })

  it('explains an unbalanced entry in dollars', () => {
    const bad = sale()
    bad.lines[0].amountCents = 9_300
    expect(() => postEntry(db, bad)).toThrow("Debits ($99.50) and credits ($100.00) don't match — off by $0.50.")
    expect(entryCount()).toBe(0)
  })

  it.each([
    ['fractional cents', { amountCents: 10.5 }, /whole cents/],
    ['zero amount', { amountCents: 0 }, /can't be zero/],
    ['unknown account', { accountId: 999 }, /doesn't exist/]
  ])('rejects %s', (_label, change, message) => {
    const bad = sale()
    Object.assign(bad.lines[0], change)
    expect(() => postEntry(db, bad)).toThrow(message)
    expect(entryCount()).toBe(0)
  })

  it('rejects single-line entries, bad dates and inactive accounts', () => {
    expect(() => postEntry(db, { date: '2026-01-01', lines: [{ accountId: cash, amountCents: 1 }] })).toThrow(/two lines/)
    expect(() => postEntry(db, sale('2026-13-01'))).toThrow(/valid date/)
    const old = addAccount('1999', 'asset', 0)
    const bad = sale()
    bad.lines[0].accountId = old
    expect(() => postEntry(db, bad)).toThrow(/inactive/)
    expect(entryCount()).toBe(0)
  })
})

describe('voidEntry', () => {
  it('removes the entry from balances but keeps it on record', () => {
    const id = postEntry(db, sale())
    voidEntry(db, id, 'Entered twice')
    expect(getEntry(db, id)).toMatchObject({ status: 'void', voidReason: 'Entered twice' })
    expect(getEntry(db, id)!.lines).toHaveLength(3)
    expect(balanceOf(cash)).toBe(0)
  })

  it('needs a reason and only works once', () => {
    const id = postEntry(db, sale())
    expect(() => voidEntry(db, id, '  ')).toThrow(/needs a reason/)
    voidEntry(db, id, 'Mistake')
    expect(() => voidEntry(db, id, 'Again')).toThrow(/already voided/)
    expect(() => voidEntry(db, 999, 'x')).toThrow(/doesn't exist/)
  })
})

describe('reverseEntry', () => {
  it('posts an equal-and-opposite entry linked to the original', () => {
    const id = postEntry(db, sale())
    const rev = reverseEntry(db, id, '2026-04-01')
    expect(getEntry(db, rev)).toMatchObject({
      status: 'posted',
      source: 'reversal',
      reversesEntryId: id,
      memo: `Reversal of entry #${id}: Etsy order`
    })
    expect(getEntry(db, id)!.reversedById).toBe(rev)
    expect(balanceOf(cash)).toBe(0)
    expect(balanceOf(cash, '2026-03-31')).toBe(9_350)
  })

  it("can't reverse twice, reverse a voided entry, or be dated before the original", () => {
    const id = postEntry(db, sale())
    expect(() => reverseEntry(db, id, '2026-03-14')).toThrow(/before the entry/)
    reverseEntry(db, id, '2026-04-01')
    expect(() => reverseEntry(db, id, '2026-04-02')).toThrow(/already reversed/)

    const other = postEntry(db, sale())
    voidEntry(db, other, 'Mistake')
    expect(() => reverseEntry(db, other, '2026-04-01')).toThrow(/already voided/)
  })

  it("won't void a reversed entry, but voiding the reversal frees it again", () => {
    const id = postEntry(db, sale())
    const rev = reverseEntry(db, id, '2026-04-01')
    expect(() => voidEntry(db, id, 'x')).toThrow(/already reversed/)
    voidEntry(db, rev, 'Reversed by mistake')
    expect(getEntry(db, id)!.reversedById).toBeNull()
    reverseEntry(db, id, '2026-04-02')
  })
})

describe('period lock', () => {
  it('blocks posting and voiding on or before the lock date', () => {
    const march = postEntry(db, sale('2026-03-15'))
    setLockedThrough(db, '2026-03-31')
    expect(getLockedThrough(db)).toBe('2026-03-31')
    expect(() => postEntry(db, sale('2026-03-31'))).toThrow(/closed through 2026-03-31/)
    expect(() => voidEntry(db, march, 'x')).toThrow(/closed through/)
    postEntry(db, sale('2026-04-01'))
  })

  it('lets a locked entry be corrected by reversing it into an open period', () => {
    const march = postEntry(db, sale('2026-03-15'))
    setLockedThrough(db, '2026-03-31')
    expect(() => reverseEntry(db, march, '2026-03-31')).toThrow(/closed/)
    reverseEntry(db, march, '2026-04-01')
    expect(balanceOf(cash, '2026-03-31')).toBe(9_350)
    expect(balanceOf(cash)).toBe(0)
  })

  it('moving the lock forward needs no reason; reopening does, and is recorded', () => {
    setLockedThrough(db, '2026-03-31')
    setLockedThrough(db, '2026-06-30')
    expect(() => setLockedThrough(db, '2026-03-31')).toThrow(/needs a reason/)
    expect(() => setLockedThrough(db, null)).toThrow(/needs a reason/)
    setLockedThrough(db, '2026-03-31', 'Accountant found a missing April receipt')
    expect(getLockedThrough(db)).toBe('2026-03-31')

    const reasons = db
      .prepare("SELECT json_extract(new_values, '$.reason') AS reason FROM audit_log WHERE table_name = 'period_lock_history'")
      .all()
      .map((r) => (r as { reason: string }).reason)
    expect(reasons).toEqual(['', '', 'Accountant found a missing April receipt'])
  })

  it('is enforced by the database even if the ledger code is bypassed', () => {
    const id = postEntry(db, sale('2026-03-15'))
    setLockedThrough(db, '2026-03-31')
    expect(() =>
      db.prepare("UPDATE journal_entries SET status = 'void', voided_at = 'x', void_reason = 'x' WHERE id = ?").run(id)
    ).toThrow(/closed/)
    expect(() =>
      db.prepare("INSERT INTO period_lock_history (locked_through, created_at) VALUES ('2026-01-31', 'x')").run()
    ).toThrow(/needs a reason/)
    expect(() => db.prepare('DELETE FROM period_lock_history').run()).toThrow(/can't be changed/)
  })
})

describe('accountBalances', () => {
  it('counts only posted entries up to the as-of date', () => {
    postEntry(db, sale('2026-03-15'))
    postEntry(db, sale('2026-05-15'))
    db.prepare("INSERT INTO journal_entries (entry_date, created_at) VALUES ('2026-03-20', 'x')").run() // a draft
    expect(balanceOf(sales, '2026-03-14')).toBe(0)
    expect(balanceOf(sales, '2026-03-15')).toBe(-10_000)
    expect(balanceOf(sales)).toBe(-20_000)
  })

  it('lists accounts with no activity at zero', () => {
    expect(accountBalances(db)).toEqual([
      { accountId: cash, balanceCents: 0 },
      { accountId: sales, balanceCents: 0 },
      { accountId: fees, balanceCents: 0 }
    ])
  })
})
