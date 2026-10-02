import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  classifyEtsyRow,
  etsyFingerprints,
  orderIdFrom,
  parseEtsyDate,
  parseEtsyOrders,
  parseEtsyStatement,
  planEtsy,
  rowPostings,
  taxInsideAmounts
} from './etsy'

const sample = (n: string): string => readFileSync(join(__dirname, '..', '..', 'samples', 'etsy', n), 'utf8')
const statement = parseEtsyStatement(sample('etsy_statement_2026_3.csv'))
const orders = new Map(parseEtsyOrders(sample('EtsySoldOrders2026-3.csv')).orders.map((o) => [o.orderId, o]))

describe('reading Etsy files', () => {
  it('reads dates in Etsy styles', () => {
    expect(parseEtsyDate('March 3, 2026')).toBe('2026-03-03')
    expect(parseEtsyDate('Mar 3, 2026')).toBe('2026-03-03')
    expect(parseEtsyDate('3 March 2026')).toBe('2026-03-03')
    expect(parseEtsyDate('03/03/26')).toBe('2026-03-03')
    expect(parseEtsyDate('2026-03-03')).toBe('2026-03-03')
    expect(parseEtsyDate('Smarch 3, 2026')).toBeNull()
  })

  it('classifies rows by type and title', () => {
    expect(classifyEtsyRow('Sale', 'Payment for Order #1')).toBe('sale')
    expect(classifyEtsyRow('Fee', 'Transaction fee: Ring')).toBe('transaction_fee')
    expect(classifyEtsyRow('Transaction', 'Ring')).toBe('transaction_fee')
    expect(classifyEtsyRow('Fee', 'Processing fee')).toBe('processing_fee')
    expect(classifyEtsyRow('Listing', 'Listing fee')).toBe('listing_fee')
    expect(classifyEtsyRow('Fee', 'Auto-renew sold')).toBe('listing_fee')
    expect(classifyEtsyRow('Marketing', 'Etsy Ads')).toBe('etsy_ads')
    expect(classifyEtsyRow('Marketing', 'Offsite Ads fee for Order #1')).toBe('offsite_ads')
    expect(classifyEtsyRow('Shipping', 'USPS shipping label')).toBe('shipping_label')
    expect(classifyEtsyRow('Tax', 'Sales tax paid by buyer')).toBe('sales_tax')
    expect(classifyEtsyRow('VAT', 'VAT: seller services')).toBe('fee_tax')
    expect(classifyEtsyRow('Refund', 'Refund to buyer for Order #1')).toBe('refund')
    expect(classifyEtsyRow('Deposit', '$10.00 sent to your bank account')).toBe('deposit')
    expect(classifyEtsyRow('Subscription', 'Etsy Plus subscription')).toBe('subscription')
    expect(classifyEtsyRow('Fee', 'Regulatory operating fee')).toBe('other_fee')
    expect(classifyEtsyRow('Payment', 'Payment from credit card')).toBe('payment')
    expect(classifyEtsyRow('Reserve', 'Something new')).toBe('unknown')
    // Wording from real statements
    expect(classifyEtsyRow('Tax', 'Refund to buyer for sales tax')).toBe('sales_tax')
    expect(classifyEtsyRow('Buyer Fee', 'Colorado Retail Delivery Fee (paid by buyer)')).toBe('state_fee')
    expect(classifyEtsyRow('Fee', 'Credit for transaction fee on Gold Band')).toBe('transaction_fee')
    expect(classifyEtsyRow('Fee', 'Credit for transaction fee on shipping')).toBe('transaction_fee')
    expect(classifyEtsyRow('Fee', 'Transaction fee: Free Shipping Label Ring')).toBe('transaction_fee')
    expect(classifyEtsyRow('Fee', 'Credit for processing fee')).toBe('processing_fee')
    expect(classifyEtsyRow('Fee', 'Credit for listing fee')).toBe('listing_fee')
    expect(classifyEtsyRow('Fee', 'Credit for Etsy Ads fee')).toBe('etsy_ads')
    expect(classifyEtsyRow('Marketing', 'Etsy Plus subscription fee')).toBe('subscription')
    expect(classifyEtsyRow('Marketing', 'Fee for sale made through Offsite Ads')).toBe('offsite_ads')
    expect(classifyEtsyRow('Shipping label', 'Credit for UPS shipping label adjustment')).toBe('shipping_label')
    expect(classifyEtsyRow('Shipping', 'Shipsurance Package Insurance')).toBe('shipping_label')
    expect(orderIdFrom('Payment for Order #3301000001')).toBe('3301000001')
    expect(orderIdFrom('', 'Order #3301000002')).toBe('3301000002')
  })

  it('reads the sample statement, skipping zero rows, and the deposit amount from its title', () => {
    expect(statement.problems).toEqual([])
    expect(statement.rows).toHaveLength(14) // the $0.00 processing fee row is left out
    const dep = statement.rows.find((r) => r.kind === 'deposit')!
    expect(dep).toMatchObject({ date: '2026-03-15', depositCents: 11065 })
    const sale = statement.rows.find((r) => r.orderId === '3301000001' && r.kind === 'sale')!
    expect(sale).toMatchObject({ amountCents: 6400, feesCents: -217 })
  })

  it('reads orders, netting discounts', () => {
    expect(orders.get('3301000002')).toMatchObject({
      itemsCents: 10800,
      shippingCents: 1200,
      discountCents: 1200,
      shipState: 'TX'
    })
    expect(orders.get('3301000001')).toMatchObject({ itemsCents: 5800, shippingCents: 600, salesTaxCents: 512 })
  })

  it('refuses files that are not Etsy statements or orders', () => {
    expect(() => parseEtsyStatement('Date,Description,Amount\n03/01/2026,x,1')).toThrow(/Etsy payments statement/)
    expect(() => parseEtsyOrders('a,b\n1,2')).toThrow(/Sold Orders/)
  })

  it('flags non-dollar rows', () => {
    const s = parseEtsyStatement(
      'Date,Type,Title,Info,Currency,Amount,Fees & Taxes,Net\n"March 1, 2026",Sale,"Payment for Order #1234567",,EUR,€5,--,€5'
    )
    expect(s.problems[0].reason).toMatch(/EUR/)
  })
})

describe('planning entries', () => {
  it('splits a sale into items, shipping and the processing fee, balanced through the clearing account', () => {
    const sale = statement.rows.find((r) => r.orderId === '3301000002' && r.kind === 'sale')!
    expect(rowPostings(sale, orders)).toEqual([
      { target: 'sale', cents: -10800 },
      { target: 'shipping', cents: -1200 },
      { target: 'processing_fee', cents: 385 },
      { target: 'clearing', cents: 11615 }
    ])
    // Without the orders file the whole sale is item sales.
    expect(rowPostings(sale, new Map())[0]).toEqual({ target: 'sale', cents: -12000 })
  })

  it('refunds go to refunds, fee credits back to processing fees; sales tax nets to zero', () => {
    const refund = statement.rows.find((r) => r.kind === 'refund')!
    expect(rowPostings(refund, orders)).toEqual([
      { target: 'refund', cents: 2000 },
      { target: 'processing_fee', cents: -45 },
      { target: 'clearing', cents: -1955 }
    ])
    const tax = statement.rows.find((r) => r.kind === 'sales_tax')!
    expect(rowPostings(tax, orders)).toEqual([
      { target: 'sales_tax', cents: -512 },
      { target: 'sales_tax', cents: 512 }
    ])
  })

  it('makes one balanced entry per day and one transfer per deposit', () => {
    const plan = planEtsy(statement.rows, orders)
    expect(plan.days.map((d) => d.date)).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-05',
      '2026-03-09',
      '2026-03-10',
      '2026-03-12',
      '2026-03-20',
      '2026-03-31'
    ])
    for (const d of plan.days) expect(d.lines.reduce((s, l) => s + l.cents, 0)).toBe(0)
    const mar3 = plan.days[1]
    expect(mar3.memo).toBe('Etsy activity 2026-03-03: 1 sale, 3 fee and other lines')
    expect(Object.fromEntries(mar3.lines.map((l) => [l.target, l.cents]))).toEqual({
      sale: -5800,
      shipping: -600,
      processing_fee: 217,
      transaction_fee: 413,
      clearing: 5770
    })
    expect(plan.deposits).toEqual([
      { date: '2026-03-15', cents: 11065, row: 14, title: '$110.65 sent to your bank account' }
    ])
    const clearing = plan.days
      .flatMap((d) => d.lines)
      .filter((l) => l.target === 'clearing')
      .reduce((s, l) => s + l.cents, 0)
    expect(clearing).toBe(11065 - 1013) // everything up to the deposit, then two fees after it
  })

  it('takes the buyer-paid sales tax inside sale and refund amounts out of Sales and Refunds (real statement layout)', () => {
    // Made-up rows in Etsy's real layout: the sale amount includes tax; tax rows use Fees & Taxes only.
    const s = parseEtsyStatement(
      [
        'Date,Type,Title,Info,Currency,Amount,Fees & Taxes,Net,Tax Details',
        '"Sep 3, 2026",Sale,"Payment for Order #4400000001",,USD,$108.00,--,$108.00,',
        '"Sep 3, 2026",Tax,"Sales tax paid by buyer","Order #4400000001",USD,--,-$8.00,-$8.00,',
        '"Sep 3, 2026","Buyer Fee","Colorado Retail Delivery Fee (paid by buyer)","Order #4400000001",USD,--,-$0.31,-$0.31,',
        '"Sep 3, 2026",Fee,"Processing fee","Order #4400000001",USD,--,-$3.50,-$3.50,',
        '"Sep 9, 2026",Refund,"Refund for Order #4400000001",,USD,-$54.00,--,-$54.00,',
        '"Sep 9, 2026",Tax,"Refund to buyer for sales tax","Order #4400000001",USD,--,$4.00,$4.00,',
        '"Sep 9, 2026",Fee,"Credit for transaction fee on Gold Band",,USD,--,$1.50,$1.50,',
        '"Sep 9, 2026",Tax,"Sales tax paid by buyer","Order #4400000999",USD,--,-$2.00,-$2.00,',
        '"Sep 9, 2026",Tax,"Refund to buyer for sales tax","Order #4400000888",USD,--,$1.00,$1.00,'
      ].join('\n')
    )
    const ord = new Map([
      ['4400000001', { orderId: '4400000001', saleDate: '2026-09-03', itemsCents: 9000, shippingCents: 969, discountCents: 0, salesTaxCents: 0, totalCents: 10800, shipState: 'CO', shipCountry: 'United States' }]
    ])
    const tax = taxInsideAmounts(s.rows)
    expect(tax.get('4400000001')).toEqual({ sales_tax: { paid: 800, refunded: 400 }, state_fee: { paid: 31, refunded: 0 } })
    const sale = s.rows.find((r) => r.kind === 'sale')!
    expect(rowPostings(sale, ord, tax)).toEqual([
      { target: 'sale', cents: -9000 },
      { target: 'shipping', cents: -969 },
      { target: 'sales_tax', cents: -800 },
      { target: 'state_fee', cents: -31 },
      { target: 'clearing', cents: 10800 }
    ])
    const refund = s.rows.find((r) => r.kind === 'refund')!
    expect(rowPostings(refund, ord, tax)).toEqual([
      { target: 'refund', cents: 5000 },
      { target: 'sales_tax', cents: 400 },
      { target: 'clearing', cents: -5400 }
    ])
    const plan = planEtsy(s.rows, ord)
    const sum = (t: string): number =>
      plan.days.flatMap((d) => d.lines).filter((l) => l.target === t).reduce((a, l) => a + l.cents, 0)
    expect(sum('sales_tax')).toBe(0) // passes through
    expect(sum('state_fee')).toBe(0)
    expect(sum('sale')).toBe(-9000 + 200) // tax for a sale imported earlier comes out of Sales
    expect(sum('refund')).toBe(5000 - 100) // tax returned on a refund imported earlier comes off Refunds
    expect(sum('transaction_fee')).toBe(-150) // the credit lowers transaction fees
    expect(sum('processing_fee')).toBe(350)
    for (const d of plan.days) expect(d.lines.reduce((a, l) => a + l.cents, 0)).toBe(0)
  })

  it('numbers identical rows so both import, and re-reading gives the same fingerprints', () => {
    const fps = etsyFingerprints(statement.rows)
    expect(new Set(fps).size).toBe(fps.length)
    expect(etsyFingerprints(parseEtsyStatement(sample('etsy_statement_2026_3.csv')).rows)).toEqual(fps)
  })
})
