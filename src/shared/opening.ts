/** Opening balances screen: what each balance-sheet account held when the books start. */

export interface OpeningAccount {
  id: number
  number: string
  name: string
  type: 'asset' | 'liability' | 'equity'
  subtype: string
  normalBalance: 'debit' | 'credit'
  isActive: boolean
  /** On the account's normal side: what you have (assets) or owe (liabilities). */
  amountCents: number
}

export interface OpeningBalancesView {
  /** The books start date; the opening entry is dated this day. */
  date: string
  /** The posted opening entry, if any. */
  entryId: number | null
  equityAccount: { number: string; name: string } | null
  /** What landed in Opening balance equity (credit side positive). */
  equityCents: number
  accounts: OpeningAccount[]
}

export interface OpeningBalanceInput {
  accountId: number
  amountCents: number
}

/** What will land in Opening balance equity (credit side positive): debit-side amounts minus credit-side ones. */
export function openingDifference(rows: { normalBalance: 'debit' | 'credit'; amountCents: number }[]): number {
  return rows.reduce((s, r) => s + (r.normalBalance === 'debit' ? r.amountCents : -r.amountCents), 0)
}
