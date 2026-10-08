import type Database from 'better-sqlite3'
import { isValidDate } from '../shared/dates'
import type {
  BalanceSheet,
  GeneralLedger,
  ProfitAndLoss,
  ReportRow,
  ReportSection,
  TrialBalance
} from '../shared/reports'
import type { AccountType } from '../shared/taxLines'
import { LedgerError } from './ledger'
import { accountRegister } from './register'

/** Financial reports, all computed from posted entries (voided ones never count). */

interface Acct {
  id: number
  number: string
  name: string
  type: AccountType
  subtype: string
  normalBalance: 'debit' | 'credit'
  parentId: number | null
  isActive: number
}

function accounts(db: Database.Database): Acct[] {
  return db
    .prepare(
      `SELECT id, number, name, type, subtype, normal_balance AS normalBalance, parent_id AS parentId, is_active AS isActive
       FROM accounts ORDER BY number`
    )
    .all() as Acct[]
}

/** Debit-minus-credit per account for posted entries dated within [from, to] (from null = since the start). */
/** `skipClosing`: 'all' leaves year-end closing entries out (profit & loss); 'onEnd' leaves out only those dated on `to`
 * (a trial balance at year end before closing); 'none' keeps them (balance sheet). */
function sums(
  db: Database.Database,
  from: string | null,
  to: string,
  skipClosing: 'all' | 'onEnd' | 'none' = 'none'
): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT l.account_id AS id, SUM(l.amount_cents) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.status = 'posted' AND e.entry_date <= @to AND (@from IS NULL OR e.entry_date >= @from)
         AND NOT (e.source = 'closing' AND (@skip = 'all' OR (@skip = 'onEnd' AND e.entry_date = @to)))
       GROUP BY l.account_id`
    )
    .all({ from, to, skip: skipClosing }) as { id: number; c: number }[]
  return new Map(rows.map((r) => [r.id, r.c]))
}

function checkPeriod(from: string, to: string): void {
  if (!isValidDate(from) || !isValidDate(to)) throw new LedgerError('Choose the dates.')
  if (from > to) throw new LedgerError('The period starts after it ends.')
}

const lastDay = (y: number, m: number): string => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

/** Month ranges inside [from, to]. */
function monthsIn(from: string, to: string): { label: string; from: string; to: string }[] {
  const out: { label: string; from: string; to: string }[] = []
  let [y, m] = from.split('-').map(Number)
  for (;;) {
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    if (start > to) break
    const end = lastDay(y, m)
    out.push({ label: start.slice(0, 7), from: start < from ? from : start, to: end > to ? to : end })
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/** Orders rows so sub-accounts sit right under their parent (one depth step per level), each group by number.
 * A parent with sub-accounts is followed, after everything under it, by "Total <parent>": its own amount plus all
 * of its sub-accounts at every level. Totals are not counted again in the section total. */
export function nest(rows: ReportRow[]): ReportRow[] {
  const ids = new Set(rows.map((r) => r.accountId))
  const out: ReportRow[] = []
  const done = new Set<number>()
  /** Adds the row and everything under it; returns their combined values. */
  const visit = (r: ReportRow, depth: number): number[] => {
    done.add(r.accountId)
    out.push({ ...r, depth })
    const sum = [...r.values]
    const children = rows.filter((c) => c.parentId === r.accountId && !done.has(c.accountId))
    for (const c of children) visit(c, depth + 1).forEach((v, i) => (sum[i] += v))
    if (children.length > 0) out.push({ ...r, name: `Total ${r.name}`, values: sum, depth, subtotal: true })
    return sum
  }
  for (const r of rows) if (r.parentId === null || !ids.has(r.parentId)) visit(r, 0)
  return out
}

function section(
  title: string,
  list: Acct[],
  columns: Map<number, number>[],
  sign: (a: Acct) => number
): ReportSection {
  const rows: ReportRow[] = list.map((a) => ({
    accountId: a.id,
    number: a.number,
    name: a.name,
    values: columns.map((col) => (col.get(a.id) ?? 0) * sign(a)),
    depth: 0,
    parentId: a.parentId
  }))
  // Show accounts with something, plus every account above them, so sub-accounts stay grouped.
  const byId = new Map(rows.map((r) => [r.accountId, r]))
  const keep = new Set<number>()
  for (const r of rows) {
    if (!r.values.some((v) => v !== 0)) continue
    for (let cur: ReportRow | undefined = r; cur && !keep.has(cur.accountId); cur = byId.get(cur.parentId ?? -1)) {
      keep.add(cur.accountId)
    }
  }
  const shown = rows.filter((r) => keep.has(r.accountId))
  const total = columns.map((_, i) => shown.reduce((s, r) => s + r.values[i], 0))
  return { title, rows: nest(shown), total }
}

export function profitAndLoss(db: Database.Database, from: string, to: string, byMonth = false): ProfitAndLoss {
  checkPeriod(from, to)
  const all = accounts(db)
  const months = byMonth ? monthsIn(from, to) : []
  const cols = [...months.map((m) => sums(db, m.from, m.to, 'all')), sums(db, from, to, 'all')]
  const columns = [...months.map((m) => m.label), 'Total']
  const credit = (): number => -1
  const debit = (): number => 1
  const income = section(
    'Income',
    all.filter((a) => a.type === 'income'),
    cols,
    credit
  )
  const cogs = section(
    'Cost of goods sold',
    all.filter((a) => a.type === 'expense' && a.subtype === 'cogs'),
    cols,
    debit
  )
  const expenses = section(
    'Expenses',
    all.filter((a) => a.type === 'expense' && a.subtype !== 'cogs'),
    cols,
    debit
  )
  const grossProfit = cols.map((_, i) => income.total[i] - cogs.total[i])
  return {
    from,
    to,
    columns,
    income,
    cogs,
    grossProfit,
    expenses,
    netIncome: cols.map((_, i) => grossProfit[i] - expenses.total[i])
  }
}

export function balanceSheet(db: Database.Database, asOf: string): BalanceSheet {
  if (!isValidDate(asOf)) throw new LedgerError('Choose the date.')
  const all = accounts(db)
  const col = [sums(db, null, asOf)]
  const assets = section(
    'Assets',
    all.filter((a) => a.type === 'asset'),
    col,
    () => 1
  )
  const liabilities = section(
    'Liabilities',
    all.filter((a) => a.type === 'liability'),
    col,
    () => -1
  )
  const equity = section(
    'Equity',
    all.filter((a) => a.type === 'equity'),
    col,
    () => -1
  )
  const yearStart = `${asOf.slice(0, 4)}-01-01`
  const profitUpTo = (m: Map<number, number>): number =>
    0 - all.filter((a) => a.type === 'income' || a.type === 'expense').reduce((s, a) => s + (m.get(a.id) ?? 0), 0)
  const total = profitUpTo(col[0])
  const current = profitUpTo(sums(db, yearStart, asOf))
  const totalLE = liabilities.total[0] + equity.total[0] + total
  return {
    asOf,
    assets,
    liabilities,
    equity,
    currentYearProfit: current,
    priorYearsProfit: total - current,
    totalLiabilitiesAndEquity: totalLE,
    balanced: totalLE === assets.total[0]
  }
}

export function trialBalance(db: Database.Database, asOf: string): TrialBalance {
  if (!isValidDate(asOf)) throw new LedgerError('Choose the date.')
  const m = sums(db, null, asOf, 'onEnd')
  const rows = accounts(db)
    .map((a) => {
      const c = m.get(a.id) ?? 0
      return {
        accountId: a.id,
        number: a.number,
        name: a.name,
        type: a.type,
        debit: c > 0 ? c : 0,
        credit: c < 0 ? -c : 0
      }
    })
    .filter((r) => r.debit || r.credit)
  return {
    asOf,
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0)
  }
}

/** Every account with activity in the period (or a balance at its start), with each line and a running balance on the
 * account's normal side. */
export function generalLedger(db: Database.Database, from: string, to: string): GeneralLedger {
  checkPeriod(from, to)
  const before = sums(db, null, from > '0001-01-01' ? prevDay(from) : from)
  const during = db
    .prepare(
      `SELECT DISTINCT l.account_id AS id FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ?`
    )
    .all(from, to) as { id: number }[]
  const active = new Set([...during.map((r) => r.id), ...[...before].filter(([, c]) => c !== 0).map(([id]) => id)])
  const out: GeneralLedger = { from, to, accounts: [] }
  for (const a of accounts(db)) {
    if (!active.has(a.id)) continue
    const reg = accountRegister(db, { accountId: a.id, from, to })
    const sign = a.normalBalance === 'debit' ? 1 : -1
    out.accounts.push({
      accountId: a.id,
      number: a.number,
      name: a.name,
      normalBalance: a.normalBalance,
      opening: reg.openingCents,
      closing: reg.closingCents,
      lines: reg.rows.map((r) => {
        const raw = (r.increaseCents - r.decreaseCents) * sign
        return {
          date: r.date,
          entryId: r.entryId,
          memo: [r.memo, r.lineMemo].filter(Boolean).join(' · '),
          otherSide: r.otherSide,
          debit: raw > 0 ? raw : 0,
          credit: raw < 0 ? -raw : 0,
          balance: r.balanceCents
        }
      })
    })
  }
  return out
}

function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
