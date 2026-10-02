import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  amazonFingerprints,
  amazonGross,
  classifyAmazonRow,
  parseAmazonDate,
  parseAmazonSettlement,
  planAmazon
} from './amazon'

const s = parseAmazonSettlement(
  readFileSync(join(__dirname, '..', '..', 'samples', 'amazon', 'settlement-24000000001.txt'), 'utf8')
)

describe('Amazon settlement reader', () => {
  it('reads dates in Amazon styles', () => {
    expect(parseAmazonDate('2026-03-17 00:00:00 UTC')).toBe('2026-03-17')
    expect(parseAmazonDate('2026-03-17T07:32:11+00:00')).toBe('2026-03-17')
    expect(parseAmazonDate('03/17/2026')).toBe('2026-03-17')
    expect(parseAmazonDate('17.03.2026')).toBe('2026-03-17')
    expect(parseAmazonDate('soon')).toBeNull()
  })

  it('classifies rows', () => {
    expect(classifyAmazonRow('Order', 'ItemPrice', 'Principal')).toBe('sale')
    expect(classifyAmazonRow('Order', 'ItemPrice', 'Shipping')).toBe('shipping')
    expect(classifyAmazonRow('Order', 'ItemPrice', 'GiftWrap')).toBe('shipping')
    expect(classifyAmazonRow('Order', 'ItemPrice', 'ShippingTax')).toBe('sales_tax')
    expect(classifyAmazonRow('Order', 'ItemWithheldTax', 'MarketplaceFacilitatorTax-Principal')).toBe('sales_tax')
    expect(classifyAmazonRow('Order', 'Promotion', 'Principal')).toBe('promotion')
    expect(classifyAmazonRow('Refund', 'ItemPrice', 'Principal')).toBe('refund')
    expect(classifyAmazonRow('Order', 'ItemFees', 'Commission')).toBe('referral_fee')
    expect(classifyAmazonRow('Refund', 'ItemFees', 'RefundCommission')).toBe('referral_fee')
    expect(classifyAmazonRow('Order', 'ItemFees', 'FBAPerUnitFulfillmentFee')).toBe('fba_fee')
    expect(classifyAmazonRow('Order', 'ItemFees', 'ShippingChargeback')).toBe('shipping_fee')
    expect(classifyAmazonRow('Order', 'ItemFees', 'VariableClosingFee')).toBe('other_fee')
    expect(classifyAmazonRow('other-transaction', 'other-transaction', 'Subscription Fee')).toBe('subscription')
    expect(classifyAmazonRow('other-transaction', 'other-transaction', 'Storage Fee')).toBe('fba_fee')
    expect(classifyAmazonRow('other-transaction', 'other-transaction', 'Current Reserve Amount')).toBe('reserve')
    expect(classifyAmazonRow('ServiceFee', 'Cost of Advertising', 'TransactionTotalAmount')).toBe('advertising')
    expect(classifyAmazonRow('other-transaction', 'other-transaction', 'REVERSAL_REIMBURSEMENT')).toBe('other_income')
    expect(classifyAmazonRow('Mystery', 'Thing', 'Else')).toBe('unknown')
  })

  it('reads the sample settlement: summary, rows, payout', () => {
    expect(s.problems).toEqual([])
    expect(s).toMatchObject({
      settlementId: '24000000001',
      depositDate: '2026-03-17',
      endDate: '2026-03-15',
      totalCents: 5939
    })
    expect(s.rows).toHaveLength(15)
    expect(s.rows.reduce((t, r) => t + r.amountCents, 0)).toBe(5939)
  })

  it('refuses other files', () => {
    expect(() => parseAmazonSettlement('Date,Description,Amount\n03/01/2026,x,1')).toThrow(/Amazon settlement report/)
  })
})

describe('Amazon posting plan', () => {
  const plan = planAmazon(s, s.rows)
  it('one balanced entry per posted day, reserves left in the Amazon account, payout as a transfer', () => {
    expect(plan.days.map((d) => d.date)).toEqual(['2026-03-03', '2026-03-07', '2026-03-10', '2026-03-12'])
    for (const d of plan.days) expect(d.lines.reduce((t, l) => t + l.cents, 0)).toBe(0)
    expect(Object.fromEntries(plan.days[0].lines.map((l) => [l.target, l.cents]))).toEqual({
      sale: -8500,
      shipping: -500,
      referral_fee: 1350,
      shipping_fee: 410,
      clearing: 7240 // tax collected and withheld cancel out
    })
    expect(plan.days[0].memo).toBe('Amazon activity 2026-03-03: 1 order')
    expect(plan.deposit).toEqual({ date: '2026-03-17', cents: 5939 })
    const clearing = plan.days
      .flatMap((d) => d.lines)
      .filter((l) => l.target === 'clearing')
      .reduce((t, l) => t + l.cents, 0)
    expect(clearing - 5939).toBe(1200 - 948) // the reserve Amazon kept back this time
  })

  it('gross for the 1099-K counts order item price, shipping and tax only', () => {
    expect(s.rows.reduce((t, r) => t + amazonGross(r), 0)).toBe(8500 + 500 + 698 + 6000)
  })

  it('fingerprints are unique and stable', () => {
    const fps = amazonFingerprints(s.rows)
    expect(new Set(fps).size).toBe(fps.length)
  })
})
