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
