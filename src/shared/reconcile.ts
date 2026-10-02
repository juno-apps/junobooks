/** Cleared status and bank/card reconciliation. Amounts here are on the account's normal side
 * (a bank balance you have, a card balance you owe), unless a field says otherwise. */

export type ClearStatus = 'cleared' | 'reconciled' | null

export interface ReconcileLine {
  /** journal_lines.id */
  lineId: number
  entryId: number
  date: string
  memo: string
  otherSide: string
  /** Raises the balance (money in for a bank, a charge for a card) when positive. */
  amountCents: number
  cleared: boolean
}

export interface ReconciliationSummary {
  id: number
  statementDate: string
  statementBalanceCents: number
  status: 'in_progress' | 'finished' | 'undone'
  finishedAt: string | null
  undoReason: string | null
}

export interface ReconcileView {
  account: { id: number; number: string; name: string; subtype: string; normalBalance: 'debit' | 'credit' }
  /** The last finished reconciliation, if any. */
  last: ReconciliationSummary | null
  /** The reconciliation being worked on, if any. */
  open: ReconciliationSummary | null
  /** Total of all reconciled lines (the balance the last statement agreed with). */
  reconciledCents: number
  /** Posted lines on the account not yet reconciled. With an open reconciliation, only those dated on or before its statement date. */
  lines: ReconcileLine[]
  /** Not-yet-reconciled lines dated after the open statement date (left for next time). */
  laterCount: number
  history: ReconciliationSummary[]
}

/** Cleared balance = reconciled total + ticked lines; difference = statement − cleared (0 means done). */
export function reconcileTotals(view: Pick<ReconcileView, 'reconciledCents' | 'lines' | 'open'>): {
  clearedCents: number
  differenceCents: number | null
} {
  const clearedCents = view.reconciledCents + view.lines.filter((l) => l.cleared).reduce((s, l) => s + l.amountCents, 0)
  return { clearedCents, differenceCents: view.open ? view.open.statementBalanceCents - clearedCents : null }
}
