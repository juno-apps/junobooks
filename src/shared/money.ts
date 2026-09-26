/** Money is always integer cents. These convert to and from what people type
 * and read, using string handling only — never floating-point arithmetic. */

/** Largest amount accepted on one line: $10 trillion. Keeps sums far inside safe-integer range. */
export const MAX_CENTS = 1_000_000_000_000_000

/** Parses "1,234.56", "$12", "-0.5", ".25" into cents. Returns null if it isn't a valid amount. */
export function parseMoney(input: string): number | null {
  const m = /^(-)?\$?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!m || (m[2] === '' && m[3] === undefined)) return null
  const dollars = Number(m[2].replace(/,/g, '') || '0')
  const cents = Number((m[3] ?? '').padEnd(2, '0'))
  const value = dollars * 100 + cents
  if (!Number.isSafeInteger(value) || value > MAX_CENTS) return null
  return m[1] && value !== 0 ? -value : value
}

/** 123456 → "$1,234.56"; -5 → "-$0.05". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`
}
