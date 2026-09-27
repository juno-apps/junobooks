import type { ChartAccount } from './chart'
import { isValidDate } from './dates'
import type { ManualEntryInput } from './journal'
import { parseMoney } from './money'

/**
 * The everyday screens (Expense, Income, Transfer): plain questions on screen,
 * a balanced journal entry underneath. Shared so tests cover the same code
 * the screens use.
 */

export interface AccountGroup {
  title: string
  accounts: ChartAccount[]
}

function nonEmpty(list: AccountGroup[]): AccountGroup[] {
  return list.filter((g) => g.accounts.length > 0)
}

/** "How did you pay?": bank/cash, credit cards, unpaid bills, then any other balance-sheet account (e.g. owner contributions). */
export function paidFromGroups(accounts: ChartAccount[]): AccountGroup[] {
  const active = accounts.filter((a) => a.isActive)
  const cash = active.filter((a) => a.type === 'asset' && a.taxCategory === 'cash')
  const cards = active.filter((a) => a.subtype === 'credit_card')
  const payable = active.filter((a) => a.taxCategory === 'accounts_payable')
  const shown = new Set([...cash, ...cards, ...payable].map((a) => a.id))
  const other = active.filter((a) => !shown.has(a.id) && ['asset', 'liability', 'equity'].includes(a.type))
  return nonEmpty([
    { title: 'Bank and cash', accounts: cash },
    { title: 'Credit cards', accounts: cards },
    { title: 'Not paid yet (a bill to pay later)', accounts: payable },
    { title: 'Other accounts (e.g. paid personally by the owner)', accounts: other }
  ])
}

/** "What was it for?": expenses, cost of goods sold, and inventory/equipment purchases. */
export function expenseCategoryGroups(accounts: ChartAccount[]): AccountGroup[] {
  const active = accounts.filter((a) => a.isActive)
  return nonEmpty([
    { title: 'Expenses', accounts: active.filter((a) => a.type === 'expense' && a.subtype !== 'cogs') },
    { title: 'Cost of goods sold', accounts: active.filter((a) => a.type === 'expense' && a.subtype === 'cogs') },
    {
      title: 'Inventory and equipment',
      accounts: active.filter((a) => a.type === 'asset' && (a.subtype === 'inventory' || a.subtype === 'fixed_asset'))
    }
  ])
}

export interface ExpenseLineText {
  accountId: number | null
  amount: string
  memo: string
}

export interface ExpenseForm {
  date: string
  paidTo: string
  paidFromId: number | null
  lines: ExpenseLineText[]
}

function isBlankLine(l: ExpenseLineText): boolean {
  return l.accountId === null && !l.amount.trim() && !l.memo.trim()
}

/** Sum of the readable amounts, for the live total. */
export function expenseTotal(lines: ExpenseLineText[]): number {
  return lines.reduce((s, l) => {
    const c = parseMoney(l.amount)
    return s + (c !== null && c > 0 ? c : 0)
  }, 0)
}

/**
 * Debits each category and credits "paid from" once for the total.
 * Returns the first problem in plain English, or the entry to post.
 */
export function buildExpense(form: ExpenseForm): { entry: ManualEntryInput } | { error: string } {
  if (!isValidDate(form.date)) return { error: 'Enter a valid date.' }
  if (form.paidFromId === null) return { error: 'Choose how you paid.' }
  const debits: ManualEntryInput['lines'] = []
  for (const [i, l] of form.lines.entries()) {
    if (isBlankLine(l)) continue
    const n = form.lines.length > 1 ? `Line ${i + 1}: ` : ''
    if (l.accountId === null) return { error: `${n}choose what it was for.` }
    if (!l.amount.trim()) return { error: `${n}enter an amount.` }
    const cents = parseMoney(l.amount)
    if (cents === null) return { error: `${n}"${l.amount}" isn't an amount.` }
    if (cents < 0) return { error: `${n}amounts can't be negative.` }
    if (cents === 0) return { error: `${n}amount can't be zero.` }
    debits.push({ accountId: l.accountId, amountCents: cents, memo: l.memo.trim() })
  }
  if (debits.length === 0) return { error: 'Enter what it was for and how much.' }
  if (debits.some((d) => d.accountId === form.paidFromId)) {
    return { error: "The account you paid from can't also be what it was for." }
  }
  const total = debits.reduce((s, d) => s + d.amountCents, 0)
  return {
    entry: {
      date: form.date,
      memo: form.paidTo.trim(),
      lines: [...debits, { accountId: form.paidFromId, amountCents: -total, memo: '' }]
    }
  }
}

export function accountLabel(a: ChartAccount): string {
  return `${a.number} ${a.name}`
}

/** Keeps only accounts whose "number name" contains every word typed (any order, ignoring case). Empty text keeps all. */
export function filterGroups(groups: AccountGroup[], text: string): AccountGroup[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return groups
  return nonEmpty(
    groups.map((g) => ({
      ...g,
      accounts: g.accounts.filter((a) => {
        const label = accountLabel(a).toLowerCase()
        return words.every((w) => label.includes(w))
      })
    }))
  )
}
