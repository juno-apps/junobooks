import { scaleCents } from './inventory'

/** Direct sales: customers, resale certificates, invoices and payments received. Types and pure math. */

export interface Customer {
  id: number
  name: string
  email: string
  phone: string
  address: string
  notes: string
  isWholesale: boolean
  isActive: boolean
  /** Open (unpaid) total of finalized invoices. */
  openCents: number
}

export interface CustomerInput {
  name: string
  email: string
  phone: string
  address: string
  notes: string
  isWholesale: boolean
}

export interface ResaleCertificate {
  id: number
  customerId: number
  certNumber: string
  stateCode: string
  issuedDate: string | null
  expiresDate: string | null
  /** Copy of the certificate in the company folder (relative path), if one was attached. */
  storedPath: string | null
  originalName: string | null
  notes: string
}

export interface CertificateInput {
  customerId: number
  certNumber: string
  stateCode: string
  issuedDate: string | null
  expiresDate: string | null
  notes: string
  /** A file to copy in (full path), optional. */
  filePath: string | null
}

export interface InvoiceLineInput {
  description: string
  quantityMilli: number
  unitPriceCents: number
  accountId: number | null
  taxable: boolean
}

export interface InvoiceInput {
  number: string
  customerId: number | null
  issueDate: string
  dueDate: string
  memo: string
  /** Sales tax rate in thousandths of a percent (7.25% = 7250). */
  taxRateMilli: number
  taxExempt: boolean
  exemptReason: string
  lines: InvoiceLineInput[]
}

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void'

export interface Invoice extends Omit<InvoiceInput, 'customerId' | 'lines'> {
  id: number
  customerId: number
  customerName: string
  /** 'paid' when a finalized invoice has nothing left to pay. */
  status: InvoiceStatus
  lines: (InvoiceLineInput & { amountCents: number; accountId: number })[]
  subtotalCents: number
  taxCents: number
  totalCents: number
  paidCents: number
  openCents: number
  entryId: number | null
  voidReason: string | null
}

export interface PaymentInput {
  customerId: number | null
  date: string
  amountCents: number
  depositAccountId: number | null
  method: string
  reference: string
  /** How much goes to each invoice. Must add up to the amount. */
  applications: { invoiceId: number; amountCents: number }[]
}

export interface Payment {
  id: number
  customerId: number
  customerName: string
  date: string
  amountCents: number
  depositAccountName: string
  method: string
  reference: string
  status: 'posted' | 'void'
  entryId: number | null
  applications: { invoiceId: number; invoiceNumber: string; amountCents: number }[]
}

export interface AgingRow {
  customerId: number
  customerName: string
  currentCents: number
  days1to30: number
  days31to60: number
  days61to90: number
  over90: number
  totalCents: number
}

export interface BusinessDetails {
  name: string
  address: string
  email: string
  phone: string
}

/** "7.25" or "7.25%" → 7250. Null if not a rate from 0 to 100 with up to three decimals. */
export function parseRate(text: string): number | null {
  const t = text.trim().replace(/%$/, '').trim()
  if (!t) return 0
  const m = /^(\d{1,3})(?:\.(\d{1,3}))?$/.exec(t)
  if (!m) return null
  const v = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'))
  return v <= 100000 ? v : null
}

/** 7250 → "7.25%". */
export function formatRate(milli: number): string {
  const whole = Math.floor(milli / 1000)
  const frac = String(milli % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${whole}${frac ? `.${frac}` : ''}%`
}

/** Line amounts, subtotal, tax and total. Line amount = quantity × unit price, rounded to the cent. */
export function invoiceTotals(input: Pick<InvoiceInput, 'lines' | 'taxRateMilli' | 'taxExempt'>): {
  lineCents: number[]
  subtotalCents: number
  taxableCents: number
  taxCents: number
  totalCents: number
} {
  const lineCents = input.lines.map((l) => scaleCents(l.unitPriceCents, l.quantityMilli, 1000))
  const subtotalCents = lineCents.reduce((s, c) => s + c, 0)
  const taxableCents = input.taxExempt ? 0 : input.lines.reduce((s, l, i) => s + (l.taxable ? lineCents[i] : 0), 0)
  const taxCents = scaleCents(taxableCents, input.taxRateMilli, 100000)
  return { lineCents, subtotalCents, taxableCents, taxCents, totalCents: subtotalCents + taxCents }
}

/** A certificate is valid on a date if not expired (no expiry = valid) and issued on or before it (if known). */
export function certificateValid(c: Pick<ResaleCertificate, 'issuedDate' | 'expiresDate'>, date: string): boolean {
  return (!c.issuedDate || c.issuedDate <= date) && (!c.expiresDate || c.expiresDate >= date)
}

/** Days between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

/** Which aging bucket an amount due on `due` falls in on `asOf`. */
export function agingBucket(
  due: string,
  asOf: string
): keyof Omit<AgingRow, 'customerId' | 'customerName' | 'totalCents'> {
  const late = daysBetween(due, asOf)
  if (late <= 0) return 'currentCents'
  if (late <= 30) return 'days1to30'
  if (late <= 60) return 'days31to60'
  if (late <= 90) return 'days61to90'
  return 'over90'
}
