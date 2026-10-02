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
  rowPostings
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

  it('numbers identical rows so both import, and re-reading gives the same fingerprints', () => {
    const fps = etsyFingerprints(statement.rows)
    expect(new Set(fps).size).toBe(fps.length)
    expect(etsyFingerprints(parseEtsyStatement(sample('etsy_statement_2026_3.csv')).rows)).toEqual(fps)
  })
})
