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
  /** Sub-account of this account (same type, up to MAX_LEVELS deep). Omitted on edit = unchanged; null = top level. */
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

/** How deep accounts can nest: a main account is level 1, its sub-account level 2, and so on. */
export const MAX_LEVELS = 5

export interface TreeNode {
  id: number
  parentId: number | null
}

/** The chain from this account up to its main account (this one first). Stops on a loop, which can't normally exist. */
function ancestors(nodes: TreeNode[], id: number): number[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const chain: number[] = []
  for (let cur: number | null = id; cur !== null && !chain.includes(cur); cur = byId.get(cur)?.parentId ?? null) {
    chain.push(cur)
  }
  return chain
}

/** 1 for a main account, 2 for its sub-account, … */
export function levelOf(nodes: TreeNode[], id: number): number {
  return ancestors(nodes, id).length
}

/** How many levels this account and everything under it span (1 when nothing sits under it). */
export function levelsSpanned(nodes: TreeNode[], id: number, seen = new Set<number>()): number {
  if (seen.has(id)) return 0
  seen.add(id)
  const children = nodes.filter((n) => n.parentId === id)
  return 1 + Math.max(0, ...children.map((c) => levelsSpanned(nodes, c.id, seen)))
}

/** Why `parentId` can't hold account `id` (null = a new account), or null if it can. Type is checked separately. */
export function parentProblem(nodes: TreeNode[], id: number | null, parentId: number): string | null {
  if (parentId === id) return "An account can't be a sub-account of itself."
  if (id !== null && ancestors(nodes, parentId).includes(id))
    return 'That account sits under this one, so it can\'t be its parent.'
  const span = id === null ? 1 : levelsSpanned(nodes, id)
  if (levelOf(nodes, parentId) + span > MAX_LEVELS)
    return `Accounts can nest up to ${MAX_LEVELS} levels deep (a main account and four levels under it). Choose a parent higher up.`
  return null
}

/** Items in tree order: each main account followed by everything under it, keeping the given order among siblings.
 * An item whose parent isn't in the list is treated as a main account. */
export function treeOrder<T extends TreeNode>(items: T[]): { item: T; depth: number }[] {
  const ids = new Set(items.map((i) => i.id))
  const out: { item: T; depth: number }[] = []
  const done = new Set<number>()
  const visit = (item: T, depth: number): void => {
    if (done.has(item.id)) return
    done.add(item.id)
    out.push({ item, depth })
    for (const c of items) if (c.parentId === item.id) visit(c, depth + 1)
  }
  for (const i of items) if (i.parentId === null || !ids.has(i.parentId)) visit(i, 0)
  return out
}

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

/**
 * A free account number to suggest, or null if none is left.
 * Under a parent: the parent's number with the last digit run 1–9 when it ends in 0 (6120 → 6121…6129), then one
 * digit longer (61201…61209, then 612001…). Otherwise: the first unused multiple of 10 in the type's thousand-range.
 */
export function suggestAccountNumber(
  used: string[],
  type: AccountType,
  taxCategory: string,
  parentNumber: string | null
): string | null {
  const taken = new Set(used.map((n) => n.trim()))
  if (parentNumber) {
    const p = parentNumber.trim()
    if (p.endsWith('0')) {
      for (let k = 1; k <= 9; k++) {
        const n = p.slice(0, -1) + k
        if (!taken.has(n)) return n
      }
    }
    for (let extra = 1; p.length + extra <= 10; extra++) {
      for (let i = 1; i < 10 ** extra; i++) {
        const n = p + String(i).padStart(extra, '0')
        if (!taken.has(n)) return n
      }
    }
    return null
  }
  const key = type === 'expense' && taxCategory.startsWith('cogs_') ? 'cogs' : type
  const start = Number(NUMBER_RANGES[key].first) * 1000
  for (let n = start; n < start + 1000; n += 10) {
    if (!taken.has(String(n))) return String(n)
  }
  return null
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
