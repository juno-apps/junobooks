/** Year-end records: contractors (1099-NEC), fixed assets, mileage, home office. */

export interface Contractor {
  id: number
  name: string
  address: string
  w9OnFile: boolean
  /** Last four digits of their SSN/EIN only (never the full number). */
  tinLast4: string
  /** Words looked for in payment memos to find payments to them. */
  matchText: string
  notes: string
  isActive: boolean
}

export type ContractorInput = Omit<Contractor, 'id' | 'isActive'>

export interface NecRow {
  contractorId: number
  name: string
  w9OnFile: boolean
  tinLast4: string
  /** Paid by bank, cash or check (counts for the 1099-NEC). */
  paidCents: number
  /** Paid by credit card (reported by the card company, not on the 1099-NEC). */
  paidByCardCents: number
  overThreshold: boolean
  payments: { entryId: number; date: string; memo: string; cents: number; byCard: boolean }[]
}

export interface NecReport {
  year: number
  thresholdCents: number
  rows: NecRow[]
  /** Payments to contract-labor accounts that don't match any contractor. */
  unmatched: { entryId: number; date: string; memo: string; cents: number }[]
}

/** The 1099-NEC reporting threshold for payments made in a year: $600 through 2025, $2,000 from 2026 (check with the accountant). */
export function necThresholdCents(year: number): number {
  return year >= 2026 ? 200000 : 60000
}

export interface FixedAsset {
  id: number
  name: string
  accountId: number | null
  accountName: string | null
  inServiceDate: string
  costCents: number
  disposedDate: string | null
  notes: string
}

export type FixedAssetInput = Omit<FixedAsset, 'id' | 'accountName'>

export interface FixedAssetReport {
  year: number
  assets: (FixedAsset & { placedThisYear: boolean; disposedThisYear: boolean })[]
  totalCostCents: number
  /** Balance of fixed-asset accounts in the books at year end (for comparison). */
  booksCents: number
}

export interface MileageTrip {
  id: number
  date: string
  milesTenths: number
  purpose: string
  fromPlace: string
  toPlace: string
}

export type TripInput = Omit<MileageTrip, 'id'>

export interface MileageReport {
  year: number
  trips: MileageTrip[]
  totalTenths: number
  /** Standard mileage rate typed in for the year, in tenths of a cent per mile (70¢ = 700). */
  rateTenthCents: number | null
  /** Miles × rate, in cents. */
  amountCents: number | null
}

export interface HomeOffice {
  year: number
  officeSqft: number
  homeSqft: number
  rentCents: number
  mortgageInterestCents: number
  propertyTaxCents: number
  utilitiesCents: number
  insuranceCents: number
  repairsCents: number
  otherCents: number
  notes: string
}

export interface HomeOfficeSummary {
  details: HomeOffice | null
  /** Office area ÷ home area, in hundredths of a percent. */
  percentBp: number
  /** Simplified method: $5 per square foot, up to 300 square feet. */
  simplifiedCents: number
  /** Regular method: the office share of the home expenses entered. */
  regularCents: number
}

export function homeOfficeSummary(h: HomeOffice | null): HomeOfficeSummary {
  if (!h || h.homeSqft <= 0) return { details: h, percentBp: 0, simplifiedCents: 0, regularCents: 0 }
  const percentBp = Math.round((h.officeSqft * 10000) / h.homeSqft)
  const expenses =
    h.rentCents +
    h.mortgageInterestCents +
    h.propertyTaxCents +
    h.utilitiesCents +
    h.insuranceCents +
    h.repairsCents +
    h.otherCents
  return {
    details: h,
    percentBp,
    simplifiedCents: Math.min(h.officeSqft, 300) * 500,
    regularCents: Math.round((expenses * h.officeSqft) / h.homeSqft)
  }
}

/** "12.3" → 123 tenths of a mile. */
export function parseMiles(text: string): number | null {
  const m = /^(\d{1,6})(?:\.(\d))?$/.exec(text.trim().replace(/,/g, ''))
  if (!m) return null
  return Number(m[1]) * 10 + Number(m[2] ?? '0')
}

export const formatMiles = (tenths: number): string =>
  `${Math.floor(tenths / 10).toLocaleString('en-US')}.${tenths % 10}`
