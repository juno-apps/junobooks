import { isValidDate } from './dates'
import { isEntityTypeId, type EntityTypeId } from './entities'
import { isStateCode } from './states'
import { isTemplateId, type TemplateId } from './templates'

export interface CompanySummary {
  /** Folder name under Companies\ — the company's stable identifier on this PC. */
  folder: string
  name: string
  /** Entity type and home state in force today. */
  entityType: EntityTypeId
  homeState: string
}

export interface CompanyProfile extends CompanySummary {
  booksStartDate: string
  /** Null until a chart of accounts is set up. */
  template: TemplateId | null
  dir: string
  schemaVersion: number
}

export interface NewCompanyInput {
  name: string
  entityType: string
  homeState: string
  booksStartDate: string
  template: string
}

/** One entry in a company's entity-type or home-state history. */
export interface HistoryRow {
  effectiveDate: string
  /** Entity type id or state code. */
  value: string
}

/** Oldest first. The first row starts on the books start date. */
export interface CompanyHistory {
  entityTypes: HistoryRow[]
  homeStates: HistoryRow[]
}

export interface EntityChangeInput {
  entityType: string
  effectiveDate: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export const MAX_COMPANY_NAME_LENGTH = 100

/** Returns a plain-English problem with the input, or null if it's fine. */
export function validateNewCompany(input: NewCompanyInput): string | null {
  const name = input.name.trim()
  if (!name) return 'Enter a company name.'
  if (name.length > MAX_COMPANY_NAME_LENGTH) return `Company name must be ${MAX_COMPANY_NAME_LENGTH} characters or fewer.`
  if (!/[\p{L}\p{N}]/u.test(name)) return 'Company name needs at least one letter or number.'
  if (!isEntityTypeId(input.entityType)) return 'Choose an entity type.'
  if (!isStateCode(input.homeState)) return 'Choose a home state.'
  if (!isValidDate(input.booksStartDate)) return 'Enter a valid books start date.'
  if (!isTemplateId(input.template)) return 'Choose a starting chart of accounts.'
  return null
}

export interface HistoryChangeCheck {
  /** Plain-English name of what is changing, e.g. "entity type". */
  what: string
  /** Plain-English name of the new value, e.g. "S-corp". */
  newLabel: string
  newValue: string
  effectiveDate: string
  booksStartDate: string
  /** Books-closed-through date, or null if nothing is locked. */
  lockedThrough: string | null
  /** Existing history, oldest first. */
  rows: HistoryRow[]
}

/** Rules for adding an entity-type or home-state change. Returns a plain-English
 * problem, or null if it's fine. Future dates are allowed. */
export function validateHistoryChange(c: HistoryChangeCheck): string | null {
  if (!isValidDate(c.effectiveDate)) return 'Enter a valid start date.'
  if (c.effectiveDate < c.booksStartDate) {
    return `Your books start on ${c.booksStartDate}, so a change can't start earlier.`
  }
  if (c.lockedThrough && c.effectiveDate <= c.lockedThrough) {
    return `The books are closed through ${c.lockedThrough}. Reopen the period first if you need a change that starts on or before that date.`
  }
  if (c.rows.some((r) => r.effectiveDate === c.effectiveDate)) {
    return `There is already a change to the ${c.what} starting on ${c.effectiveDate}. Choose a different date.`
  }
  let inForce: HistoryRow | undefined
  for (const r of c.rows) if (r.effectiveDate <= c.effectiveDate) inForce = r
  if (inForce?.value === c.newValue) return `The ${c.what} is already ${c.newLabel} on ${c.effectiveDate}.`
  return null
}
