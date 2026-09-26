import type Database from 'better-sqlite3'
import {
  validateHistoryChange,
  type CompanyHistory,
  type EntityAccountChanges,
  type EntityChangeInput,
  type HistoryRow
} from '../shared/company'
import { getEntityType, isEntityTypeId, type EntityTypeId } from '../shared/entities'
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

/** Adds the accounts the new entity type needs, if the company has a chart yet. */
function updateChart(db: Database.Database, oldEntity: string, newEntity: string, now: Date): EntityAccountChanges {
  const row = db.prepare('SELECT template FROM company_profile WHERE id = 1').get() as { template: TemplateId | null }
  if (!row.template) return { added: [], notAdded: [], covered: [] }
  return addEntityAccounts(db, row.template, oldEntity as EntityTypeId, newEntity as EntityTypeId, now)
}

/** Fixes the entity type the books started with (the first history row, dated on the
 * books start date). Refused if the books are closed through that date, since that
 * would change how closed months are treated. Adds the accounts the corrected type needs;
 * existing accounts are left alone. */
export function correctStartingEntityType(db: Database.Database, entityType: string, now = new Date()): EntityAccountChanges {
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
  return db.transaction(() => {
    db.prepare('UPDATE entity_type_history SET entity_type = ? WHERE effective_date = ?').run(entityType, first.effectiveDate)
    return updateChart(db, first.value, entityType, now)
  })()
}

/** Records that the company changes entity type on a date. Refused if the date is
 * before the books start, inside a locked period, already used, or changes nothing.
 * Adds the accounts the new type needs (now, even for a future date); existing accounts
 * are left alone. */
export function addEntityTypeChange(db: Database.Database, input: EntityChangeInput, now = new Date()): EntityAccountChanges {
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
  const oldType = getHistory(db).entityTypes.filter((r) => r.effectiveDate <= input.effectiveDate).pop()!.value
  return db.transaction(() => {
    db.prepare('INSERT INTO entity_type_history (entity_type, effective_date, created_at) VALUES (?, ?, ?)').run(
      input.entityType,
      input.effectiveDate,
      now.toISOString()
    )
    return updateChart(db, oldType, input.entityType, now)
  })()
}

/** Removes a later entity-type change (never the starting type). Refused if its start date is
 * inside a closed period. Accounts the change added are left alone. */
export function removeEntityTypeChange(db: Database.Database, effectiveDate: string): void {
  const rows = getHistory(db).entityTypes
  if (!rows.some((r) => r.effectiveDate === effectiveDate)) throw new Error('That change no longer exists.')
  if (effectiveDate === rows[0].effectiveDate) {
    throw new Error("The starting entity type can't be removed. Use \"Correct starting type\" instead.")
  }
  const locked = getLockedThrough(db)
  if (locked && effectiveDate <= locked) {
    throw new Error(
      `The books are closed through ${locked}, and this change starts on ${effectiveDate}. Reopen the period first if you need to remove it.`
    )
  }
  db.prepare('DELETE FROM entity_type_history WHERE effective_date = ?').run(effectiveDate)
}
