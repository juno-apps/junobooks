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

export interface SplitLine {
  accountId: number | null
  amount: string
  memo: string
}

export interface ExpenseForm {
  date: string
  paidTo: string
  paidFromId: number | null
  lines: SplitLine[]
}

export interface IncomeForm {
  date: string
  receivedFrom: string
  depositToId: number | null
  lines: SplitLine[]
}

function isBlankLine(l: SplitLine): boolean {
  return l.accountId === null && !l.amount.trim() && !l.memo.trim()
}

/** Sum of the readable amounts, for the live total. */
export function splitTotal(lines: SplitLine[]): number {
  return lines.reduce((s, l) => {
    const c = parseMoney(l.amount)
    return s + (c !== null && c > 0 ? c : 0)
  }, 0)
}

type Built = { entry: ManualEntryInput } | { error: string }

/** Wording and direction for each kind of everyday entry. */
const KINDS = {
  // The category lines are debits; the account you paid from is credited once for the total.
  expense: {
    sign: 1,
    noOther: 'Choose how you paid.',
    noLines: 'Enter what it was for and how much.',
    noCategory: 'choose what it was for.',
    same: "The account you paid from can't also be what it was for."
  },
  // The category lines are credits; the account it was deposited to is debited once for the total.
  income: {
    sign: -1,
    noOther: 'Choose where it was deposited.',
    noLines: 'Enter what kind of income it was and how much.',
    noCategory: 'choose what kind of income it was.',
    same: "The account it was deposited to can't also be the kind of income."
  }
} as const

function buildSplit(
  kind: keyof typeof KINDS,
  form: { date: string; memo: string; otherId: number | null; lines: SplitLine[] }
): Built {
  const w = KINDS[kind]
  if (!isValidDate(form.date)) return { error: 'Enter a valid date.' }
  if (form.otherId === null) return { error: w.noOther }
  const cats: ManualEntryInput['lines'] = []
  for (const [i, l] of form.lines.entries()) {
    if (isBlankLine(l)) continue
    const n = form.lines.length > 1 ? `Line ${i + 1}: ` : ''
    if (l.accountId === null) return { error: `${n}${w.noCategory}` }
    if (!l.amount.trim()) return { error: `${n}enter an amount.` }
    const cents = parseMoney(l.amount)
    if (cents === null) return { error: `${n}"${l.amount}" isn't an amount.` }
    if (cents < 0) return { error: `${n}amounts can't be negative.` }
    if (cents === 0) return { error: `${n}amount can't be zero.` }
    cats.push({ accountId: l.accountId, amountCents: w.sign * cents, memo: l.memo.trim() })
  }
  if (cats.length === 0) return { error: w.noLines }
  if (cats.some((c) => c.accountId === form.otherId)) return { error: w.same }
  const total = cats.reduce((sum, c) => sum + c.amountCents, 0)
  return {
    entry: {
      date: form.date,
      memo: form.memo.trim(),
      lines: [...cats, { accountId: form.otherId, amountCents: -total, memo: '' }]
    }
  }
}

/** Debits each category and credits "paid from" once for the total. */
export function buildExpense(form: ExpenseForm): Built {
  return buildSplit('expense', { date: form.date, memo: form.paidTo, otherId: form.paidFromId, lines: form.lines })
}

/** Credits each kind of income and debits "deposited to" once for the total. */
export function buildIncome(form: IncomeForm): Built {
  return buildSplit('income', { date: form.date, memo: form.receivedFrom, otherId: form.depositToId, lines: form.lines })
}

/** "Where was it deposited?": bank/cash, unpaid invoices (accounts receivable), then other asset accounts (e.g. a payment processor). */
export function depositToGroups(accounts: ChartAccount[]): AccountGroup[] {
  const active = accounts.filter((a) => a.isActive && a.type === 'asset')
  const cash = active.filter((a) => a.taxCategory === 'cash')
  const receivable = active.filter((a) => a.taxCategory === 'accounts_receivable')
  const shown = new Set([...cash, ...receivable].map((a) => a.id))
  const other = active.filter(
    (a) => !shown.has(a.id) && !['inventory', 'fixed_asset', 'contra'].includes(a.subtype)
  )
  return nonEmpty([
    { title: 'Bank and cash', accounts: cash },
    { title: 'Not received yet (an unpaid invoice)', accounts: receivable },
    { title: 'Other accounts (e.g. a payment processor balance)', accounts: other }
  ])
}

/** "What kind of income?": income accounts, and sales tax collected (which is owed onward, not income). */
export function incomeCategoryGroups(accounts: ChartAccount[]): AccountGroup[] {
  const active = accounts.filter((a) => a.isActive)
  return nonEmpty([
    { title: 'Income', accounts: active.filter((a) => a.type === 'income' && a.subtype !== 'contra') },
    {
      title: 'Sales tax collected (you owe this to the state)',
      accounts: active.filter((a) => a.type === 'liability' && a.subtype === 'sales_tax')
    }
  ])
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
