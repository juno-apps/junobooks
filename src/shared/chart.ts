import type { TaxForm } from './entities'
import type { AccountType, TaxCategoryKey, TaxLine } from './taxLines'
import type { NormalBalance } from './templates'

export interface ChartAccount {
  id: number
  number: string
  name: string
  type: AccountType
  subtype: string
  normalBalance: NormalBalance
  isActive: boolean
  taxCategory: TaxCategoryKey | null
  /** Where this account lands on the company's current federal return. */
  taxLine: TaxLine | null
  accountantNote: string
  description: string
  /** Balance on the account's normal side: positive = normal, negative = unusual. */
  balanceCents: number
  /** Appears in any entry, even a draft: can't be deleted. */
  usedInEntries: boolean
  /** Appears in a posted or voided entry: type and kind can't change. */
  hasPostings: boolean
}

/** A standard account the chart doesn't have. `number` is the number it would get now. */
export interface MissingAccount {
  number: string
  name: string
  /** The number the template normally uses. */
  wantedNumber: string
}

export interface ChartView {
  form: TaxForm
  /** The tax year shown (this year) and the IRS form year its line numbers come from. */
  taxYear: number
  tableYear: number
  accounts: ChartAccount[]
  /** Standard accounts for the template and current entity type that aren't in the chart. */
  missing: MissingAccount[]
}
