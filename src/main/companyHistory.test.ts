import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyChart, getChart, missingAccounts, restoreAccounts } from './chart'
import { runMigrations } from './db/migrations'
import { addEntityTypeChange, correctStartingEntityType, getHistory, removeEntityTypeChange } from './companyHistory'
import { setLockedThrough } from './ledger'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  db.prepare("INSERT INTO company_profile (id, name, books_start_date, created_at) VALUES (1, 'X', '2026-01-01', 'x')").run()
  db.prepare("INSERT INTO entity_type_history (entity_type, effective_date, created_at) VALUES ('smllc', '2026-01-01', 'x')").run()
  db.prepare("INSERT INTO home_state_history (state_code, effective_date, created_at) VALUES ('CA', '2026-01-01', 'x')").run()
})

afterEach(() => db.close())

function change(entityType: string, effectiveDate: string): void {
  addEntityTypeChange(db, { entityType, effectiveDate })
}

describe('correcting the starting entity type', () => {
  const starting = (): string => getHistory(db).entityTypes[0].value

  it('replaces the starting type and keeps its date', () => {
    correctStartingEntityType(db, 'mmllc')
    expect(getHistory(db).entityTypes).toEqual([{ effectiveDate: '2026-01-01', value: 'mmllc' }])
  })

  it('leaves later changes alone', () => {
    change('llc_s_corp', '2026-07-01')
    correctStartingEntityType(db, 'sole_prop')
    expect(getHistory(db).entityTypes.map((r) => r.value)).toEqual(['sole_prop', 'llc_s_corp'])
  })

  it('refuses the type it already has, or an unknown one', () => {
    expect(() => correctStartingEntityType(db, 'smllc')).toThrow(/already Single-member LLC/)
    expect(() => correctStartingEntityType(db, 'nonsense')).toThrow(/Choose an entity type/)
    expect(starting()).toBe('smllc')
  })

  it('is refused when the books are closed through the start date or later', () => {
    setLockedThrough(db, '2026-01-31')
    expect(() => correctStartingEntityType(db, 'c_corp')).toThrow(/closed through 2026-01-31/)
    expect(starting()).toBe('smllc')
  })

  it('works again once the period is reopened', () => {
    setLockedThrough(db, '2026-01-31')
    setLockedThrough(db, null, 'Starting type was entered wrong')
    correctStartingEntityType(db, 'c_corp')
    expect(starting()).toBe('c_corp')
  })

  it('does not touch accounts, and is audited', () => {
    correctStartingEntityType(db, 'c_corp')
    expect((db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(0)
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE table_name = 'entity_type_history' AND action = 'update'")
      .get() as { n: number }
    expect(n.n).toBe(1)
  })
})

describe('entity type change', () => {
  it('records a change with its start date, oldest first', () => {
    change('llc_s_corp', '2026-07-01')
    expect(getHistory(db).entityTypes).toEqual([
      { effectiveDate: '2026-01-01', value: 'smllc' },
      { effectiveDate: '2026-07-01', value: 'llc_s_corp' }
    ])
  })

  it('allows a future start date', () => {
    change('llc_s_corp', '2099-01-01')
    expect(getHistory(db).entityTypes).toHaveLength(2)
  })

  it('refuses a date before the books start', () => {
    expect(() => change('llc_s_corp', '2025-12-31')).toThrow(/books start on 2026-01-01/)
  })

  it('refuses a date on or before the closed-through date', () => {
    setLockedThrough(db, '2026-06-30')
    expect(() => change('llc_s_corp', '2026-03-01')).toThrow(/closed through 2026-06-30/)
    expect(() => change('llc_s_corp', '2026-06-30')).toThrow(/closed through/)
    change('llc_s_corp', '2026-07-01')
    expect(getHistory(db).entityTypes).toHaveLength(2)
  })

  it('allows the earlier date once the period is reopened', () => {
    setLockedThrough(db, '2026-06-30')
    setLockedThrough(db, null, 'Accountant says the election started in March')
    change('llc_s_corp', '2026-03-01')
    expect(getHistory(db).entityTypes[1].effectiveDate).toBe('2026-03-01')
  })

  it('refuses a date that already has an entry', () => {
    change('llc_s_corp', '2026-07-01')
    expect(() => change('c_corp', '2026-07-01')).toThrow(/already a change to the entity type starting on 2026-07-01/)
    expect(() => change('c_corp', '2026-01-01')).toThrow(/already a change to the entity type/)
  })

  it('refuses a change to the type already in force', () => {
    expect(() => change('smllc', '2026-05-01')).toThrow(/already Single-member LLC/)
    change('llc_s_corp', '2026-07-01')
    expect(() => change('llc_s_corp', '2026-09-01')).toThrow(/already LLC taxed as S-corp/)
  })

  it('checks against what is in force on that date, not today', () => {
    change('llc_s_corp', '2026-07-01')
    expect(() => change('smllc', '2026-04-01')).toThrow(/already Single-member LLC/)
    change('c_corp', '2026-04-01')
    expect(getHistory(db).entityTypes.map((r) => r.value)).toEqual(['smllc', 'c_corp', 'llc_s_corp'])
  })

  it('refuses an unknown entity type or bad date', () => {
    expect(() => change('nonsense', '2026-05-01')).toThrow(/Choose an entity type/)
    expect(() => change('c_corp', '2026-02-30')).toThrow(/valid start date/)
  })

  it('does not touch home state history or accounts', () => {
    change('llc_s_corp', '2026-07-01')
    expect(getHistory(db).homeStates).toHaveLength(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(0)
  })

  it('is recorded in the audit log', () => {
    change('llc_s_corp', '2026-07-01')
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE table_name = 'entity_type_history' AND action = 'insert'")
      .get() as { n: number }
    expect(n.n).toBeGreaterThan(0)
  })
})

describe('chart update on an entity change', () => {
  const numbers = (): string[] =>
    (db.prepare('SELECT number FROM accounts ORDER BY number').all() as { number: string }[]).map((r) => r.number)
  const nameAt = (n: string): string | undefined =>
    (db.prepare('SELECT name FROM accounts WHERE number = ?').get(n) as { name: string } | undefined)?.name

  it('adds the new type accounts, giving a free number where the usual one is taken', () => {
    applyChart(db, 'product', 'smllc')
    const before = numbers()
    const result = addEntityTypeChange(db, { entityType: 'llc_s_corp', effectiveDate: '2026-07-01' })
    const added = Object.fromEntries(result.added.map((a) => [a.name, a]))
    expect(added["Members' capital"]).toMatchObject({ number: '3010', wantedNumber: '3000' })
    expect(added['Additional paid-in capital']).toMatchObject({ number: '3110', wantedNumber: '3100' })
    expect(added['Retained earnings'].number).toBe('3300')
    expect(added['Officer compensation'].number).toBe('6010')
    expect(added['Loans from shareholders'].number).toBe('2400')
    expect(result.notAdded).toEqual([])
    // Owner draws already covers distributions, so no duplicate is added.
    expect(added['Shareholder distributions']).toBeUndefined()
    // Nothing that was there before changed.
    expect(nameAt('3000')).toBe("Owner's capital")
    for (const n of before) expect(numbers()).toContain(n)
  })

  it('does not bring back accounts the owner deleted or renumbered', () => {
    db.prepare("UPDATE entity_type_history SET entity_type = 'c_corp'").run()
    applyChart(db, 'general', 'c_corp')
    db.prepare("DELETE FROM accounts WHERE name = 'Loans from shareholders'").run()
    db.prepare("UPDATE accounts SET number = '3350' WHERE name = 'Retained earnings'").run()
    const result = addEntityTypeChange(db, { entityType: 's_corp', effectiveDate: '2026-07-01' })
    expect(result.added).toEqual([])
    expect(numbers()).not.toContain('2400')
    expect(numbers()).not.toContain('3300')
  })

  it('adds nothing when the company has no chart yet, but still records the change', () => {
    const result = addEntityTypeChange(db, { entityType: 'llc_s_corp', effectiveDate: '2026-07-01' })
    expect(result).toEqual({ added: [], notAdded: [], covered: [] })
    expect(getHistory(db).entityTypes).toHaveLength(2)
  })

  it('reports an account it cannot number when its whole range is full', () => {
    applyChart(db, 'general', 'smllc')
    const insert = db.prepare(
      `INSERT INTO accounts (number, name, type, subtype, normal_balance, tax_category, accountant_note, created_at, updated_at)
       VALUES (?, ?, 'equity', '', 'credit', 'owner_equity', '', 'x', 'x')`
    )
    for (let n = 3010; n < 4000; n += 10) if (!nameAt(String(n))) insert.run(String(n), `Filler ${n}`)
    const result = addEntityTypeChange(db, { entityType: 'llc_s_corp', effectiveDate: '2026-07-01' })
    expect(result.notAdded.map((a) => a.name)).toContain("Members' capital")
  })

  it('leaves the accounts alone if the change is refused', () => {
    applyChart(db, 'general', 'smllc')
    const before = numbers()
    expect(() => addEntityTypeChange(db, { entityType: 'llc_s_corp', effectiveDate: '2025-01-01' })).toThrow()
    expect(numbers()).toEqual(before)
  })

  it('correcting the starting type adds the corrected type accounts', () => {
    applyChart(db, 'general', 'smllc')
    const result = correctStartingEntityType(db, 'mmllc')
    const names = result.added.map((a) => a.name)
    expect(names).toContain('Loans from partners')
    expect(names).toContain('Guaranteed payments to partners')
    expect(getHistory(db).entityTypes[0].value).toBe('mmllc')
  })
})

describe('reporting what an entity change skipped', () => {
  it('says which existing account covers a skipped one', () => {
    applyChart(db, 'general', 'smllc')
    const result = addEntityTypeChange(db, { entityType: 'llc_s_corp', effectiveDate: '2026-07-01' })
    expect(result.covered).toEqual([{ number: '3200', name: 'Shareholder distributions', by: 'Owner draws' }])
  })
})

describe('missing standard accounts and restoring them', () => {
  const chartMissing = (): string[] => getChart(db, 'smllc', '2026-09-01').missing.map((m) => m.name)

  it('lists nothing for a fresh chart or a company with no chart', () => {
    expect(chartMissing()).toEqual([])
    applyChart(db, 'product', 'smllc')
    expect(chartMissing()).toEqual([])
  })

  it('lists an account the owner deleted, and adds it back on its usual number', () => {
    applyChart(db, 'product', 'smllc')
    db.prepare("DELETE FROM accounts WHERE name = 'Packaging'").run()
    expect(chartMissing()).toEqual(['Packaging'])
    const result = restoreAccounts(db, 'product', 'smllc', ['5300'])
    expect(result.added).toEqual([{ number: '5300', name: 'Packaging', wantedNumber: '5300' }])
    expect(chartMissing()).toEqual([])
  })

  it('does not list an account the owner renumbered or renamed to another number', () => {
    applyChart(db, 'product', 'smllc')
    db.prepare("UPDATE accounts SET number = '5350' WHERE name = 'Packaging'").run()
    expect(chartMissing()).toEqual([])
  })

  it('gives a restored account a free number if its usual one is now used by something else', () => {
    applyChart(db, 'product', 'smllc')
    db.prepare("DELETE FROM accounts WHERE name = 'Packaging'").run()
    db.prepare(
      `INSERT INTO accounts (number, name, type, subtype, normal_balance, tax_category, accountant_note, created_at, updated_at)
       VALUES ('5300', 'Something else', 'expense', 'cogs', 'debit', 'cogs_labor', '', 'x', 'x')`
    ).run()
    const [m] = missingAccounts(db, 'product', 'smllc')
    expect(m).toEqual({ number: '5310', name: 'Packaging', wantedNumber: '5300' })
  })

  it('only restores the numbers asked for', () => {
    applyChart(db, 'product', 'smllc')
    db.prepare("DELETE FROM accounts WHERE name IN ('Packaging', 'Materials')").run()
    restoreAccounts(db, 'product', 'smllc', ['5300'])
    expect(chartMissing()).toEqual(['Materials'])
  })
})

describe('removing an entity type change', () => {
  it('removes a later change but leaves the accounts it added', () => {
    applyChart(db, 'general', 'smllc')
    addEntityTypeChange(db, { entityType: 'mmllc', effectiveDate: '2026-07-01' })
    const accounts = (): number => (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n
    const before = accounts()
    removeEntityTypeChange(db, '2026-07-01')
    expect(getHistory(db).entityTypes).toEqual([{ effectiveDate: '2026-01-01', value: 'smllc' }])
    expect(accounts()).toBe(before)
  })

  it('refuses to remove the starting type or something that is not there', () => {
    expect(() => removeEntityTypeChange(db, '2026-01-01')).toThrow(/starting entity type can't be removed/)
    expect(() => removeEntityTypeChange(db, '2026-08-01')).toThrow(/no longer exists/)
  })

  it('refuses when the change starts inside a closed period, and works after reopening', () => {
    addEntityTypeChange(db, { entityType: 'mmllc', effectiveDate: '2026-07-01' })
    setLockedThrough(db, '2026-07-31')
    expect(() => removeEntityTypeChange(db, '2026-07-01')).toThrow(/closed through 2026-07-31/)
    setLockedThrough(db, null, 'Removing a wrong change')
    removeEntityTypeChange(db, '2026-07-01')
    expect(getHistory(db).entityTypes).toHaveLength(1)
  })

  it('is audited', () => {
    addEntityTypeChange(db, { entityType: 'mmllc', effectiveDate: '2026-07-01' })
    removeEntityTypeChange(db, '2026-07-01')
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE table_name = 'entity_type_history' AND action = 'delete'")
      .get() as { n: number }
    expect(n.n).toBe(1)
  })
})
