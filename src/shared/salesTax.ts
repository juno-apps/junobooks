/** Sales tax: dated rates and the period report. */

export interface SalesTaxRate {
  id: number
  stateCode: string
  /** e.g. "San Diego (city)"; blank = statewide/default for this business. */
  place: string
  /** Thousandths of a percent: 7.75% = 7750. */
  rateMilli: number
  effectiveDate: string
  notes: string
}

export interface RateInput {
  stateCode: string
  place: string
  rateMilli: number
  effectiveDate: string
  notes: string
}

export interface ResaleSale {
  invoiceId: number
  number: string
  date: string
  customerName: string
  subtotalCents: number
  certificate: string | null
}

export interface SalesTaxReport {
  from: string
  to: string
  homeState: string
  /** All sales income in the books (gross receipts accounts, incl. shipping charged). */
  grossSalesCents: number
  /** Of which through Etsy/Amazon, where the marketplace collected and paid the tax. */
  marketplaceCents: number
  marketplaceByChannel: { channel: string; cents: number }[]
  /** Invoices with no sales tax because the buyer resells (valid certificate). */
  resale: ResaleSale[]
  resaleCents: number
  /** Invoices marked exempt without a valid certificate on file (check these). */
  otherExempt: ResaleSale[]
  otherExemptCents: number
  /** Refunds and returns outside the marketplaces. */
  refundsCents: number
  /** gross − marketplace − resale − other exempt − refunds. */
  taxableCents: number
  /** Tax at the rates in force, month by month. */
  computedTaxCents: number
  months: { month: string; taxableCents: number; rateMilli: number | null }[]
  /** Sales tax charged and recorded in the books (Sales tax payable credits outside the marketplaces). */
  chargedCents: number
  /** Sales tax payments recorded in the period. */
  paidCents: number
  /** Sales tax payable balance at the end of the period. */
  owedAtEndCents: number
  /** Rates were missing for part of the period. */
  missingRate: boolean
}

export interface SalesTaxPaymentInput {
  date: string
  amountCents: number
  bankAccountId: number | null
  memo: string
}

/** The rate in force on a date: the latest one that started on or before it (for the state; place '' preferred on ties). */
export function rateOn(rates: SalesTaxRate[], stateCode: string, date: string): SalesTaxRate | null {
  return (
    rates
      .filter((r) => r.stateCode === stateCode && r.effectiveDate <= date)
      .sort(
        (a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || a.place.localeCompare(b.place) || b.id - a.id
      )[0] ?? null
  )
}

/** Calendar quarters: { label: 'Q1 2026', from, to }. */
export function quarters(year: number): { label: string; from: string; to: string }[] {
  const ends = ['03-31', '06-30', '09-30', '12-31']
  return ends.map((end, i) => ({
    label: `Q${i + 1} ${year}`,
    from: `${year}-${String(i * 3 + 1).padStart(2, '0')}-01`,
    to: `${year}-${end}`
  }))
}
