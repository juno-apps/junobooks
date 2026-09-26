import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  effectiveSubtype,
  normalBalanceFor,
  numberRangeWarning,
  validateAccountInput,
  type AccountInput
} from '../shared/accounts'
import { ENTITY_TYPES } from '../shared/entities'
import { buildChart, NOTE, TEMPLATES } from '../shared/templates'
import { addAccount, deleteAccount, setAccountActive, updateAccount, type ChartContext } from './accounts'
import { applyChart, getChart } from './chart'
import { runMigrations } from './db/migrations'
import { postEntry, voidEntry } from './ledger'

const ctx: ChartContext = { template: 'product', entity: 'smllc' }

const etsyFees: AccountInput = {
  number: '6120',
  name: 'Etsy fees',
  type: 'expense',
  subtype: '',
  taxCategory: 'commissions_fees',
  description: 'Listing and transaction fees'
}

let db: Database.Database

function id(number: string): number {
  return (db.prepare('SELECT id FROM accounts WHERE number = ?').get(number) as { id: number }).id
}

function row(number: string): Record<string, unknown> {
  return db.prepare('SELECT * FROM accounts WHERE number = ?').get(number) as Record<string, unknown>
}

/** $100 sale: checking up, sales up. */
function sale(accountFor = '1000', date = '2026-03-15'): number {
  return postEntry(db, {
    date,
    lines: [
      { accountId: id(accountFor), amountCents: 10_000 },
      { accountId: id('4000'), amountCents: -10_000 }
    ]
  })
}

function draftLine(accountId: number): void {
  const entry = Number(
    db.prepare("INSERT INTO journal_entries (entry_date, created_at) VALUES ('2026-03-01', 'x')").run().lastInsertRowid
  )
  db.prepare('INSERT INTO journal_lines (entry_id, line_no, account_id, amount_cents) VALUES (?, 1, ?, 500)').run(
    entry,
    accountId
  )
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  db.prepare("INSERT INTO company_profile (id, name, books_start_date, created_at) VALUES (1, 'X', '2026-01-01', 'x')").run()
  applyChart(db, 'product', 'smllc')
})

afterEach(() => db.close())

describe('shared account rules', () => {
  it('match every template account (kind, debit/credit side)', () => {
    for (const t of TEMPLATES) {
      for (const e of ENTITY_TYPES) {
        for (const a of buildChart(t.id, e.id)) {
          expect(normalBalanceFor(a.type, a.subtype), `${t.id}/${e.id} ${a.number}`).toBe(a.normalBalance)
          if (a.type === 'expense') expect(effectiveSubtype(a.type, a.subtype, a.taxCategory)).toBe(a.subtype)
        }
      }
    }
  })

  it('validates input in plain English', () => {
    expect(validateAccountInput(etsyFees)).toBeNull()
    expect(validateAccountInput({ ...etsyFees, number: '61-20' })).toMatch(/digits only/)
    expect(validateAccountInput({ ...etsyFees, name: '  ' })).toMatch(/name/)
    expect(validateAccountInput({ ...etsyFees, taxCategory: '' })).toMatch(/tax category/)
    expect(validateAccountInput({ ...etsyFees, taxCategory: 'cash' })).toMatch(/doesn't fit/)
    expect(validateAccountInput({ ...etsyFees, type: 'asset', taxCategory: 'cash', subtype: 'cogs' })).toMatch(/kind/)
  })

  it('warns, but only warns, about numbers outside the usual range', () => {
    expect(numberRangeWarning('expense', 'commissions_fees', '6120')).toBeNull()
    expect(numberRangeWarning('expense', 'cogs_other', '5400')).toBeNull()
    expect(numberRangeWarning('expense', 'commissions_fees', '1500')).toMatch(/6000–6999/)
    expect(numberRangeWarning('expense', 'cogs_other', '6400')).toMatch(/5000–5999/)
    expect(numberRangeWarning('asset', 'cash', '1020')).toBeNull()
  })
})

describe('addAccount', () => {
  it('adds an account with the right kind and side', () => {
    addAccount(db, etsyFees, ctx)
    expect(row('6120')).toMatchObject({
      name: 'Etsy fees',
      type: 'expense',
      subtype: '',
      normal_balance: 'debit',
      tax_category: 'commissions_fees',
      accountant_note: '',
      description: 'Listing and transaction fees',
      is_active: 1
    })
    addAccount(db, { ...etsyFees, number: '5400', name: 'Chain', taxCategory: 'cogs_materials' }, ctx)
    expect(row('5400')).toMatchObject({ subtype: 'cogs', normal_balance: 'debit' })
    addAccount(db, { ...etsyFees, number: '1020', name: 'PayPal', type: 'asset', subtype: 'bank', taxCategory: 'cash' }, ctx)
    expect(row('1020')).toMatchObject({ subtype: 'bank', normal_balance: 'debit' })
    addAccount(
      db,
      { ...etsyFees, number: '4095', name: 'Discounts', type: 'income', subtype: 'contra', taxCategory: 'returns_allowances' },
      ctx
    )
    expect(row('4095')).toMatchObject({ normal_balance: 'debit' })
  })

  it('rejects duplicate numbers and names', () => {
    expect(() => addAccount(db, { ...etsyFees, number: '6100' }, ctx)).toThrow(/6100 is already used/)
    expect(() => addAccount(db, { ...etsyFees, name: 'bank FEES' }, ctx)).toThrow(/already an account named/)
  })

  it('flags "Other expenses" for the accountant, like the templates do', () => {
    addAccount(db, { ...etsyFees, taxCategory: 'other_expenses' }, ctx)
    expect(row('6120').accountant_note).toBe(NOTE.otherExpenses)
  })

  it("won't create special JunoBooks accounts", () => {
    expect(() =>
      addAccount(db, { ...etsyFees, type: 'equity', subtype: 'opening_balance', taxCategory: 'opening_balance' }, ctx)
    ).toThrow(/kind/)
  })
})

describe('updateAccount', () => {
  const input = (number: string, changes: Partial<AccountInput> = {}): AccountInput => {
    const r = row(number)
    return {
      number: r.number as string,
      name: r.name as string,
      type: r.type as AccountInput['type'],
      subtype: r.subtype as AccountInput['subtype'],
      taxCategory: r.tax_category as AccountInput['taxCategory'],
      description: r.description as string,
      ...changes
    }
  }

  it('renames and renumbers even after posting', () => {
    sale()
    updateAccount(db, id('1000'), input('1000', { number: '1001', name: 'Chase checking' }), ctx)
    expect(row('1001')).toMatchObject({ name: 'Chase checking' })
    expect(getChart(db, 'smllc', '2026-09-25').accounts.find((a) => a.number === '1001')!.balanceCents).toBe(10_000)
  })

  it('locks type and debit/credit side once posted, but not for drafts', () => {
    const petty = id('1050')
    draftLine(petty)
    updateAccount(db, petty, input('1050', { type: 'expense', subtype: '', taxCategory: 'supplies' }), ctx)
    expect(row('1050').type).toBe('expense')

    sale()
    expect(() =>
      updateAccount(db, id('1000'), input('1000', { type: 'liability', subtype: '', taxCategory: 'other_current_liabilities' }), ctx)
    ).toThrow(/posted entries/)
    expect(() => updateAccount(db, id('1000'), input('1000', { subtype: 'contra' }), ctx)).toThrow(/posted entries/)
    // Same side, different kind: fine.
    updateAccount(db, id('1000'), input('1000', { subtype: '' }), ctx)
    expect(row('1000').subtype).toBe('')
  })

  it('flags a changed tax category, and restores the template note when changed back', () => {
    updateAccount(db, id('6100'), input('6100', { taxCategory: 'other_expenses' }), ctx)
    expect(row('6100').accountant_note).toMatch(/changed from "Commissions and fees" to "Other expenses"/)
    updateAccount(db, id('6100'), input('6100', { taxCategory: 'commissions_fees' }), ctx)
    expect(row('6100').accountant_note).toBe(NOTE.marketplaceFees)
    // Unchanged category keeps whatever note is there.
    updateAccount(db, id('6100'), input('6100', { name: 'Etsy and PayPal fees' }), ctx)
    expect(row('6100').accountant_note).toBe(NOTE.marketplaceFees)
  })

  it('moves an expense between cost of goods sold and expenses by tax category', () => {
    sale()
    updateAccount(db, id('5300'), input('5300', { taxCategory: 'supplies' }), ctx)
    expect(row('5300').subtype).toBe('')
  })

  it("keeps special JunoBooks accounts' type", () => {
    expect(() =>
      updateAccount(db, id('3999'), input('3999', { type: 'liability', taxCategory: 'other_liabilities' }), ctx)
    ).toThrow(/special purpose/)
    updateAccount(db, id('3999'), input('3999', { name: 'Opening balances' }), ctx)
    expect(row('3999')).toMatchObject({ name: 'Opening balances', subtype: 'opening_balance' })
  })

  it('rejects a clash with another account', () => {
    expect(() => updateAccount(db, id('6110'), input('6110', { number: '6100' }), ctx)).toThrow(/already used/)
  })
})

describe('deactivating', () => {
  it('is blocked while the account has a balance, including future-dated entries', () => {
    sale('1000', '2027-01-05')
    expect(() => setAccountActive(db, id('1000'), false)).toThrow(/balance of \$100\.00/)
    expect(() => setAccountActive(db, id('4000'), false)).toThrow(/balance of \$100\.00/)
  })

  it('works at zero balance; inactive accounts then refuse postings and voids', () => {
    const first = sale('1010')
    postEntry(db, {
      date: '2026-03-20',
      lines: [
        { accountId: id('1000'), amountCents: 10_000 },
        { accountId: id('1010'), amountCents: -10_000 }
      ]
    })
    setAccountActive(db, id('1010'), false)
    expect(row('1010').is_active).toBe(0)
    expect(() => sale('1010')).toThrow(/inactive/)
    expect(() => voidEntry(db, first, 'mistake')).toThrow(/Reactivate it/)

    setAccountActive(db, id('1010'), true)
    voidEntry(db, first, 'mistake')
  })

  it('is enforced by the database too', () => {
    sale()
    expect(() => db.prepare("UPDATE accounts SET is_active = 0 WHERE number = '1000'").run()).toThrow(/still has a balance/)
    db.prepare("UPDATE accounts SET is_active = 0 WHERE number = '1050'").run()
    expect(() => draftLine(id('1050'))).toThrow(/inactive/)
  })

  it('blocks posting a draft that uses an account deactivated since', () => {
    draftLine(id('1050'))
    const entry = (db.prepare('SELECT MAX(id) AS id FROM journal_entries').get() as { id: number }).id
    db.prepare('INSERT INTO journal_lines (entry_id, line_no, account_id, amount_cents) VALUES (?, 2, ?, -500)').run(
      entry,
      id('4000')
    )
    setAccountActive(db, id('1050'), false)
    expect(() =>
      db.prepare("UPDATE journal_entries SET status = 'posted', posted_at = 'x' WHERE id = ?").run(entry)
    ).toThrow(/inactive/)
  })
})

describe('deleteAccount', () => {
  it('deletes an unused account and logs it', () => {
    const accountId = addAccount(db, etsyFees, ctx)
    deleteAccount(db, accountId)
    expect(db.prepare("SELECT 1 FROM accounts WHERE number = '6120'").get()).toBeUndefined()
    expect(
      db.prepare("SELECT 1 FROM audit_log WHERE action = 'delete' AND table_name = 'accounts' AND record_id = ?").get(accountId)
    ).toBeDefined()
  })

  it('refuses accounts used in any entry, even a draft, and special accounts', () => {
    sale()
    expect(() => deleteAccount(db, id('1000'))).toThrow(/Deactivate it instead/)
    draftLine(id('1050'))
    expect(() => deleteAccount(db, id('1050'))).toThrow(/Deactivate it instead/)
    expect(() => deleteAccount(db, id('3999'))).toThrow(/special purpose/)
  })
})

describe('chart view', () => {
  it('shows usage, postings and descriptions', () => {
    addAccount(db, etsyFees, ctx)
    sale()
    draftLine(id('1050'))
    const chart = getChart(db, 'smllc', '2026-09-25')
    const a = (n: string) => chart.accounts.find((x) => x.number === n)!
    expect(a('1000')).toMatchObject({ usedInEntries: true, hasPostings: true })
    expect(a('1050')).toMatchObject({ usedInEntries: true, hasPostings: false })
    expect(a('6120')).toMatchObject({ usedInEntries: false, hasPostings: false, description: 'Listing and transaction fees' })
  })
})
