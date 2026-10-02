import type { TaxForm } from './entities'

/** Shapes for the year-end detail reports. */

export interface ChannelSales {
  from: string
  to: string
  channels: { source: string; name: string; salesCents: number; refundsCents: number; netCents: number }[]
  totalSalesCents: number
  totalRefundsCents: number
  totalNetCents: number
}

export interface TaxLineSummary {
  year: number
  form: TaxForm
  formLabel: string
  /** The IRS form year the line numbers come from. */
  tableYear: number
  lines: {
    part: 'income' | 'balance'
    ref: string | null
    label: string
    cents: number
    accounts: { accountId: number; number: string; name: string; cents: number; note: string }[]
  }[]
  unmapped: { accountId: number; number: string; name: string; cents: number }[]
}

export interface CogsSchedule {
  year: number
  beginningCents: number
  purchasesCents: number
  laborCents: number
  materialsCents: number
  otherCents: number
  subtotalCents: number
  endingCents: number
  cogsCents: number
  filedMethod: string | null
  yearEndEntryPosted: boolean
}
