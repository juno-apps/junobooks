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
  /** Balance on the account's normal side: positive = normal, negative = unusual. */
  balanceCents: number
}

export interface ChartView {
  form: TaxForm
  /** The tax year shown (this year) and the IRS form year its line numbers come from. */
  taxYear: number
  tableYear: number
  accounts: ChartAccount[]
}
