import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guessMapping, parseCsv } from '../shared/csvImport'
import { findRule, suggestMatchText, type CategorizationRule } from '../shared/rules'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

const rule = (p: Partial<CategorizationRule>): CategorizationRule => ({
  id: 1,
  matchText: 'x',
  accountId: 10,
  payee: '',
  bankAccountId: null,
  isActive: true,
  ...p
})

describe('findRule', () => {
  it('matches text inside the description, ignoring case and spacing; longest wins', () => {
    const rules = [rule({ id: 1, matchText: 'etsy' }), rule({ id: 2, matchText: 'ETSY  INC PAYOUT', accountId: 11 })]
    expect(findRule(rules, { description: 'ETSY INC PAYOUT 260303', accountId: 1 })?.id).toBe(2)
    expect(findRule(rules, { description: 'Etsy ads', accountId: 1 })?.id).toBe(1)
    expect(findRule(rules, { description: 'Amazon', accountId: 1 })).toBeNull()
  })

  it('respects inactive rules, bank-account limits, unusable accounts, and never targets the same account', () => {
    expect(findRule([rule({ matchText: 'usps', isActive: false })], { description: 'USPS', accountId: 1 })).toBeNull()
    expect(findRule([rule({ matchText: 'usps', bankAccountId: 2 })], { description: 'USPS', accountId: 1 })).toBeNull()
    expect(findRule([rule({ matchText: 'usps', bankAccountId: 1 })], { description: 'USPS', accountId: 1 })).not.toBeNull()
    expect(findRule([rule({ matchText: 'usps' })], { description: 'USPS', accountId: 1 }, () => false)).toBeNull()
    expect(findRule([rule({ matchText: 'usps', accountId: 1 })], { description: 'USPS', accountId: 1 })).toBeNull()
  })

  it('suggests rule text without reference numbers', () => {
    expect(suggestMatchText('ETSY INC PAYOUT 260303')).toBe('ETSY INC PAYOUT')
    expect(suggestMatchText('ADOBE *CREATIVE CLOUD')).toBe('ADOBE CREATIVE CLOUD')
    expect(suggestMatchText('PURCHASE 03/01 FIRE MOUNTAIN GEMS ASHLAND OR')).toBe('PURCHASE FIRE MOUNTAIN GEMS')
  })
})

describe('rules in the books', () => {
  let root: string
  let books: CompanyBooks
  const id = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'junobooks-rules-'))
    books = openCompany(root, createCompany(root, { name: 'R', entityType: 'smllc', homeState: 'CA', booksStartDate: '2026-01-01', template: 'product' }))
  })
  afterEach(() => {
    books.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('suggests accounts on imported lines, and posting uses them', () => {
    books.addRule({ matchText: 'rio grande', accountId: id('5000'), payee: 'Rio Grande', bankAccountId: null })
    const text = 'Date,Description,Amount\n03/02/2026,RIO GRANDE ALBUQUERQUE,-245.10\n03/03/2026,ETSY PAYOUT,1180.55'
    books.stageImport({ accountId: id('1000'), fileName: 'a.csv', text, mapping: guessMapping(parseCsv(text)) })
    const [rio, etsy] = books.linesToReview()
    expect(rio.suggestion).toMatchObject({ accountId: id('5000'), payee: 'Rio Grande', matchText: 'rio grande' })
    expect(etsy.suggestion).toBeNull()
  })

  it('validates, updates, deactivates and deletes rules (audited)', () => {
    expect(() => books.addRule({ matchText: 'ab', accountId: id('5000'), payee: '', bankAccountId: null })).toThrow(/three letters/)
    expect(() => books.addRule({ matchText: 'abc', accountId: null, payee: '', bankAccountId: null })).toThrow(/Choose the account/)
    const [r] = books.addRule({ matchText: 'canva', accountId: id('6000'), payee: '', bankAccountId: id('2100') })
    const after = books.updateRule(r.id, { matchText: 'canva', accountId: id('6000'), payee: 'Canva', bankAccountId: null, isActive: false })
    expect(after[0]).toMatchObject({ payee: 'Canva', isActive: false, bankAccountId: null })
    expect(books.deleteRule(r.id)).toEqual([])
    const audit = books.db.prepare("SELECT action FROM audit_log WHERE table_name = 'categorization_rules' ORDER BY id").all()
    expect(audit).toEqual([{ action: 'insert' }, { action: 'update' }, { action: 'delete' }])
  })
})
