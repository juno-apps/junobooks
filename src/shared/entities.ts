/** Entity types a company can have, and the federal return each one files.
 * Shared by the main process (validation, database) and the UI (dropdowns). */

export type EntityTypeId =
  | 'sole_prop'
  | 'smllc'
  | 'mmllc'
  | 'llc_s_corp'
  | 's_corp'
  | 'c_corp'
  | 'partnership'

export type TaxForm = 'schedule_c' | '1065' | '1120s' | '1120'

export interface EntityType {
  id: EntityTypeId
  label: string
  taxForm: TaxForm
  hint: string
}

export const ENTITY_TYPES: EntityType[] = [
  { id: 'sole_prop', label: 'Sole proprietor', taxForm: 'schedule_c', hint: 'One owner, no LLC or corporation.' },
  { id: 'smllc', label: 'Single-member LLC', taxForm: 'schedule_c', hint: 'One-owner LLC, taxed like a sole proprietor.' },
  { id: 'mmllc', label: 'Multi-member LLC', taxForm: '1065', hint: 'LLC with two or more owners, taxed as a partnership.' },
  { id: 'llc_s_corp', label: 'LLC taxed as S-corp', taxForm: '1120s', hint: 'An LLC that elected S-corp tax treatment (Form 2553).' },
  { id: 's_corp', label: 'S-corp', taxForm: '1120s', hint: 'A corporation with an S election.' },
  { id: 'c_corp', label: 'C-corp', taxForm: '1120', hint: 'A regular corporation.' },
  { id: 'partnership', label: 'Partnership', taxForm: '1065', hint: 'Two or more owners, not an LLC.' }
]

export const TAX_FORM_LABELS: Record<TaxForm, string> = {
  schedule_c: 'Schedule C (Form 1040)',
  '1065': 'Form 1065',
  '1120s': 'Form 1120-S',
  '1120': 'Form 1120'
}

export function isEntityTypeId(value: string): value is EntityTypeId {
  return ENTITY_TYPES.some((e) => e.id === value)
}

export function getEntityType(id: EntityTypeId): EntityType {
  const found = ENTITY_TYPES.find((e) => e.id === id)
  if (!found) throw new Error(`Unknown entity type: ${id}`)
  return found
}
