import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'
import { setLockedThrough } from './ledger'

let root: string
let books: CompanyBooks
const num = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id
const bal = (n: string): number => books.register({ accountId: num(n), to: '2026-12-31' }).closingCents

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-inv-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'I',
      entityType: 'smllc',
      homeState: 'CA',
      booksStartDate: '2026-01-01',
      template: 'product'
    })
  )
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

function silver(): number {
  const o = books.addInventoryItem({ name: 'Sterling silver sheet', unit: 'g', notes: '' })
  const id = o.items[0].id
  books.addInventoryPurchase({
    itemId: id,
    date: '2026-01-01',
    quantityMilli: 100000,
    costCents: 20000,
    isOpening: true,
    memo: 'On hand'
  })
  books.addInventoryPurchase({
    itemId: id,
    date: '2026-03-01',
    quantityMilli: 50000,
    costCents: 15000,
    isOpening: false,
    memo: ''
  })
  books.addInventoryPurchase({
    itemId: id,
    date: '2026-06-01',
    quantityMilli: 50000,
    costCents: 20000,
    isOpening: false,
    memo: ''
  })
  books.saveCount('2026-12-31', [{ itemId: id, quantityMilli: 80000 }])
  return id
}

describe('items, purchases and counts', () => {
  it('adds items (unique names), purchases and counts', () => {
    const id = silver()
    expect(() => books.addInventoryItem({ name: 'sterling SILVER sheet', unit: 'g', notes: '' })).toThrow(
      /already an item/
    )
    expect(() => books.addInventoryItem({ name: 'Wire', unit: ' ', notes: '' })).toThrow(/unit/)
    const o = books.inventoryOverview()
    expect(o.purchases).toHaveLength(3)
    expect(o.counts).toEqual([{ date: '2026-12-31', items: 1 }])
    const sheet = books.countSheet('2026-12-31')
    expect(sheet.rows[0]).toMatchObject({ itemId: id, quantityMilli: 80000, expectedMilli: 200000 })
  })

  it('removes purchases softly and refuses changes in a closed period', () => {
    silver()
    const p = books.inventoryOverview().purchases[0]
    books.removeInventoryPurchase(p.id)
    expect(books.inventoryOverview().purchases).toHaveLength(2)
    expect(() => books.db.prepare('DELETE FROM inventory_purchases').run()).toThrow(/kept on record/)
    setLockedThrough(books.db, '2026-03-31')
    const march = books.inventoryOverview().purchases.find((x) => x.date === '2026-03-01')!
    expect(() => books.removeInventoryPurchase(march.id)).toThrow(/closed through/)
    expect(() => books.saveCount('2026-02-01', [])).toThrow(/closed through/)
  })
})

describe('year report and filed method', () => {
  it('shows all four methods and the purchases-vs-books check', () => {
    silver()
    books.postManualEntry({
      date: '2026-03-01',
      memo: 'Silver',
      lines: [
        { accountId: num('5000'), amountCents: 15000, memo: '' },
        { accountId: num('1000'), amountCents: -15000, memo: '' }
      ]
    })
    const r = books.inventoryYear(2026)
    expect(r.filed).toBeNull()
    expect(Object.fromEntries(r.methods.map((m) => [m.method, m.endCents]))).toEqual({
      periodic: 32000,
      fifo: 29000,
      average: 22000,
      expensed: 0
    })
    expect(r.notCounted).toEqual([])
    expect(r.check).toEqual({ inventoryPurchasesCents: 35000, booksPurchasesCents: 15000 })
  })

  it('records the filed method with history; changing it needs a reason', () => {
    books.setFiledMethod(2026, 'fifo', '')
    expect(() => books.setFiledMethod(2026, 'average', '')).toThrow(/needs a reason/)
    const r = books.setFiledMethod(2026, 'average', 'Accountant filed Form 3115')
    expect(r.filed).toBe('average')
    expect(r.history.map((h) => h.method)).toEqual(['average', 'fifo'])
    expect(() => books.db.prepare('DELETE FROM inventory_methods').run()).toThrow(/can't be changed/)
  })

  it('posts the year-end adjustment for the filed method, and re-posting replaces it', () => {
    silver()
    const { inventoryAccountId, cogsAccountId } = books.inventoryAdjustmentAccounts()
    expect(() => books.postInventoryAdjustment(2026, inventoryAccountId!, cogsAccountId!)).toThrow(
      /Choose the filed method/
    )
    books.setFiledMethod(2026, 'fifo', '')
    let r = books.postInventoryAdjustment(2026, inventoryAccountId!, cogsAccountId!)
    expect(bal('1300')).toBe(29000)
    expect(bal('5000')).toBe(-29000)
    expect(r.adjustment).toMatchObject({ method: 'fifo', valueCents: 29000 })
    expect(r.inventoryBalanceCents).toBe(29000)

    books.setFiledMethod(2026, 'average', 'accountant said so')
    r = books.postInventoryAdjustment(2026, inventoryAccountId!, cogsAccountId!)
    expect(bal('1300')).toBe(22000)
    expect(r.adjustment!.valueCents).toBe(22000)
    expect(
      books
        .entries()
        .filter((e) => e.source === 'inventory')
        .map((e) => e.status)
    ).toEqual(['posted', 'void'])
  })

  it('accounts for an opening inventory balance already in the books', () => {
    silver()
    books.saveOpeningBalances([{ accountId: num('1300'), amountCents: 20000 }])
    books.setFiledMethod(2026, 'periodic', '')
    const { inventoryAccountId, cogsAccountId } = books.inventoryAdjustmentAccounts()
    books.postInventoryAdjustment(2026, inventoryAccountId!, cogsAccountId!)
    expect(bal('1300')).toBe(32000)
    expect(bal('5000')).toBe(-12000)
  })
})
