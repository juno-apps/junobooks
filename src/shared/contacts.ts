/** Contacts: suppliers (stored here) plus a read-only view of customers and contractors, which keep their own records. */

export type SupplierKind = 'supplier' | 'metal_dealer' | 'service' | 'other'

export const SUPPLIER_KINDS: { value: SupplierKind; label: string }[] = [
  { value: 'supplier', label: 'Materials and supplies' },
  { value: 'metal_dealer', label: 'Refiner or metal dealer' },
  { value: 'service', label: 'Services' },
  { value: 'other', label: 'Other' }
]

export interface SupplierInput {
  name: string
  kind: SupplierKind
  contactPerson: string
  email: string
  phone: string
  website: string
  address: string
  /** Your account or customer number with them. */
  accountNumber: string
  /** Days to pay a bill (e.g. 30 for net 30); null = not set. */
  termsDays: number | null
  /** Where their purchases usually go (an expense, cost of goods sold or inventory account); null = not set. */
  defaultAccountId: number | null
  notes: string
}

export interface Supplier extends SupplierInput {
  id: number
  isActive: boolean
}

/** One row of the combined Contacts list. */
export interface ContactRow {
  role: 'supplier' | 'customer' | 'contractor'
  id: number
  name: string
  /** Kind label, e.g. "Refiner or metal dealer", "Customer (wholesale)", "Contractor (W-9 on file)". */
  detail: string
  contactPerson: string
  email: string
  phone: string
  isActive: boolean
}

export const NAME_MAX = 120

/** A plain-English problem with a supplier, or null. */
export function supplierProblem(s: SupplierInput): string | null {
  const name = s.name.trim()
  if (!name) return 'Enter the company’s name.'
  if (name.length > NAME_MAX) return 'That name is too long.'
  if (!SUPPLIER_KINDS.some((k) => k.value === s.kind)) return 'Choose what kind of company this is.'
  if (s.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim()))
    return 'That email address doesn’t look right.'
  if (s.termsDays !== null && (!Number.isInteger(s.termsDays) || s.termsDays < 0 || s.termsDays > 365))
    return 'Payment terms are a number of days from 0 to 365.'
  return null
}

export function supplierKindLabel(kind: SupplierKind): string {
  return SUPPLIER_KINDS.find((k) => k.value === kind)?.label ?? kind
}
