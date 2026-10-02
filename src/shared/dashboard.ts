/** Company home summary. */
export interface Dashboard {
  year: number
  from: string
  to: string
  /** Income so far this year (net of refunds). */
  salesCents: number
  /** Cost of goods sold plus expenses so far this year. */
  expensesCents: number
  netIncomeCents: number
  cash: { name: string; cents: number }[]
  cashTotalCents: number
  /** Unpaid invoices and money held by marketplaces. */
  owedToYou: { name: string; cents: number }[]
  owedToYouTotalCents: number
  /** Cards, bills, sales tax, payroll and loans. */
  youOwe: { name: string; cents: number }[]
  youOweTotalCents: number
  /** Things to do, each with the screen that does it. */
  todo: { action: 'review' | 'invoices' | 'reconcile' | 'salesTax' | 'close' | 'package'; text: string }[]
}
