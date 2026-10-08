import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountInput } from '../shared/accounts'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const acct = (n: string) => books.chart().accounts.find((a) => a.number === n)!
const input = (over: Partial<AccountInput>): AccountInput => ({
  number: '6101',
  name: 'Etsy fees',
  type: 'expense',
  subtype: '',
  taxCategory: 'commissions_fees',
  description: '',
  ...over
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-sub-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'Sub',
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

describe('sub-accounts', () => {
  it('adds accounts under a parent of the same type, up to five levels, never in a loop', () => {
    books.addAccount(input({ parentId: acct('6100').id }))
    expect(acct('6101').parentId).toBe(acct('6100').id)
    // levels 3, 4 and 5 under 6100 → 6101 → …
    books.addAccount(input({ number: '61011', name: 'Level 3', parentId: acct('6101').id }))
    books.addAccount(input({ number: '610111', name: 'Level 4', parentId: acct('61011').id }))
    books.addAccount(input({ number: '6101111', name: 'Level 5', parentId: acct('610111').id }))
    expect(acct('6101111').parentId).toBe(acct('610111').id)
    expect(() => books.addAccount(input({ number: '61011111', name: 'Level 6', parentId: acct('6101111').id }))).toThrow(
      /up to 5 levels/
    )
    expect(() => books.addAccount(input({ number: '6103', name: 'Y', parentId: acct('1000').id }))).toThrow(/same type/)
    // a parent can't go under its own sub-account
    expect(() =>
      books.updateAccount(acct('6100').id, {
        ...input({ number: '6100', name: 'Marketplace and payment fees' }),
        parentId: acct('61011').id
      })
    ).toThrow(/sits under this one/)
    // moving a whole branch counts its levels: 6100's branch spans 5, so it can't go under 6000
    expect(() =>
      books.updateAccount(acct('6100').id, {
        ...input({ number: '6100', name: 'Marketplace and payment fees' }),
        parentId: acct('6000').id
      })
    ).toThrow(/up to 5 levels/)
    // a shorter branch can move, and its sub-accounts go with it
    books.updateAccount(acct('610111').id, input({ number: '610111', name: 'Level 4', parentId: acct('6000').id }))
    expect(acct('610111').parentId).toBe(acct('6000').id)
    expect(acct('6101111').parentId).toBe(acct('610111').id)
  })

  it('editing without a parent choice keeps it; null moves it back to the top; a parent with sub-accounts can’t be deleted', () => {
    books.addAccount(input({ parentId: acct('6100').id }))
    const id = acct('6101').id
    books.updateAccount(id, input({ name: 'Etsy selling fees' }))
    expect(acct('6101').parentId).toBe(acct('6100').id)
    books.updateAccount(id, input({ parentId: null }))
    expect(acct('6101').parentId).toBeNull()
    books.updateAccount(id, input({ parentId: acct('6100').id }))
    books.addAccount(input({ number: '6190', name: 'Unused parent', parentId: null }))
    books.updateAccount(acct('6190').id, input({ number: '6190', name: 'Unused parent' }))
    books.addAccount(input({ number: '6191', name: 'Child of unused', parentId: acct('6190').id }))
    expect(() => books.deleteAccount(acct('6190').id)).toThrow(/under this one/)
  })

  it('reports show sub-accounts under their parent with a subtotal, and the section total counts each once', () => {
    books.addAccount(input({ parentId: acct('6100').id }))
    const post = (n: string, c: number) =>
      books.postManualEntry({
        date: '2026-03-01',
        memo: 'x',
        lines: [
          { accountId: acct(n).id, amountCents: c, memo: '' },
          { accountId: acct('1000').id, amountCents: -c, memo: '' }
        ]
      })
    post('6100', 1000)
    post('6101', 2500)
    post('6000', 400)
    const pl = books.profitAndLoss('2026-01-01', '2026-12-31')
    expect(pl.expenses.rows.map((r) => [r.subtotal ? r.name : r.number, r.depth, r.values[0]])).toEqual([
      ['6000', 0, 400],
      ['6100', 0, 1000],
      ['6101', 1, 2500],
      ['Total Marketplace and payment fees', 0, 3500]
    ])
    expect(pl.expenses.total).toEqual([3900])
  })

  it('reports nest several levels, with a total at each level that includes everything under it', () => {
    books.addAccount(input({ parentId: acct('6100').id }))
    books.addAccount(input({ number: '61011', name: 'Etsy listing fees', parentId: acct('6101').id }))
    books.addAccount(input({ number: '61012', name: 'Etsy renewals', parentId: acct('6101').id }))
    books.addAccount(input({ number: '610121', name: 'Auto renewals', parentId: acct('61012').id }))
    const post = (n: string, c: number) =>
      books.postManualEntry({
        date: '2026-03-01',
        memo: 'x',
        lines: [
          { accountId: acct(n).id, amountCents: c, memo: '' },
          { accountId: acct('1000').id, amountCents: -c, memo: '' }
        ]
      })
    post('6100', 1000)
    post('61011', 200)
    post('610121', 30)
    const pl = books.profitAndLoss('2026-01-01', '2026-12-31')
    expect(pl.expenses.rows.map((r) => [r.subtotal ? r.name : r.number, r.depth, r.values[0]])).toEqual([
      ['6100', 0, 1000],
      ['6101', 1, 0],
      ['61011', 2, 200],
      ['61012', 2, 0],
      ['610121', 3, 30],
      ['Total Etsy renewals', 2, 30],
      ['Total Etsy fees', 1, 230],
      ['Total Marketplace and payment fees', 0, 1230]
    ])
    expect(pl.expenses.total).toEqual([1230])
  })

  it('a parent with nothing of its own still shows when its sub-account has activity', () => {
    books.addAccount(input({ parentId: acct('6100').id }))
    books.postManualEntry({
      date: '2026-03-01',
      memo: 'x',
      lines: [
        { accountId: acct('6101').id, amountCents: 700, memo: '' },
        { accountId: acct('1000').id, amountCents: -700, memo: '' }
      ]
    })
    const rows = books.profitAndLoss('2026-01-01', '2026-12-31').expenses.rows
    expect(rows.map((r) => [r.subtotal ? 'total' : r.number, r.values[0]])).toEqual([
      ['6100', 0],
      ['6101', 700],
      ['total', 700]
    ])
  })
})

describe('channel accounts', () => {
  it('Etsy and Amazon fee accounts sit under Marketplace and payment fees / Advertising', () => {
    books.addEtsyAccounts()
    books.addAmazonAccounts()
    const byName = (n: string) => books.chart().accounts.find((a) => a.name === n)!
    expect(byName('Etsy transaction fees').parentId).toBe(acct('6100').id)
    expect(byName('Etsy Ads').parentId).toBe(acct('6000').id)
    expect(byName('Amazon referral fees').parentId).toBe(acct('6100').id)
    expect(byName('Etsy payment account').parentId).toBeNull()
  })

  it('fee accounts still go under 6100 when 6100 itself is a sub-account', () => {
    books.addAccount(input({ number: '6090', name: 'Selling costs', parentId: null }))
    books.updateAccount(acct('6100').id, {
      ...input({ number: '6100', name: 'Marketplace and payment fees' }),
      parentId: acct('6090').id
    })
    books.addEtsyAccounts()
    expect(books.chart().accounts.find((a) => a.name === 'Etsy transaction fees')!.parentId).toBe(acct('6100').id)
  })
})
