import type Database from 'better-sqlite3'
import {
  validateHistoryChange,
  type CompanyHistory,
  type EntityAccountChanges,
  type EntityChangeInput,
  type HistoryRow,
  type HomeStateChangeInput
} from '../shared/company'
import { getEntityType, isEntityTypeId, type EntityTypeId } from '../shared/entities'
import { getStateName, isStateCode } from '../shared/states'
import type { TemplateId } from '../shared/templates'
import { addEntityAccounts } from './chart'
import { getLockedThrough } from './ledger'

/** Entity-type and home-state history, oldest first. */
export function getHistory(db: Database.Database): CompanyHistory {
  const rows = (table: string, column: string): HistoryRow[] =>
    db
      .prepare(`SELECT effective_date AS effectiveDate, ${column} AS value FROM ${table} ORDER BY effective_date`)
      .all() as HistoryRow[]
  return {
    entityTypes: rows('entity_type_history', 'entity_type'),
    homeStates: rows('home_state_history', 'state_code')
  }
}

/** The two dated histories share the same rules; this says how each one differs. */
interface Kind {
  table: string
  column: string
  /** Plain-English name, e.g. "entity type". */
  what: string
  /** Word used on the "Correct starting ..." option. */
  short: string
  rows: (db: Database.Database) => HistoryRow[]
  isValid: (value: string) => boolean
  label: (value: string) => string
  pickMessage: string
}

const ENTITY: Kind = {
  table: 'entity_type_history',
  column: 'entity_type',
  what: 'entity type',
  short: 'type',
  rows: (db) => getHistory(db).entityTypes,
  isValid: isEntityTypeId,
  label: (v) => getEntityType(v as EntityTypeId).label,
  pickMessage: 'Choose an entity type.'
}

const HOME_STATE: Kind = {
  table: 'home_state_history',
  column: 'state_code',
  what: 'home state',
  short: 'state',
  rows: (db) => getHistory(db).homeStates,
  isValid: isStateCode,
  label: getStateName,
  pickMessage: 'Choose a home state.'
}

function booksStart(db: Database.Database): string {
  return (db.prepare('SELECT books_start_date AS d FROM company_profile WHERE id = 1').get() as { d: string }).d
}

/** Checks and applies a change starting on a date. Returns the value it replaced. */
function applyAddition(db: Database.Database, k: Kind, value: string, effectiveDate: string, now: Date): string {
  if (!k.isValid(value)) throw new Error(k.pickMessage)
  const rows = k.rows(db)
  const problem = validateHistoryChange({
    what: k.what,
    newLabel: k.label(value),
    newValue: value,
    effectiveDate,
    booksStartDate: booksStart(db),
    lockedThrough: getLockedThrough(db),
    rows
  })
  if (problem) throw new Error(problem)
  const old = rows.filter((r) => r.effectiveDate <= effectiveDate).pop()!.value
  db.prepare(`INSERT INTO ${k.table} (${k.column}, effective_date, created_at) VALUES (?, ?, ?)`).run(
    value,
    effectiveDate,
    now.toISOString()
  )
  return old
}

/** Replaces the starting value (first row, dated on the books start date). Refused if the
 * books are closed through that date, since that would change how closed months are treated.
 * Returns the value it replaced. */
function applyCorrection(db: Database.Database, k: Kind, value: string): string {
  if (!k.isValid(value)) throw new Error(k.pickMessage)
  const locked = getLockedThrough(db)
  const start = booksStart(db)
  if (locked && locked >= start) {
    throw new Error(
      `The books are closed through ${locked}, which includes the day your books start (${start}). Reopen the period first if you need to correct the starting ${k.short}.`
    )
  }
  const first = k.rows(db)[0]
  if (first.value === value) throw new Error(`The starting ${k.what} is already ${k.label(value)}.`)
  db.prepare(`UPDATE ${k.table} SET ${k.column} = ? WHERE effective_date = ?`).run(value, first.effectiveDate)
  return first.value
}

/** Removes a later change (never the starting value). Refused if its start date is inside a closed period. */
function applyRemoval(db: Database.Database, k: Kind, effectiveDate: string): void {
  const rows = k.rows(db)
  if (!rows.some((r) => r.effectiveDate === effectiveDate)) throw new Error('That change no longer exists.')
  if (effectiveDate === rows[0].effectiveDate) {
    throw new Error(`The starting ${k.what} can't be removed. Use "Correct starting ${k.short}" instead.`)
  }
  const locked = getLockedThrough(db)
  if (locked && effectiveDate <= locked) {
    throw new Error(
      `The books are closed through ${locked}, and this change starts on ${effectiveDate}. Reopen the period first if you need to remove it.`
    )
  }
  db.prepare(`DELETE FROM ${k.table} WHERE effective_date = ?`).run(effectiveDate)
}

// ---- Entity type: also adds the accounts the new type needs ----

/** Adds the accounts the new entity type needs, if the company has a chart yet. */
function updateChart(db: Database.Database, oldEntity: string, newEntity: string, now: Date): EntityAccountChanges {
  const row = db.prepare('SELECT template FROM company_profile WHERE id = 1').get() as { template: TemplateId | null }
  if (!row.template) return { added: [], notAdded: [], covered: [] }
  return addEntityAccounts(db, row.template, oldEntity as EntityTypeId, newEntity as EntityTypeId, now)
}

/** Fixes the entity type the books started with. Adds the accounts the corrected type
 * needs; existing accounts are left alone. */
export function correctStartingEntityType(db: Database.Database, entityType: string, now = new Date()): EntityAccountChanges {
  return db.transaction(() => updateChart(db, applyCorrection(db, ENTITY, entityType), entityType, now))()
}

/** Records that the company changes entity type on a date. Adds the accounts the new type
 * needs (now, even for a future date); existing accounts are left alone. */
export function addEntityTypeChange(db: Database.Database, input: EntityChangeInput, now = new Date()): EntityAccountChanges {
  return db.transaction(() =>
    updateChart(db, applyAddition(db, ENTITY, input.entityType, input.effectiveDate, now), input.entityType, now)
  )()
}

/** Removes a later entity-type change. Accounts the change added are left alone. */
export function removeEntityTypeChange(db: Database.Database, effectiveDate: string): void {
  applyRemoval(db, ENTITY, effectiveDate)
}

// ---- Home state: history only (sales tax rates come later) ----

export function addHomeStateChange(db: Database.Database, input: HomeStateChangeInput, now = new Date()): void {
  applyAddition(db, HOME_STATE, input.stateCode, input.effectiveDate, now)
}

export function correctStartingHomeState(db: Database.Database, stateCode: string): void {
  applyCorrection(db, HOME_STATE, stateCode)
}

export function removeHomeStateChange(db: Database.Database, effectiveDate: string): void {
  applyRemoval(db, HOME_STATE, effectiveDate)
}
