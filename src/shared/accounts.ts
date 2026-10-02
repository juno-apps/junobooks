import { getTaxCategory, type AccountType, type TaxCategoryKey } from './taxLines'
import type { AccountSubtype, NormalBalance } from './templates'

/** What the owner fills in to add or edit an account. */
export interface AccountInput {
  number: string
  name: string
  type: AccountType
  /** The account's kind within its type. Ignored for expenses (cost of goods sold follows the tax category). */
  subtype: AccountSubtype
  taxCategory: TaxCategoryKey | ''
  description: string
  /** Sub-account of this account (same type, one level deep). Omitted on edit = unchanged; null = top level. */
  parentId?: number | null
}

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' }
]

/** The kinds the owner can pick for each type. Expenses have none to pick. */
export const SUBTYPE_OPTIONS: Record<AccountType, { value: AccountSubtype; label: string }[]> = {
  asset: [
    { value: '', label: 'Regular' },
    { value: 'bank', label: 'Bank account' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'fixed_asset', label: 'Equipment or other fixed asset' },
    { value: 'contra', label: 'Reduces another asset (e.g. accumulated depreciation)' }
  ],
  liability: [
    { value: '', label: 'Regular' },
    { value: 'credit_card', label: 'Credit card' },
    { value: 'sales_tax', label: 'Sales tax' },
    { value: 'payroll', label: 'Payroll' }
  ],
  equity: [
    { value: '', label: 'Regular' },
    { value: 'owner_draw', label: 'Draws, distributions or dividends' }
  ],
  income: [
    { value: '', label: 'Regular' },
    { value: 'contra', label: 'Refunds and returns (reduces income)' }
  ],
  expense: []
}

/** Kinds the app sets up itself; they can't be picked, and an account that has one keeps it. */
export const SYSTEM_SUBTYPES: AccountSubtype[] = ['opening_balance']

export const NAME_MAX = 100

/** The subtype actually stored. For expenses it follows the tax category. */
export function effectiveSubtype(type: AccountType, subtype: AccountSubtype, taxCategory: string): AccountSubtype {
  if (type === 'expense') return taxCategory.startsWith('cogs_') ? 'cogs' : ''
  return subtype
}

/** Which side increases the account: the type's natural side, flipped for contra and draw accounts. */
export function normalBalanceFor(type: AccountType, subtype: AccountSubtype): NormalBalance {
  const natural: NormalBalance = type === 'asset' || type === 'expense' ? 'debit' : 'credit'
  const flipped = subtype === 'contra' || subtype === 'owner_draw'
  if (!flipped) return natural
  return natural === 'debit' ? 'credit' : 'debit'
}

/** Returns a plain-English problem, or null if the input is fine. */
export function validateAccountInput(input: AccountInput): string | null {
  if (!/^\d{1,10}$/.test(input.number.trim())) return 'Enter an account number using digits only (for example 6120).'
  const name = input.name.trim()
  if (!name) return 'Enter an account name.'
  if (name.length > NAME_MAX) return `Keep the account name under ${NAME_MAX} characters.`
  if (!ACCOUNT_TYPES.some((t) => t.value === input.type)) return 'Choose an account type.'
  if (
    input.type !== 'expense' &&
    !SUBTYPE_OPTIONS[input.type].some((o) => o.value === input.subtype) &&
    !SYSTEM_SUBTYPES.includes(input.subtype)
  ) {
    return 'Choose what kind of account this is.'
  }
  const category = input.taxCategory ? getTaxCategory(input.taxCategory) : undefined
  if (!category) return 'Choose a tax category.'
  if (category.accountType !== input.type) return 'That tax category doesn\'t fit this account type. Choose another.'
  return null
}

const NUMBER_RANGES: Record<AccountType | 'cogs', { first: string; range: string; label: string }> = {
  asset: { first: '1', range: '1000–1999', label: 'Asset' },
  liability: { first: '2', range: '2000–2999', label: 'Liability' },
  equity: { first: '3', range: '3000–3999', label: 'Equity' },
  income: { first: '4', range: '4000–4999', label: 'Income' },
  cogs: { first: '5', range: '5000–5999', label: 'Cost of goods sold' },
  expense: { first: '6', range: '6000–6999', label: 'Expense' }
}

/** A gentle warning when the number is outside its type's usual range. Never blocks saving. */
export function numberRangeWarning(type: AccountType, taxCategory: string, number: string): string | null {
  const n = number.trim()
  if (!/^\d+$/.test(n)) return null
  const key = type === 'expense' && taxCategory.startsWith('cogs_') ? 'cogs' : type
  const r = NUMBER_RANGES[key]
  if (n.startsWith(r.first)) return null
  return `${r.label} accounts are usually numbered ${r.range}. You can still save it.`
}
