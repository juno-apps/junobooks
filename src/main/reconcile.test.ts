import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guessMapping, parseCsv } from '../shared/csvImport'
import { reconcileTotals } from '../shared/reconcile'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const id = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-rec-'))
  books = openCompany(root, createCompany(root, { name: 'Rec', entityType: 'smllc', homeState: 'CA', booksStartDate: '2026-01-01', template: 'product' }))
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

function post(date: string, cents: number, other = '4000', acct = '1000'): number {
  return books.postManualEntry({
    date,
    memo: `on ${date}`,
    lines: [
      { accountId: id(acct), amountCents: cents, memo: '' },
      { accountId: id(other), amountCents: -cents, memo: '' }
    ]
  })
}

const lineIds = (accountId: number, dates: string[]): number[] =>
  books.reconcileView(accountId).lines.filter((l) => dates.includes(l.date)).map((l) => l.lineId)

describe('reconciliation', () => {
  it('finishes when ticked lines plus earlier reconciled lines equal the statement', () => {
    post('2026-01-05', 100000)
    post('2026-01-20', -25000, '5000')
    post('2026-01-30', -1000, '6650') // not on the statement yet
    post('2026-02-03', 5000)
    const bank = id('1000')
    let v = books.setStatement(bank, '2026-01-31', 75000)
    expect(v.lines.map((l) => l.date)).toEqual(['2026-01-05', '2026-01-20', '2026-01-30'])
    expect(v.laterCount).toBe(1)
    expect(() => books.finishReconciliation(bank)).toThrow(/off from the statement by \$750\.00/)
    v = books.setCleared(bank, lineIds(bank, ['2026-01-05', '2026-01-20']), true)
    expect(reconcileTotals(v)).toEqual({ clearedCents: 75000, differenceCents: 0 })
    v = books.finishReconciliation(bank)
    expect(v.open).toBeNull()
    expect(v.last).toMatchObject({ statementDate: '2026-01-31', statementBalanceCents: 75000, status: 'finished' })
    expect(v.reconciledCents).toBe(75000)
    // The uncleared January line carries over to the next statement.
    expect(v.lines.map((l) => l.date)).toEqual(['2026-01-30', '2026-02-03'])

    // Next month: starts from the reconciled 750.00.
    books.setStatement(bank, '2026-02-28', 79000)
    v = books.setCleared(bank, lineIds(bank, ['2026-01-30', '2026-02-03']), true)
    expect(reconcileTotals(v).differenceCents).toBe(0)
    books.finishReconciliation(bank)
    expect(books.reconcileView(bank).history.map((h) => h.statementDate)).toEqual(['2026-02-28', '2026-01-31'])
  })

  it('works on the normal side for a credit card (amount owed)', () => {
    post('2026-01-04', -51200, '5000', '2100') // charge: credit the card
    const card = id('2100')
    books.setStatement(card, '2026-01-31', 51200)
    const v = books.setCleared(card, lineIds(card, ['2026-01-04']), true)
    expect(v.lines[0].amountCents).toBe(51200)
    expect(reconcileTotals(v).differenceCents).toBe(0)
    books.finishReconciliation(card)
    expect(books.reconcileView(card).reconciledCents).toBe(51200)
  })

  it('protects finished reconciliations: no voiding, no unticking, only undo with a reason', () => {
    const e = post('2026-01-05', 100000)
    const bank = id('1000')
    books.setStatement(bank, '2026-01-31', 100000)
    books.setCleared(bank, lineIds(bank, ['2026-01-05']), true)
    books.finishReconciliation(bank)
    expect(() => books.voidEntry(e, 'oops')).toThrow(/finished bank reconciliation/)
    const line = books.db.prepare('SELECT journal_line_id AS id FROM line_clearing').get() as { id: number }
    expect(() => books.setCleared(bank, [line.id], false)).toThrow(/undoing its reconciliation/)
    expect(() => books.db.prepare('DELETE FROM line_clearing').run()).toThrow(/finished reconciliation/)
    expect(() => books.db.prepare("UPDATE reconciliations SET statement_balance_cents = 1").run()).toThrow(/only be undone/)
    expect(() => books.setStatement(bank, '2026-01-15', 0)).toThrow(/already covers up to 2026-01-31/)
    expect(() => books.undoLastReconciliation(bank, ' ')).toThrow(/reason/)

    books.undoLastReconciliation(bank, 'statement entered wrong')
    const v = books.reconcileView(bank)
    expect(v.last).toBeNull()
    expect(v.history[0]).toMatchObject({ status: 'undone', undoReason: 'statement entered wrong' })
    expect(v.lines[0].cleared).toBe(true)
    books.voidEntry(e, 'now allowed')
  })

  it('imported lines are marked cleared when posted or matched, and the register shows it', () => {
    const typed = post('2026-03-01', -24510, '5000')
    const text = 'Date,Description,Amount\n03/03/2026,RIO GRANDE,-245.10\n03/04/2026,ETSY,100.00'
    books.stageImport({ accountId: id('1000'), fileName: 'a.csv', text, mapping: guessMapping(parseCsv(text)) })
    const [rio, etsy] = books.linesToReview()
    books.matchBankLine(rio.id, typed)
    books.postBankLines([{ lineId: etsy.id, accountId: id('4000'), memo: '' }])
    const v = books.reconcileView(id('1000'))
    expect(v.lines.every((l) => l.cleared)).toBe(true)
    const reg = books.register({ accountId: id('1000') })
    expect(reg.rows.map((r) => r.clearing)).toEqual(['cleared', 'cleared'])
  })

  it('cancel drops the reconciliation in progress but keeps the ticks', () => {
    post('2026-01-05', 100000)
    const bank = id('1000')
    books.setStatement(bank, '2026-01-31', 1)
    books.setCleared(bank, lineIds(bank, ['2026-01-05']), true)
    const v = books.cancelReconciliation(bank)
    expect(v.open).toBeNull()
    expect(v.lines[0].cleared).toBe(true)
    expect(() => books.finishReconciliation(bank)).toThrow(/statement date/)
  })
})
