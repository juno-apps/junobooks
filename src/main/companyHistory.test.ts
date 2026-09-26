import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from './db/migrations'
import { addEntityTypeChange, correctStartingEntityType, getHistory } from './companyHistory'
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
