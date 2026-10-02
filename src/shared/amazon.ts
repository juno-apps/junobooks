import { parseAmountCell, parseCsv } from './csvImport'
import { parseEtsyDate, type ChannelAccountSpec } from './etsy'

/**
 * Amazon settlement report (flat file, tab-separated; Seller Central → Payments → Reports repository →
 * "Settlement report" / flat file V2). Pure code: reading, classifying and planning. Every row runs through
 * an "Amazon payment account" (what Amazon holds for you); one entry per day of activity; the settlement's
 * payout is a transfer to the bank on the deposit date.
 */

export type AmazonTarget =
  | 'clearing'
  | 'sale'
  | 'shipping'
  | 'promotion'
  | 'refund'
  | 'sales_tax'
  | 'referral_fee'
  | 'fba_fee'
  | 'shipping_fee'
  | 'subscription'
  | 'advertising'
  | 'other_fee'
  | 'other_income'
  | 'unknown'

export type AmazonKind = Exclude<AmazonTarget, 'clearing'> | 'reserve'

export const AMAZON_TARGET_LABELS: Record<AmazonTarget, string> = {
  clearing: 'Amazon payment account (what Amazon holds for you)',
  sale: 'Sales (item price)',
  shipping: 'Shipping and gift wrap charged to buyers',
  promotion: 'Promotions and discounts you gave',
  refund: 'Refunds to buyers',
  sales_tax: 'Sales tax Amazon collected and paid for you',
  referral_fee: 'Referral fees (commission)',
  fba_fee: 'Fulfillment by Amazon (FBA) and storage fees',
  shipping_fee: 'Shipping labels and shipping charges',
  subscription: 'Seller subscription',
  advertising: 'Amazon advertising',
  other_fee: 'Other Amazon fees',
  other_income: 'Reimbursements and other money in',
  unknown: 'Other Amazon activity'
}

export const ALL_AMAZON_TARGETS = Object.keys(AMAZON_TARGET_LABELS) as AmazonTarget[]

export interface AmazonRow {
  row: number
  settlementId: string
  date: string
  transactionType: string
  amountType: string
  description: string
  orderId: string
  sku: string
  amountCents: number
  kind: AmazonKind
}

export interface AmazonSettlement {
  settlementId: string
  startDate: string | null
  endDate: string | null
  depositDate: string | null
  /** The payout (negative when the seller owes Amazon). */
  totalCents: number
  rows: AmazonRow[]
  problems: { row: number; reason: string }[]
}

/** Dates as Amazon writes them: 2026-03-14, "2026-03-14 07:32:11 UTC", 2026-03-14T07:32:11+00:00, 03/14/2026, 14.03.2026. */
export function parseAmazonDate(text: string): string | null {
  const t = text.trim()
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t)
  if (dotted) return parseEtsyDate(`${dotted[3]}-${dotted[2]}-${dotted[1]}`)
  return parseEtsyDate(t.replace(/[T ].*$/, '')) ?? parseEtsyDate(t)
}

/** Sorts a settlement row by transaction type, amount type and description. */
export function classifyAmazonRow(transactionType: string, amountType: string, description: string): AmazonKind {
  const tt = transactionType.trim().toLowerCase()
  const at = amountType.trim().toLowerCase()
  const d = description.trim().toLowerCase()
  const refund = tt === 'refund' || tt === 'chargeback refund' || tt === 'a-to-z guarantee claim'
  if (/reserve/.test(d)) return 'reserve'
  if (at === 'itemprice') {
    if (/tax/.test(d)) return 'sales_tax'
    if (d === 'principal') return refund ? 'refund' : 'sale'
    if (/shipping|giftwrap|gift wrap/.test(d)) return refund ? 'refund' : 'shipping'
    return refund ? 'refund' : 'sale'
  }
  if (at === 'itemwithheldtax' || /marketplacefacilitator|withheld/.test(d)) return 'sales_tax'
  if (at === 'promotion') return 'promotion'
  if (at === 'itemfees' || at === 'fees') {
    if (/commission/.test(d)) return 'referral_fee'
    if (/fba|fulfil/.test(d)) return 'fba_fee'
    if (/shipping|label/.test(d)) return 'shipping_fee'
    return 'other_fee'
  }
  if (/advertis/.test(d) || /advertis/.test(at) || (tt === 'servicefee' && /advertis/.test(`${at} ${d}`)))
    return 'advertising'
  if (/subscription/.test(d)) return 'subscription'
  if (/storage|fba|fulfil|removal|disposal/.test(d)) return 'fba_fee'
  if (/reimburse|reversal|warehouse damage|lost/.test(d)) return 'other_income'
  if (/shipping|label/.test(d)) return 'shipping_fee'
  if (at === 'other-transaction' || tt === 'other-transaction' || tt === 'servicefee') return 'other_fee'
  return 'unknown'
}

/** Reads one settlement report (tab-separated with a header row; the first data row holds the settlement totals). */
export function parseAmazonSettlement(text: string): AmazonSettlement {
  const rows = parseCsv(text)
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (name: string): number => header.indexOf(name)
  const c = {
    id: col('settlement-id'),
    start: col('settlement-start-date'),
    end: col('settlement-end-date'),
    deposit: col('deposit-date'),
    total: col('total-amount'),
    currency: col('currency'),
    tt: col('transaction-type'),
    order: col('order-id'),
    at: col('amount-type'),
    desc: col('amount-description'),
    amount: col('amount'),
    posted: col('posted-date') >= 0 ? col('posted-date') : col('posted-date-time'),
    sku: col('sku')
  }
  if (c.id < 0 || c.at < 0 || c.amount < 0 || c.total < 0) {
    throw new Error(
      'This doesn’t look like an Amazon settlement report: it needs settlement-id, total-amount, amount-type and amount columns. Download the flat file from Seller Central → Payments → Reports repository.'
    )
  }
  const out: AmazonSettlement = {
    settlementId: '',
    startDate: null,
    endDate: null,
    depositDate: null,
    totalCents: 0,
    rows: [],
    problems: []
  }
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const rowNo = i + 1
    const get = (k: number): string => (k >= 0 ? (r[k] ?? '').trim() : '')
    if (!out.settlementId && get(c.id)) out.settlementId = get(c.id)
    // The summary row: totals and dates, no amount type.
    if (!get(c.at) && get(c.total)) {
      out.startDate = parseAmazonDate(get(c.start))
      out.endDate = parseAmazonDate(get(c.end))
      out.depositDate = parseAmazonDate(get(c.deposit))
      const total = parseAmountCell(get(c.total).replace(/,(\d{2})$/, '.$1'))
      if (total === null) out.problems.push({ row: rowNo, reason: 'the settlement total can’t be read' })
      else out.totalCents = total
      continue
    }
    if (!get(c.at) && !get(c.amount)) continue
    if (c.currency >= 0 && get(c.currency) && get(c.currency).toUpperCase() !== 'USD') {
      out.problems.push({
        row: rowNo,
        reason: `it is in ${get(c.currency)}; only US dollar settlements can be imported`
      })
      continue
    }
    const date = parseAmazonDate(get(c.posted))
    if (!date) {
      out.problems.push({ row: rowNo, reason: `the posted date "${get(c.posted)}" can’t be read` })
      continue
    }
    const amount = parseAmountCell(get(c.amount).replace(/,(\d{2})$/, '.$1'))
    if (amount === null) {
      out.problems.push({ row: rowNo, reason: 'the amount can’t be read' })
      continue
    }
    if (amount === 0) continue
    out.rows.push({
      row: rowNo,
      settlementId: get(c.id) || out.settlementId,
      date,
      transactionType: get(c.tt),
      amountType: get(c.at),
      description: get(c.desc),
      orderId: get(c.order),
      sku: get(c.sku),
      amountCents: amount,
      kind: classifyAmazonRow(get(c.tt), get(c.at), get(c.desc))
    })
  }
  if (!out.settlementId) out.problems.push({ row: 2, reason: 'no settlement id was found' })
  return out
}

/** Gross receipts for 1099-K purposes: item price, shipping, gift wrap and tax charged on orders (before fees and refunds). */
export function amazonGross(r: AmazonRow): number {
  return r.amountType.toLowerCase() === 'itemprice' && r.transactionType.toLowerCase() === 'order' && r.amountCents > 0
    ? r.amountCents
    : 0
}

export interface AmazonPlan {
  days: { date: string; memo: string; lines: { target: AmazonTarget; cents: number }[]; rows: number[] }[]
  deposit: { date: string; cents: number } | null
}

/** One entry per posted date (lines combined per target), plus the payout transfer. Reserve rows don't post: that money
 * is still Amazon's to hold, so it stays in the Amazon payment account. */
export function planAmazon(
  s: Pick<AmazonSettlement, 'depositDate' | 'totalCents' | 'endDate'>,
  rows: AmazonRow[]
): AmazonPlan {
  const byDay = new Map<string, AmazonRow[]>()
  for (const r of rows) if (r.kind !== 'reserve') byDay.set(r.date, [...(byDay.get(r.date) ?? []), r])
  const days: AmazonPlan['days'] = []
  for (const date of [...byDay.keys()].sort()) {
    const dayRows = byDay.get(date)!
    const sums = new Map<AmazonTarget, number>()
    for (const r of dayRows) sums.set(r.kind as AmazonTarget, (sums.get(r.kind as AmazonTarget) ?? 0) - r.amountCents)
    const total = dayRows.reduce((s, r) => s + r.amountCents, 0)
    if (total) sums.set('clearing', total)
    const lines = [...sums].filter(([, c]) => c !== 0).map(([target, cents]) => ({ target, cents }))
    if (lines.length < 2) continue
    const orders = new Set(
      dayRows.filter((r) => r.transactionType.toLowerCase() === 'order' && r.orderId).map((r) => r.orderId)
    ).size
    const refunds = new Set(
      dayRows.filter((r) => r.transactionType.toLowerCase() === 'refund' && r.orderId).map((r) => r.orderId)
    ).size
    const parts = [
      orders && `${orders} ${orders === 1 ? 'order' : 'orders'}`,
      refunds && `${refunds} ${refunds === 1 ? 'refund' : 'refunds'}`
    ]
      .filter(Boolean)
      .join(', ')
    days.push({
      date,
      memo: `Amazon activity ${date}${parts ? `: ${parts}` : ''}`,
      lines,
      rows: dayRows.map((r) => r.row)
    })
  }
  const date = s.depositDate ?? s.endDate
  return { days, deposit: s.totalCents > 0 && date ? { date, cents: s.totalCents } : null }
}

export function amazonFingerprints(rows: AmazonRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const fp = [r.settlementId, r.date, r.transactionType, r.amountType, r.description, r.orderId, r.sku, r.amountCents]
      .join('|')
      .toLowerCase()
    const n = (seen.get(fp) ?? 0) + 1
    seen.set(fp, n)
    return `${fp}#${n}`
  })
}

export const AMAZON_ACCOUNTS: ChannelAccountSpec[] = [
  {
    number: '1220',
    name: 'Amazon payment account',
    type: 'asset',
    taxCategory: 'other_current_assets',
    note: 'Money Amazon holds for you between sales and settlement payouts, including any reserve it keeps back.',
    targets: ['clearing'] as never[]
  },
  {
    number: '2220',
    name: 'Sales tax collected by Amazon',
    type: 'liability',
    taxCategory: 'other_current_liabilities',
    note: 'Sales tax Amazon collected and paid to the states for you (marketplace facilitator). It nets to zero. Your accountant decides whether it belongs in gross receipts; it is kept separate so the 1099-K can be tied out.',
    targets: ['sales_tax'] as never[]
  },
  {
    number: '6111',
    name: 'Amazon referral fees',
    type: 'expense',
    taxCategory: 'commissions_fees',
    note: '',
    targets: ['referral_fee'] as never[],
    parentNumber: '6100'
  },
  {
    number: '6112',
    name: 'Amazon FBA fees',
    type: 'expense',
    taxCategory: 'commissions_fees',
    note: 'Fulfillment, storage, removal and disposal fees.',
    targets: ['fba_fee'] as never[],
    parentNumber: '6100'
  },
  {
    number: '6113',
    name: 'Amazon other fees',
    type: 'expense',
    taxCategory: 'commissions_fees',
    note: 'Seller subscription, closing fees and other Amazon charges.',
    targets: ['subscription', 'other_fee', 'unknown'] as never[],
    parentNumber: '6100'
  },
  {
    number: '6003',
    name: 'Amazon advertising',
    type: 'expense',
    taxCategory: 'advertising',
    note: '',
    targets: ['advertising'] as never[],
    parentNumber: '6000'
  }
]

export const AMAZON_DEFAULT_NUMBERS: Partial<Record<AmazonTarget, string>> = {
  sale: '4000',
  shipping: '4010',
  promotion: '4090',
  refund: '4090',
  shipping_fee: '6950',
  other_income: '4900'
}
