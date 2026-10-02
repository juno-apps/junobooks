import type { AccountType } from './taxLines'
import type { NormalBalance } from './templates'

/** One account's history: every entry line that touches it, oldest first, with a running balance. */
export interface RegisterRow {
  entryId: number
  date: string
  /** The entry memo (payee / description). */
  memo: string
  lineMemo: string
  /** The other side: one account's name, or "Split (3 accounts)". */
  otherSide: string
  /** Amount that raises the balance on the account's normal side (debit for assets/expenses). */
  increaseCents: number
  decreaseCents: number
  /** Running balance after this line, on the normal side. Voided rows don't move it. */
  balanceCents: number
  status: 'posted' | 'void'
  source: string
}

export interface RegisterView {
  account: { id: number; number: string; name: string; type: AccountType; subtype: string; normalBalance: NormalBalance; isActive: boolean }
  from: string | null
  to: string | null
  /** Balance before `from` (0 when showing everything). */
  openingCents: number
  closingCents: number
  rows: RegisterRow[]
}

export interface RegisterQuery {
  accountId: number
  from?: string | null
  to?: string | null
  includeVoided?: boolean
}

/** Column headings that fit the kind of account. */
export function registerColumns(a: { type: AccountType; subtype: string }): { increase: string; decrease: string } {
  if (a.subtype === 'bank') return { increase: 'Money in', decrease: 'Money out' }
  if (a.subtype === 'credit_card') return { increase: 'Charges', decrease: 'Payments' }
  return { increase: 'Increase', decrease: 'Decrease' }
}
