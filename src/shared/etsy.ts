import { parseAmountCell, parseCsv } from './csvImport'
import { isValidDate } from './dates'

/**
 * Etsy files: the monthly payments statement (Shop Manager → Finances → Monthly statements → CSV) and the
 * Sold Orders CSV (Settings → Options → Download data → Orders). Pure code: reading, classifying and
 * planning the entries. The main process does the posting.
 *
 * Accounting: every statement row runs through an "Etsy payment account" (a clearing account holding
 * what Etsy owes you). One entry per day of activity; each deposit is a transfer from that account to the bank.
 */

export type EtsyKind =
  | 'sale'
  | 'refund'
  | 'sales_tax'
  | 'transaction_fee'
  | 'processing_fee'
  | 'listing_fee'
  | 'etsy_ads'
  | 'offsite_ads'
  | 'shipping_label'
  | 'subscription'
  | 'fee_tax'
  | 'other_fee'
  | 'payment'
  | 'deposit'
  | 'unknown'

/** Where each part of the activity goes. `clearing` is the Etsy payment account; `shipping` takes the shipping part of sales. */
export type EtsyTarget = Exclude<EtsyKind, 'deposit'> | 'clearing' | 'shipping'

export const ETSY_TARGET_LABELS: Record<EtsyTarget, string> = {
  clearing: 'Etsy payment account (what Etsy holds for you)',
  sale: 'Sales (items)',
  shipping: 'Shipping charged to buyers',
  refund: 'Refunds to buyers',
  sales_tax: 'Sales tax Etsy collected and paid for you',
  transaction_fee: 'Transaction fees',
  processing_fee: 'Payment processing fees',
  listing_fee: 'Listing fees',
  etsy_ads: 'Etsy Ads',
  offsite_ads: 'Offsite Ads fees',
  shipping_label: 'Shipping labels bought on Etsy',
  subscription: 'Etsy subscription (Etsy Plus)',
  fee_tax: 'Taxes Etsy charged on its fees',
  other_fee: 'Other Etsy fees',
  payment: 'Money you paid in to Etsy (from)',
  unknown: 'Other Etsy activity'
}

export interface EtsyRow {
  /** 1-based row number in the file. */
  row: number
  date: string
  type: string
  title: string
  info: string
  currency: string
  /** "Amount" column in cents (0 for "--"). */
  amountCents: number
  /** "Fees & Taxes" column in cents (0 for "--"). */
  feesCents: number
  kind: EtsyKind
  orderId: string | null
  /** For deposits: the amount sent to the bank. */
  depositCents: number
}

export interface EtsyStatement {
  rows: EtsyRow[]
  problems: { row: number; reason: string }[]
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "March 3, 2026", "Mar 3, 2026", "3 March 2026", "03/03/2026", "2026-03-03", "03/03/26" → "2026-03-03". */
export function parseEtsyDate(text: string): string | null {
  const t = text.trim()
  let m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t)
  if (m) return ymd(m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, m[2])
  m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(t)
  if (m) return ymd(m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, m[1])
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (m) return ymd(m[1], Number(m[2]), m[3])
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t)
  if (m) return ymd(m[3].length === 2 ? `20${m[3]}` : m[3], Number(m[1]), m[2])
  return null
}

function ymd(y: string, month: number, d: string): string | null {
  if (month < 1) return null
  const iso = `${y}-${String(month).padStart(2, '0')}-${d.padStart(2, '0')}`
  return isValidDate(iso) ? iso : null
}

/** Amount cells: "$12.00", "-$0.20", "--" or blank (= nothing). Returns null only for unreadable text. */
function money(text: string | undefined): number | null {
  const t = (text ?? '').trim()
  if (t === '' || t === '--' || t === '-') return 0
  return parseAmountCell(t)
}

/** Sorts a statement row into a kind, from its Type and Title (Etsy's wording varies, so both are checked). */
export function classifyEtsyRow(type: string, title: string): EtsyKind {
  const t = type.trim().toLowerCase()
  const ti = title.trim().toLowerCase()
  if (t === 'deposit' || (/sent to your bank|deposit/.test(ti) && t !== 'fee')) return 'deposit'
  if (t === 'sale' || ti.startsWith('payment for order')) return 'sale'
  if (t === 'refund' || /^refund/.test(ti)) return 'refund'
  if (t === 'tax' || t === 'vat' || t === 'sales tax') {
    return /sales tax|paid by buyer|buyer/.test(ti) ? 'sales_tax' : 'fee_tax'
  }
  if (t === 'marketing' || /etsy ads|offsite ads|promoted listings/.test(ti)) {
    return /offsite/.test(ti) ? 'offsite_ads' : 'etsy_ads'
  }
  if (t === 'shipping' || t === 'shipping label' || t === 'postage' || /shipping label|postage/.test(ti))
    return 'shipping_label'
  if (t === 'subscription' || /etsy plus|subscription/.test(ti)) return 'subscription'
  if (t === 'listing' || /listing fee|renew/.test(ti)) return 'listing_fee'
  if (t === 'transaction' || /^transaction fee/.test(ti)) return 'transaction_fee'
  if (/processing fee/.test(ti)) return 'processing_fee'
  if (t === 'payment') return 'payment'
  if (t === 'fee') return /tax|vat|gst/.test(ti) ? 'fee_tax' : 'other_fee'
  return 'unknown'
}

/** "Payment for Order #1234567890", "Order #123", "order 123" → "1234567890". */
export function orderIdFrom(...texts: string[]): string | null {
  for (const s of texts) {
    const m = /order\s*#?\s*(\d{6,})/i.exec(s) ?? /#(\d{6,})/.exec(s)
    if (m) return m[1]
  }
  return null
}

function findCol(header: string[], ...names: RegExp[]): number {
  for (const n of names) {
    const i = header.findIndex((h) => n.test(h.trim().toLowerCase()))
    if (i >= 0) return i
  }
  return -1
}

/** Reads an Etsy monthly payments statement CSV. */
export function parseEtsyStatement(text: string): EtsyStatement {
  const rows = parseCsv(text)
  const header = rows[0] ?? []
  const col = {
    date: findCol(header, /^date$/),
    type: findCol(header, /^type$/),
    title: findCol(header, /^title$/, /description/),
    info: findCol(header, /^info$/),
    currency: findCol(header, /^currency$/),
    amount: findCol(header, /^amount$/),
    fees: findCol(header, /^fees\s*&\s*taxes$/, /fees/),
    net: findCol(header, /^net$/)
  }
  if (col.date < 0 || col.type < 0 || col.title < 0 || (col.amount < 0 && col.net < 0)) {
    throw new Error(
      'This doesn\'t look like an Etsy payments statement: it needs Date, Type, Title, Amount and "Fees & Taxes" columns. Download it from Shop Manager → Finances → Monthly statements.'
    )
  }
  const out: EtsyStatement = { rows: [], problems: [] }
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const rowNo = i + 1
    const date = parseEtsyDate(r[col.date] ?? '')
    if (!date) {
      out.problems.push({ row: rowNo, reason: `the date "${r[col.date] ?? ''}" can't be read` })
      continue
    }
    const type = r[col.type] ?? ''
    const title = r[col.title] ?? ''
    const info = col.info >= 0 ? (r[col.info] ?? '') : ''
    const currency = col.currency >= 0 ? (r[col.currency] ?? '').trim().toUpperCase() : 'USD'
    if (currency && currency !== 'USD') {
      out.problems.push({ row: rowNo, reason: `it is in ${currency}; only US dollar statements can be imported` })
      continue
    }
    let amount = col.amount >= 0 ? money(r[col.amount]) : 0
    const fees = col.fees >= 0 ? money(r[col.fees]) : 0
    const net = col.net >= 0 ? money(r[col.net]) : null
    if (amount === null || fees === null) {
      out.problems.push({ row: rowNo, reason: "an amount can't be read" })
      continue
    }
    // Only a Net column filled in: treat it as the amount.
    if (amount === 0 && fees === 0 && net) amount = net
    const kind = classifyEtsyRow(type, title)
    let depositCents = 0
    if (kind === 'deposit') {
      const m = /\$?\s*([\d,]+\.\d{2})/.exec(title) ?? /\$?\s*([\d,]+\.\d{2})/.exec(info)
      depositCents = m ? (parseAmountCell(m[1]) ?? 0) : Math.abs(amount || net || 0)
      if (!depositCents) {
        out.problems.push({ row: rowNo, reason: "the deposit amount can't be found" })
        continue
      }
    } else if (amount === 0 && fees === 0) {
      continue // informational row
    }
    out.rows.push({
      row: rowNo,
      date,
      type,
      title,
      info,
      currency: currency || 'USD',
      amountCents: kind === 'deposit' ? 0 : amount,
      feesCents: kind === 'deposit' ? 0 : fees,
      kind,
      orderId: orderIdFrom(title, info),
      depositCents
    })
  }
  return out
}

export interface EtsyOrder {
  orderId: string
  saleDate: string | null
  /** Items after discounts. */
  itemsCents: number
  /** Shipping charged after shipping discounts. */
  shippingCents: number
  discountCents: number
  salesTaxCents: number
  totalCents: number
  shipState: string
  shipCountry: string
}

/** Reads Etsy's Sold Orders CSV (one row per order). */
export function parseEtsyOrders(text: string): { orders: EtsyOrder[]; problems: { row: number; reason: string }[] } {
  const rows = parseCsv(text)
  const header = rows[0] ?? []
  const c = {
    date: findCol(header, /^sale date$/),
    id: findCol(header, /^order id$/),
    value: findCol(header, /^order value$/),
    discount: findCol(header, /^discount amount$/),
    shipping: findCol(header, /^shipping$/),
    shipDiscount: findCol(header, /^shipping discount$/),
    tax: findCol(header, /^sales tax$/),
    total: findCol(header, /^order total$/),
    state: findCol(header, /^ship state$/),
    country: findCol(header, /^ship country$/)
  }
  if (c.id < 0 || c.value < 0) {
    throw new Error('This doesn\'t look like an Etsy Sold Orders file: it needs "Order ID" and "Order Value" columns.')
  }
  const out: { orders: EtsyOrder[]; problems: { row: number; reason: string }[] } = { orders: [], problems: [] }
  const get = (r: string[], i: number): number | null => (i >= 0 ? money(r[i]) : 0)
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const id = (r[c.id] ?? '').trim()
    const value = get(r, c.value)
    const discount = get(r, c.discount)
    const shipping = get(r, c.shipping)
    const shipDiscount = get(r, c.shipDiscount)
    const tax = get(r, c.tax)
    const total = get(r, c.total)
    if (
      !id ||
      value === null ||
      discount === null ||
      shipping === null ||
      shipDiscount === null ||
      tax === null ||
      total === null
    ) {
      out.problems.push({ row: i + 1, reason: "the order number or an amount can't be read" })
      continue
    }
    out.orders.push({
      orderId: id,
      saleDate: c.date >= 0 ? (parseEtsyDate(r[c.date] ?? '') ?? null) : null,
      itemsCents: value - Math.abs(discount),
      shippingCents: Math.max(0, shipping - Math.abs(shipDiscount)),
      discountCents: Math.abs(discount),
      salesTaxCents: tax,
      totalCents: total,
      shipState: c.state >= 0 ? (r[c.state] ?? '').trim() : '',
      shipCountry: c.country >= 0 ? (r[c.country] ?? '').trim() : ''
    })
  }
  return out
}

/** One posting of a row: positive = debit. */
export interface EtsyPosting {
  target: EtsyTarget
  cents: number
}

/** How one statement row posts. The clearing line always balances the others. */
export function rowPostings(row: EtsyRow, orders: Map<string, EtsyOrder>): EtsyPosting[] {
  const p: EtsyPosting[] = []
  const A = row.amountCents
  const F = row.feesCents
  switch (row.kind) {
    case 'deposit':
      return []
    case 'sale': {
      const order = row.orderId ? orders.get(row.orderId) : undefined
      const shipping = order && A > 0 ? Math.min(order.shippingCents, A) : 0
      if (A - shipping) p.push({ target: 'sale', cents: -(A - shipping) })
      if (shipping) p.push({ target: 'shipping', cents: -shipping })
      if (F) p.push({ target: 'processing_fee', cents: -F })
      break
    }
    case 'refund':
      if (A) p.push({ target: 'refund', cents: -A })
      if (F) p.push({ target: 'processing_fee', cents: -F })
      break
    case 'sales_tax':
      if (A) p.push({ target: 'sales_tax', cents: -A })
      if (F) p.push({ target: 'sales_tax', cents: -F })
      break
    default:
      if (A + F) p.push({ target: row.kind, cents: -(A + F) })
  }
  const total = p.reduce((s, x) => s + x.cents, 0)
  if (total) p.push({ target: 'clearing', cents: -total })
  return p
}

export interface PlannedEntry {
  date: string
  memo: string
  lines: { target: EtsyTarget; cents: number }[]
  /** Rows (by row number) this entry covers. */
  rows: number[]
}

export interface EtsyPlan {
  /** One per day with activity (deposits excluded). */
  days: PlannedEntry[]
  deposits: { date: string; cents: number; row: number; title: string }[]
}

/** Groups rows into one entry per day (lines combined per target) plus one transfer per deposit. */
export function planEtsy(rows: EtsyRow[], orders: Map<string, EtsyOrder>): EtsyPlan {
  const byDay = new Map<string, EtsyRow[]>()
  const deposits: EtsyPlan['deposits'] = []
  for (const r of rows) {
    if (r.kind === 'deposit') deposits.push({ date: r.date, cents: r.depositCents, row: r.row, title: r.title })
    else byDay.set(r.date, [...(byDay.get(r.date) ?? []), r])
  }
  const days: PlannedEntry[] = []
  for (const date of [...byDay.keys()].sort()) {
    const dayRows = byDay.get(date)!
    const sums = new Map<EtsyTarget, number>()
    for (const r of dayRows)
      for (const x of rowPostings(r, orders)) sums.set(x.target, (sums.get(x.target) ?? 0) + x.cents)
    const lines = [...sums].filter(([, c]) => c !== 0).map(([target, cents]) => ({ target, cents }))
    if (lines.length < 2) continue
    const sales = dayRows.filter((r) => r.kind === 'sale').length
    const refunds = dayRows.filter((r) => r.kind === 'refund').length
    const other = dayRows.length - sales - refunds
    const parts = [
      sales && `${sales} ${sales === 1 ? 'sale' : 'sales'}`,
      refunds && `${refunds} ${refunds === 1 ? 'refund' : 'refunds'}`,
      other && `${other} fee and other ${other === 1 ? 'line' : 'lines'}`
    ].filter(Boolean)
    days.push({ date, memo: `Etsy activity ${date}: ${parts.join(', ')}`, lines, rows: dayRows.map((r) => r.row) })
  }
  return { days, deposits: deposits.sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row) }
}

/** Identifies a statement row for re-import checks; repeats within a file are numbered. */
export function etsyFingerprints(rows: EtsyRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const fp = [
      r.date,
      r.type.toLowerCase(),
      r.title.toLowerCase().replace(/\s+/g, ' '),
      r.info.toLowerCase(),
      r.amountCents,
      r.feesCents,
      r.depositCents
    ].join('|')
    const n = (seen.get(fp) ?? 0) + 1
    seen.set(fp, n)
    return `${fp}#${n}`
  })
}

/** The accounts Etsy imports use, added on request. `targets` are the kinds that default to each. */
export interface ChannelAccountSpec {
  number: string
  name: string
  type: 'asset' | 'liability' | 'income' | 'expense'
  taxCategory: string
  note: string
  targets: EtsyTarget[]
}

export const ETSY_ACCOUNTS: ChannelAccountSpec[] = [
  {
    number: '1210',
    name: 'Etsy payment account',
    type: 'asset',
    taxCategory: 'other_current_assets',
    note: 'Money Etsy holds for you between sales and deposits. Its balance should match "Current balance" on Etsy’s Payment account page.',
    targets: ['clearing']
  },
  {
    number: '2210',
    name: 'Sales tax collected by Etsy',
    type: 'liability',
    taxCategory: 'other_current_liabilities',
    note: 'Sales tax Etsy collected from buyers and paid to the states for you (marketplace facilitator). It nets to zero. Your accountant decides whether it belongs in gross receipts; it is kept separate so the 1099-K can be tied out.',
    targets: ['sales_tax']
  },
  {
    number: '6101',
    name: 'Etsy transaction fees',
    type: 'expense',
    taxCategory: 'commissions_fees',
    note: '',
    targets: ['transaction_fee']
  },
  {
    number: '6102',
    name: 'Etsy payment processing fees',
    type: 'expense',
    taxCategory: 'commissions_fees',
    note: '',
    targets: ['processing_fee']
  },
  {
    number: '6103',
    name: 'Etsy listing fees',
    type: 'expense',
    taxCategory: 'commissions_fees',
    note: '',
    targets: ['listing_fee']
  },
  {
    number: '6104',
    name: 'Etsy other fees',
    type: 'expense',
    taxCategory: 'commissions_fees',
    note: 'Regulatory fees, Etsy Plus, taxes Etsy charges on its fees, and other Etsy charges.',
    targets: ['subscription', 'fee_tax', 'other_fee', 'unknown']
  },
  { number: '6001', name: 'Etsy Ads', type: 'expense', taxCategory: 'advertising', note: '', targets: ['etsy_ads'] },
  {
    number: '6002',
    name: 'Etsy Offsite Ads fees',
    type: 'expense',
    taxCategory: 'advertising',
    note: 'Offsite Ads are charged as a percentage of the sale. Ask your accountant whether to report them as advertising or as commissions and fees.',
    targets: ['offsite_ads']
  }
]

/** Default accounts (by template number) for targets not covered by ETSY_ACCOUNTS. */
export const ETSY_DEFAULT_NUMBERS: Partial<Record<EtsyTarget, string>> = {
  sale: '4000',
  shipping: '4010',
  refund: '4090',
  shipping_label: '6950'
}

export const ALL_ETSY_TARGETS = Object.keys(ETSY_TARGET_LABELS) as EtsyTarget[]
