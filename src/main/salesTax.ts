import type Database from 'better-sqlite3'
import { isValidDate } from '../shared/dates'
import { scaleCents } from '../shared/inventory'
import { certificateValid } from '../shared/sales'
import {
  rateOn,
  type RateInput,
  type ResaleSale,
  type SalesTaxPaymentInput,
  type SalesTaxRate,
  type SalesTaxReport
} from '../shared/salesTax'
import { LedgerError, postEntry } from './ledger'
import { listCertificates } from './sales'

/** Sales tax rates (dated data) and the sales tax report for a period. */

export const SALES_TAX_PAYMENT = 'sales_tax_payment'
const MARKETPLACES = ['etsy', 'amazon']

export function listRates(db: Database.Database): SalesTaxRate[] {
  return db
    .prepare(
      `SELECT id, state_code AS stateCode, place, rate_milli AS rateMilli, effective_date AS effectiveDate, notes
       FROM sales_tax_rates ORDER BY state_code, effective_date DESC, place`
    )
    .all() as SalesTaxRate[]
}

export function addRate(db: Database.Database, input: RateInput, now: Date = new Date()): void {
  if (!/^[A-Z]{2}$/.test(input.stateCode)) throw new LedgerError('Choose the state.')
  if (!isValidDate(input.effectiveDate)) throw new LedgerError('Enter the date the rate starts.')
  if (!Number.isSafeInteger(input.rateMilli) || input.rateMilli < 0 || input.rateMilli > 100000) {
    throw new LedgerError('Enter the rate as a percent, e.g. 7.75.')
  }
  const exists = db
    .prepare('SELECT 1 FROM sales_tax_rates WHERE state_code = ? AND place = ? AND effective_date = ?')
    .get(input.stateCode, input.place.trim(), input.effectiveDate)
  if (exists)
    throw new LedgerError('There is already a rate for that place starting that day. Remove it first to change it.')
  db.prepare(
    'INSERT INTO sales_tax_rates (state_code, place, rate_milli, effective_date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    input.stateCode,
    input.place.trim(),
    input.rateMilli,
    input.effectiveDate,
    input.notes.trim(),
    now.toISOString()
  )
}

export function removeRate(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM sales_tax_rates WHERE id = ?').run(id)
}

export function homeStateOn(db: Database.Database, date: string): string {
  const r =
    (db
      .prepare(
        'SELECT state_code AS s FROM home_state_history WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1'
      )
      .get(date) as { s: string } | undefined) ??
    (db.prepare('SELECT state_code AS s FROM home_state_history ORDER BY effective_date LIMIT 1').get() as
      { s: string } | undefined)
  return r?.s ?? 'CA'
}

/** The home state's rate in force on a date (null if none entered). */
export function homeRateOn(db: Database.Database, date: string): SalesTaxRate | null {
  return rateOn(listRates(db), homeStateOn(db, date), date)
}

function sum(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { c: number | null }).c ?? 0
}

const marketList = MARKETPLACES.map((m) => `'${m}'`).join(', ')

function periodFigures(db: Database.Database, from: string, to: string) {
  const posted = `FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ?`
  const gross = -sum(db, `SELECT SUM(l.amount_cents) AS c ${posted} AND a.tax_category = 'gross_receipts'`, from, to)
  const marketplace = -sum(
    db,
    `SELECT SUM(l.amount_cents) AS c ${posted} AND a.tax_category = 'gross_receipts' AND e.source IN (${marketList})`,
    from,
    to
  )
  const refunds = sum(
    db,
    `SELECT SUM(l.amount_cents) AS c ${posted} AND a.tax_category = 'returns_allowances' AND e.source NOT IN (${marketList})`,
    from,
    to
  )
  const charged = -sum(
    db,
    `SELECT SUM(l.amount_cents) AS c ${posted} AND a.subtype = 'sales_tax' AND l.amount_cents < 0 AND e.source <> ?`,
    from,
    to,
    SALES_TAX_PAYMENT
  )
  const paid = sum(
    db,
    `SELECT SUM(l.amount_cents) AS c ${posted} AND a.subtype = 'sales_tax' AND e.source = ?`,
    from,
    to,
    SALES_TAX_PAYMENT
  )
  const invoices = db
    .prepare(
      `SELECT i.id AS invoiceId, i.number, i.issue_date AS date, c.name AS customerName, i.subtotal_cents AS subtotalCents,
         i.customer_id AS customerId
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.status = 'open' AND i.tax_exempt = 1 AND i.issue_date BETWEEN ? AND ? ORDER BY i.issue_date, i.number`
    )
    .all(from, to) as (Omit<ResaleSale, 'certificate'> & { customerId: number })[]
  const resale: ResaleSale[] = []
  const otherExempt: ResaleSale[] = []
  for (const inv of invoices) {
    const cert = listCertificates(db, inv.customerId).find((c) => certificateValid(c, inv.date))
    const row = {
      invoiceId: inv.invoiceId,
      number: inv.number,
      date: inv.date,
      customerName: inv.customerName,
      subtotalCents: inv.subtotalCents,
      certificate: cert ? `${cert.certNumber} (${cert.stateCode})` : null
    }
    ;(cert ? resale : otherExempt).push(row)
  }
  const resaleCents = resale.reduce((s, r) => s + r.subtotalCents, 0)
  const otherExemptCents = otherExempt.reduce((s, r) => s + r.subtotalCents, 0)
  return {
    gross,
    marketplace,
    refunds,
    charged,
    paid,
    resale,
    otherExempt,
    resaleCents,
    otherExemptCents,
    taxable: gross - marketplace - resaleCents - otherExemptCents - refunds
  }
}

const lastDay = (y: number, m: number): string => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

export function salesTaxReport(db: Database.Database, from: string, to: string): SalesTaxReport {
  if (!isValidDate(from) || !isValidDate(to)) throw new LedgerError('Choose the period.')
  if (from > to) throw new LedgerError('The period starts after it ends.')
  const f = periodFigures(db, from, to)
  const rates = listRates(db)
  const homeState = homeStateOn(db, to)

  // Month by month, so a rate change mid-period is applied from its start month.
  const months: SalesTaxReport['months'] = []
  let computed = 0
  let missingRate = false
  let [y, m] = from.split('-').map(Number)
  while (true) {
    const mFrom = `${y}-${String(m).padStart(2, '0')}-01` < from ? from : `${y}-${String(m).padStart(2, '0')}-01`
    const mTo = lastDay(y, m) > to ? to : lastDay(y, m)
    if (mFrom > to) break
    const mf = periodFigures(db, mFrom, mTo)
    const rate = rateOn(rates, homeStateOn(db, mTo), mTo)
    if (!rate && mf.taxable !== 0) missingRate = true
    if (rate) computed += scaleCents(mf.taxable, rate.rateMilli, 100000)
    months.push({ month: mFrom.slice(0, 7), taxableCents: mf.taxable, rateMilli: rate?.rateMilli ?? null })
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }

  const byChannel = db.prepare(
    `SELECT -SUM(l.amount_cents) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
     WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND a.tax_category = 'gross_receipts' AND e.source = ?`
  )
  const owedAt = sum(
    db,
    `SELECT -SUM(l.amount_cents) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
     WHERE e.status = 'posted' AND e.entry_date <= ? AND a.subtype = 'sales_tax'`,
    to
  )
  return {
    from,
    to,
    homeState,
    grossSalesCents: f.gross,
    marketplaceCents: f.marketplace,
    marketplaceByChannel: MARKETPLACES.map((ch) => ({
      channel: ch,
      cents: (byChannel.get(from, to, ch) as { c: number | null }).c ?? 0
    })).filter((x) => x.cents !== 0),
    resale: f.resale,
    resaleCents: f.resaleCents,
    otherExempt: f.otherExempt,
    otherExemptCents: f.otherExemptCents,
    refundsCents: f.refunds,
    taxableCents: f.taxable,
    computedTaxCents: computed,
    months,
    chargedCents: f.charged,
    paidCents: f.paid,
    owedAtEndCents: owedAt,
    missingRate
  }
}

/** Records paying sales tax to the state: Sales tax payable goes down, the bank goes down. */
export function recordSalesTaxPayment(db: Database.Database, input: SalesTaxPaymentInput, booksStart: string): number {
  if (!isValidDate(input.date)) throw new LedgerError('Enter the date you paid.')
  if (input.date < booksStart) throw new LedgerError(`Your books start on ${booksStart}.`)
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0)
    throw new LedgerError('Enter the amount paid.')
  const bank =
    input.bankAccountId === null
      ? undefined
      : (db.prepare('SELECT type, is_active FROM accounts WHERE id = ?').get(input.bankAccountId) as
          { type: string; is_active: number } | undefined)
  if (!bank || !bank.is_active || (bank.type !== 'asset' && bank.type !== 'liability'))
    throw new LedgerError('Choose the account you paid from.')
  const tax = db
    .prepare("SELECT id FROM accounts WHERE subtype = 'sales_tax' AND is_active = 1 ORDER BY number LIMIT 1")
    .get() as { id: number } | undefined
  if (!tax) throw new LedgerError('There is no active Sales tax payable account.')
  return postEntry(db, {
    date: input.date,
    memo: input.memo.trim() || 'Sales tax payment',
    source: SALES_TAX_PAYMENT,
    lines: [
      { accountId: tax.id, amountCents: input.amountCents, memo: '' },
      { accountId: input.bankAccountId!, amountCents: -input.amountCents, memo: '' }
    ]
  })
}
