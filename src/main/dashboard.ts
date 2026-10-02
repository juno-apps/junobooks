import type Database from 'better-sqlite3'
import { localDateString } from '../shared/dates'
import type { Dashboard } from '../shared/dashboard'
import { formatCents } from '../shared/money'
import { getLockedThrough } from './ledger'
import { profitAndLoss } from './reports'

/** The company home summary: this year so far, money on hand, owed both ways, and things to do. */

function balances(
  db: Database.Database,
  where: string,
  asOf: string
): { id: number; name: string; cents: number; normal: string }[] {
  return db
    .prepare(
      `SELECT a.id, a.name, a.normal_balance AS normal, COALESCE(SUM(CASE WHEN e.status = 'posted' AND e.entry_date <= ? THEN l.amount_cents END), 0) AS raw
       FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id LEFT JOIN journal_entries e ON e.id = l.entry_id
       WHERE a.is_active = 1 AND (${where}) GROUP BY a.id ORDER BY a.number`
    )
    .all(asOf)
    .map((r) => {
      const x = r as { id: number; name: string; normal: string; raw: number }
      return { id: x.id, name: x.name, normal: x.normal, cents: x.normal === 'credit' ? 0 - x.raw : x.raw }
    })
}

const lastDayOfPrevMonth = (today: string): string => {
  const [y, m] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)
}

export function dashboard(db: Database.Database, booksStart: string, today = localDateString()): Dashboard {
  const year = Number(today.slice(0, 4))
  const from = `${year}-01-01` < booksStart ? booksStart : `${year}-01-01`
  const pl = from <= today ? profitAndLoss(db, from, today) : null
  const t = pl ? pl.columns.length - 1 : 0
  const cash = balances(db, "a.tax_category = 'cash'", today).filter((a) => a.cents !== 0)
  const owedToYou = [
    ...balances(db, "a.tax_category = 'accounts_receivable'", today),
    ...balances(db, "a.name IN ('Etsy payment account', 'Amazon payment account')", today)
  ].filter((a) => a.cents !== 0)
  const youOwe = balances(
    db,
    "a.type = 'liability' AND (a.subtype IN ('credit_card', 'sales_tax', 'payroll') OR a.tax_category IN ('accounts_payable', 'long_term_loans', 'short_term_loans'))",
    today
  ).filter((a) => a.cents !== 0)

  const todo: Dashboard['todo'] = []
  const waiting = (db.prepare("SELECT COUNT(*) AS n FROM bank_lines WHERE status = 'new'").get() as { n: number }).n
  if (waiting) todo.push({ action: 'review', text: `Review ${waiting} imported bank line${waiting === 1 ? '' : 's'}` })
  const overdue = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(open), 0) AS c FROM (
         SELECT i.total_cents - COALESCE((SELECT SUM(a.amount_cents) FROM payment_applications a JOIN payments p ON p.id = a.payment_id
                                          WHERE a.invoice_id = i.id AND p.status = 'posted'), 0) AS open
         FROM invoices i WHERE i.status = 'open' AND i.due_date < ?) WHERE open > 0`
    )
    .get(today) as { n: number; c: number }
  if (overdue.n)
    todo.push({
      action: 'invoices',
      text: `${overdue.n} invoice${overdue.n === 1 ? ' is' : 's are'} overdue (${formatCents(overdue.c)})`
    })
  const drafts = (db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE status = 'draft'").get() as { n: number }).n
  if (drafts) todo.push({ action: 'invoices', text: `${drafts} draft invoice${drafts === 1 ? '' : 's'} not finalized` })
  const monthEnd = lastDayOfPrevMonth(today)
  for (const a of db
    .prepare(
      `SELECT a.name, (SELECT MAX(r.statement_date) FROM reconciliations r WHERE r.account_id = a.id AND r.status = 'finished') AS last
       FROM accounts a WHERE a.is_active = 1 AND a.subtype IN ('bank', 'credit_card') AND EXISTS (
         SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = a.id AND e.status = 'posted')`
    )
    .all() as { name: string; last: string | null }[]) {
    if (!a.last || a.last < lastDayOfPrevMonth(monthEnd)) {
      todo.push({
        action: 'reconcile',
        text: `Reconcile ${a.name} (${a.last ? `last done through ${a.last}` : 'never reconciled'})`
      })
    }
  }
  const salesTax = youOwe.filter((a) =>
    db.prepare("SELECT 1 FROM accounts WHERE id = ? AND subtype = 'sales_tax'").get(a.id)
  )
  for (const a of salesTax)
    if (a.cents > 0)
      todo.push({ action: 'salesTax', text: `${formatCents(a.cents)} of sales tax collected is waiting to be paid` })
  const locked = getLockedThrough(db)
  if (monthEnd >= booksStart && (!locked || locked < monthEnd)) {
    todo.push({
      action: 'close',
      text: `Books are open ${locked ? `after ${locked}` : 'for every month'}; close them through ${monthEnd} once that month is checked`
    })
  }
  const lastYear = year - 1
  if (`${lastYear}-12-31` >= booksStart) {
    const closed = db
      .prepare("SELECT 1 FROM journal_entries WHERE source = 'closing' AND status = 'posted' AND entry_date = ?")
      .get(`${lastYear}-12-31`)
    if (!closed)
      todo.push({
        action: 'package',
        text: `${lastYear} isn't closed yet: build the accountant package, then close the year`
      })
  }

  return {
    year,
    from,
    to: today,
    salesCents: pl ? pl.income.total[t] : 0,
    expensesCents: pl ? pl.cogs.total[t] + pl.expenses.total[t] : 0,
    netIncomeCents: pl ? pl.netIncome[t] : 0,
    cash: cash.map((a) => ({ name: a.name, cents: a.cents })),
    cashTotalCents: cash.reduce((s, a) => s + a.cents, 0),
    owedToYou: owedToYou.map((a) => ({ name: a.name, cents: a.cents })),
    owedToYouTotalCents: owedToYou.reduce((s, a) => s + a.cents, 0),
    youOwe: youOwe.map((a) => ({ name: a.name, cents: a.cents })),
    youOweTotalCents: youOwe.reduce((s, a) => s + a.cents, 0),
    todo
  }
}
