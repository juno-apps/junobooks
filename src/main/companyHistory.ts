import type Database from 'better-sqlite3'
import { validateHistoryChange, type CompanyHistory, type EntityChangeInput, type HistoryRow } from '../shared/company'
import { getEntityType, isEntityTypeId } from '../shared/entities'
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

/** Fixes the entity type the books started with (the first history row, dated on the
 * books start date). Refused if the books are closed through that date, since that
 * would change how closed months are treated. Existing accounts are left alone. */
export function correctStartingEntityType(db: Database.Database, entityType: string): void {
  if (!isEntityTypeId(entityType)) throw new Error('Choose an entity type.')
  const start = db.prepare('SELECT books_start_date AS d FROM company_profile WHERE id = 1').get() as { d: string }
  const locked = getLockedThrough(db)
  if (locked && locked >= start.d) {
    throw new Error(
      `The books are closed through ${locked}, which includes the day your books start (${start.d}). Reopen the period first if you need to correct the starting type.`
    )
  }
  const first = getHistory(db).entityTypes[0]
  if (first.value === entityType) throw new Error(`The starting entity type is already ${getEntityType(entityType).label}.`)
  db.prepare('UPDATE entity_type_history SET entity_type = ? WHERE effective_date = ?').run(entityType, first.effectiveDate)
}

/** Records that the company changes entity type on a date. Refused if the date is
 * before the books start, inside a locked period, already used, or changes nothing.
 * Existing accounts are left alone. */
export function addEntityTypeChange(db: Database.Database, input: EntityChangeInput, now = new Date()): void {
  if (!isEntityTypeId(input.entityType)) throw new Error('Choose an entity type.')
  const start = db.prepare('SELECT books_start_date AS d FROM company_profile WHERE id = 1').get() as { d: string }
  const problem = validateHistoryChange({
    what: 'entity type',
    newLabel: getEntityType(input.entityType).label,
    newValue: input.entityType,
    effectiveDate: input.effectiveDate,
    booksStartDate: start.d,
    lockedThrough: getLockedThrough(db),
    rows: getHistory(db).entityTypes
  })
  if (problem) throw new Error(problem)
  db.prepare('INSERT INTO entity_type_history (entity_type, effective_date, created_at) VALUES (?, ?, ?)').run(
    input.entityType,
    input.effectiveDate,
    now.toISOString()
  )
}
