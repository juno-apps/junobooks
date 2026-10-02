/** 1099-K tie-out rows: one per payment platform for a year. */
export interface TieOutRow {
  platform: string
  /** JunoBooks imports this platform's statements (Etsy, Amazon). */
  imported: boolean
  /** What buyers paid through the platform per JunoBooks' imports: sales, shipping and sales tax, before fees and refunds. */
  importedCents: number
  monthlyCents: number[]
  /** Refunds in the imported statements (for explaining differences). */
  refundsCents: number
  /** Box 1a on the platform's 1099-K, as typed in. */
  formCents: number | null
  notes: string
  /** Form minus imported. */
  differenceCents: number | null
}

/** Usual reasons a 1099-K and the books differ, shown next to a difference. */
export const DIFFERENCE_REASONS = [
  'Months not imported yet, or a statement imported twice under different file versions.',
  'The 1099-K counts sales when the buyer paid; statements count them when the platform posted them (late December / early January).',
  'Gift card, coupon or promotion amounts the platform counts differently.',
  'Sales tax: some platforms include the tax they collected in box 1a, some do not.',
  'Refunds and fees are not taken off the 1099-K gross; they are deductions on your return.'
]
