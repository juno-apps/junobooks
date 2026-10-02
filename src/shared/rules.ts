/** Auto-categorization rules for imported lines: "when the description contains X, use account Y". */

export interface CategorizationRule {
  id: number
  matchText: string
  accountId: number
  /** Memo to use for the entry (blank = the bank description). */
  payee: string
  /** Only for lines imported into this account; null = any account. */
  bankAccountId: number | null
  isActive: boolean
}

export interface RuleInput {
  matchText: string
  accountId: number | null
  payee: string
  bankAccountId: number | null
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** The rule for a line: active, its text inside the description (ignoring case and extra spaces), right bank account.
 * The longest match wins (the most specific), then the newest. */
export function findRule<R extends CategorizationRule>(
  rules: R[],
  line: { description: string; accountId: number },
  usableAccount: (id: number) => boolean = () => true
): R | null {
  const desc = norm(line.description)
  let best: R | null = null
  for (const r of rules) {
    if (!r.isActive || !usableAccount(r.accountId)) continue
    if (r.bankAccountId !== null && r.bankAccountId !== line.accountId) continue
    if (r.accountId === line.accountId) continue
    const t = norm(r.matchText)
    if (!t || !desc.includes(t)) continue
    if (!best || t.length > norm(best.matchText).length || (t.length === norm(best.matchText).length && r.id > best.id))
      best = r
  }
  return best
}

/** A starting point for a rule's text: the description without reference numbers, at most four words.
 * "ETSY INC PAYOUT 260303" → "ETSY INC PAYOUT". */
export function suggestMatchText(description: string): string {
  const words = description
    .replace(/[#*]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/\d{3,}/.test(w) && !/^\d+\/\d+/.test(w))
  return words.slice(0, 4).join(' ')
}

export function validateRule(input: RuleInput): string | null {
  if (!input.matchText.trim()) return 'Enter the words to look for in the bank description.'
  if (input.matchText.trim().length < 3) return "Use at least three letters, so the rule doesn't catch everything."
  if (input.accountId === null) return 'Choose the account to use.'
  if (input.bankAccountId !== null && input.bankAccountId === input.accountId)
    return "The rule can't send lines back into the account they came from."
  return null
}
