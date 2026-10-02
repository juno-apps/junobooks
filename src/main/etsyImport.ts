import type Database from 'better-sqlite3'
import {
  ALL_ETSY_TARGETS,
  ETSY_ACCOUNTS,
  ETSY_DEFAULT_NUMBERS,
  ETSY_TARGET_LABELS,
  etsyFingerprints,
  parseEtsyOrders,
  parseEtsyStatement,
  planEtsy,
  rowPostings,
  type EtsyOrder,
  type EtsyRow,
  type EtsyTarget
} from '../shared/etsy'
import type {
  EtsyAccountStatus,
  EtsyFilesInput,
  EtsyImportInput,
  EtsyImportResult,
  EtsyMapping,
  EtsyPayout,
  EtsyPreview
} from '../shared/etsyImport'
import { MATCH_DAYS } from '../shared/bankImport'
import { addAccount, type ChartContext } from './accounts'
import { LedgerError, postEntry } from './ledger'

/** Etsy statement imports: rows are recorded in marketplace_rows (so re-imports skip them) and posted as one entry
 * per day through the Etsy payment account, plus a transfer per deposit. */

export const CHANNEL = 'etsy'

function findByName(db: Database.Database, name: string): { id: number; isActive: number } | undefined {
  return db.prepare('SELECT id, is_active AS isActive FROM accounts WHERE lower(name) = lower(?)').get(name) as
    { id: number; isActive: number } | undefined
}

export function etsyAccounts(db: Database.Database): EtsyAccountStatus[] {
  return ETSY_ACCOUNTS.map((s) => ({ number: s.number, name: s.name, accountId: findByName(db, s.name)?.id ?? null }))
}

/** Adds the Etsy accounts the chart doesn't have yet (by name), each with its accountant note. */
export function addEtsyAccounts(db: Database.Database, ctx: ChartContext, now: Date = new Date()): void {
  const taken = db.prepare('SELECT 1 FROM accounts WHERE number = ?')
  db.transaction(() => {
    for (const s of ETSY_ACCOUNTS) {
      if (findByName(db, s.name)) continue
      let n = Number(s.number)
      const end = Math.floor(n / 100) * 100 + 100
      while (n < end && taken.get(String(n))) n++
      if (n >= end)
        throw new LedgerError(
          `There is no free account number near ${s.number} for "${s.name}". Add it yourself on the chart of accounts.`
        )
      const id = addAccount(
        db,
        {
          number: String(n),
          name: s.name,
          type: s.type,
          subtype: '',
          taxCategory: s.taxCategory as never,
          description: 'Added for Etsy imports.'
        },
        ctx,
        now
      )
      if (s.note) db.prepare('UPDATE accounts SET accountant_note = ? WHERE id = ?').run(s.note, id)
    }
  })()
}

/** Saved account choices, filled in with defaults (Etsy accounts by name, standard accounts by number). */
export function etsyMapping(db: Database.Database): EtsyMapping {
  const saved = new Map(
    (
      db
        .prepare(
          `SELECT m.target, m.account_id AS accountId FROM channel_mappings m JOIN accounts a ON a.id = m.account_id
           WHERE m.channel = ? AND a.is_active = 1`
        )
        .all(CHANNEL) as { target: EtsyTarget; accountId: number }[]
    ).map((r) => [r.target, r.accountId])
  )
  const byNumber = db.prepare('SELECT id FROM accounts WHERE number = ? AND is_active = 1')
  const out: EtsyMapping = {}
  for (const t of ALL_ETSY_TARGETS) {
    if (saved.has(t)) {
      out[t] = saved.get(t)!
      continue
    }
    const spec = ETSY_ACCOUNTS.find((s) => s.targets.includes(t))
    const byName = spec ? findByName(db, spec.name) : undefined
    const num = ETSY_DEFAULT_NUMBERS[t]
    out[t] = byName?.isActive ? byName.id : num ? ((byNumber.get(num) as { id: number } | undefined)?.id ?? null) : null
  }
  return out
}

function savedDepositAccount(db: Database.Database): number | null {
  const r = db
    .prepare(
      `SELECT m.account_id AS id FROM channel_mappings m JOIN accounts a ON a.id = m.account_id
       WHERE m.channel = ? AND m.target = 'deposit' AND a.is_active = 1`
    )
    .get(CHANNEL) as { id: number } | undefined
  if (r) return r.id
  const checking = db
    .prepare("SELECT id FROM accounts WHERE subtype = 'bank' AND is_active = 1 ORDER BY number LIMIT 1")
    .get() as { id: number } | undefined
  return checking?.id ?? null
}

interface Parsed {
  rows: EtsyRow[]
  fps: string[]
  fresh: EtsyRow[]
  freshFps: string[]
  already: number
  early: number
  problems: { row: number; reason: string }[]
  orders: Map<string, EtsyOrder>
  orderList: EtsyOrder[]
}

function readFiles(db: Database.Database, booksStart: string, input: EtsyFilesInput): Parsed {
  let st: ReturnType<typeof parseEtsyStatement>
  let ord: ReturnType<typeof parseEtsyOrders> = { orders: [], problems: [] }
  try {
    st = parseEtsyStatement(input.statementText)
    if (input.ordersText) ord = parseEtsyOrders(input.ordersText)
  } catch (err) {
    throw new LedgerError(err instanceof Error ? err.message : String(err))
  }
  const fps = etsyFingerprints(st.rows)
  const seen = db.prepare('SELECT 1 FROM marketplace_rows WHERE channel = ? AND fingerprint = ?')
  const fresh: EtsyRow[] = []
  const freshFps: string[] = []
  let already = 0
  let early = 0
  st.rows.forEach((r, i) => {
    if (seen.get(CHANNEL, fps[i])) already++
    else if (r.date < booksStart) early++
    else {
      fresh.push(r)
      freshFps.push(fps[i])
    }
  })
  // Orders already stored from earlier imports help split sales in later statements.
  const stored = db
    .prepare(
      `SELECT order_id AS orderId, sale_date AS saleDate, items_cents AS itemsCents, shipping_cents AS shippingCents,
         discount_cents AS discountCents, sales_tax_cents AS salesTaxCents, total_cents AS totalCents,
         ship_state AS shipState, ship_country AS shipCountry
       FROM marketplace_orders WHERE channel = ?`
    )
    .all(CHANNEL) as EtsyOrder[]
  const orders = new Map(stored.map((o) => [o.orderId, o]))
  for (const o of ord.orders) orders.set(o.orderId, o)
  return {
    rows: st.rows,
    fps,
    fresh,
    freshFps,
    already,
    early,
    problems: [...st.problems, ...ord.problems.map((p) => ({ row: p.row, reason: `orders file: ${p.reason}` }))],
    orders,
    orderList: ord.orders
  }
}

export function previewEtsy(db: Database.Database, booksStart: string, input: EtsyFilesInput): EtsyPreview {
  const p = readFiles(db, booksStart, input)
  const totals = new Map<EtsyTarget, { cents: number; rows: number }>()
  for (const r of p.fresh) {
    for (const x of rowPostings(r, p.orders)) {
      const t = totals.get(x.target) ?? { cents: 0, rows: 0 }
      t.cents += x.cents
      t.rows++
      totals.set(x.target, t)
    }
  }
  const kinds = new Map<string, number>()
  for (const r of p.fresh) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1)
  const plan = planEtsy(p.fresh, p.orders)
  const sales = p.fresh.filter((r) => r.kind === 'sale')
  return {
    rows: p.rows.length,
    newRows: p.fresh.length,
    alreadyImported: p.already,
    beforeBooksStart: p.early,
    problems: p.problems,
    ordersRead: p.orderList.length,
    salesWithOrder: sales.filter((r) => r.orderId && p.orders.has(r.orderId)).length,
    sales: sales.length,
    totals: ALL_ETSY_TARGETS.filter((t) => totals.has(t)).map((t) => ({ target: t, ...totals.get(t)! })),
    unknown: p.fresh
      .filter((r) => r.kind === 'unknown')
      .slice(0, 10)
      .map((r) => ({ type: r.type, title: r.title, cents: r.amountCents + r.feesCents })),
    kinds: [...kinds].map(([kind, rows]) => ({ kind: kind as EtsyRow['kind'], rows })),
    days: plan.days.length,
    deposits: plan.deposits.map((d) => ({ date: d.date, cents: d.cents })),
    mapping: etsyMapping(db),
    depositAccountId: savedDepositAccount(db)
  }
}

function activeAccount(db: Database.Database, id: number | null | undefined, what: string): number {
  if (!id) throw new LedgerError(`Choose an account for ${what}.`)
  const a = db.prepare('SELECT name, is_active FROM accounts WHERE id = ?').get(id) as
    { name: string; is_active: number } | undefined
  if (!a) throw new LedgerError(`The account for ${what} no longer exists.`)
  if (!a.is_active) throw new LedgerError(`The account for ${what} ("${a.name}") is inactive.`)
  return id
}

/** Posts the new rows: one entry per day, one transfer per deposit, all or nothing. */
export function importEtsy(
  db: Database.Database,
  booksStart: string,
  input: EtsyImportInput,
  now: Date = new Date()
): EtsyImportResult {
  const p = readFiles(db, booksStart, input)
  const plan = planEtsy(p.fresh, p.orders)
  const used = new Set<EtsyTarget>(plan.days.flatMap((d) => d.lines.map((l) => l.target)))
  if (plan.deposits.length) used.add('clearing')
  const accountFor = new Map<EtsyTarget, number>()
  for (const t of used) accountFor.set(t, activeAccount(db, input.mapping[t], `"${ETSY_TARGET_LABELS[t]}"`))
  const clearing = accountFor.get('clearing')
  for (const [t, id] of accountFor) {
    if (t !== 'clearing' && id === clearing) {
      throw new LedgerError(
        `"${ETSY_TARGET_LABELS[t]}" can't use the Etsy payment account itself. Choose another account.`
      )
    }
  }
  const depositAccount = plan.deposits.length ? activeAccount(db, input.depositAccountId, 'Etsy deposits') : null
  if (depositAccount !== null && depositAccount === clearing)
    throw new LedgerError('Deposits must go to your bank account, not the Etsy payment account.')
  if (p.fresh.length === 0) throw new LedgerError('Everything in this statement was already imported.')

  const stamp = now.toISOString()
  return db.transaction(() => {
    const batchId = Number(
      db
        .prepare(
          `INSERT INTO import_batches (account_id, file_name, imported_at, mapping, added_count, duplicate_count, problem_count, early_count, channel)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          clearing ?? depositAccount,
          input.fileName,
          stamp,
          JSON.stringify({ mapping: input.mapping, depositAccountId: input.depositAccountId }),
          p.fresh.length,
          p.already,
          p.problems.length,
          p.early,
          CHANNEL
        ).lastInsertRowid
    )
    const saveMap = db.prepare(
      `INSERT INTO channel_mappings (channel, target, account_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (channel, target) DO UPDATE SET account_id = excluded.account_id, updated_at = excluded.updated_at`
    )
    for (const t of ALL_ETSY_TARGETS) {
      const id = input.mapping[t]
      if (id) saveMap.run(CHANNEL, t, id, stamp)
    }
    if (depositAccount) saveMap.run(CHANNEL, 'deposit', depositAccount, stamp)
    const saveOrder = db.prepare(
      `INSERT INTO marketplace_orders (channel, order_id, sale_date, items_cents, shipping_cents, discount_cents, sales_tax_cents,
         total_cents, ship_state, ship_country, updated_at)
       VALUES (@channel, @orderId, @saleDate, @itemsCents, @shippingCents, @discountCents, @salesTaxCents, @totalCents, @shipState, @shipCountry, @stamp)
       ON CONFLICT (channel, order_id) DO UPDATE SET sale_date = excluded.sale_date, items_cents = excluded.items_cents,
         shipping_cents = excluded.shipping_cents, discount_cents = excluded.discount_cents, sales_tax_cents = excluded.sales_tax_cents,
         total_cents = excluded.total_cents, ship_state = excluded.ship_state, ship_country = excluded.ship_country, updated_at = excluded.updated_at`
    )
    for (const o of p.orderList) saveOrder.run({ ...o, channel: CHANNEL, stamp })

    const entryForRow = new Map<number, number>()
    for (const day of plan.days) {
      const id = postEntry(db, {
        date: day.date,
        memo: day.memo,
        source: CHANNEL,
        lines: day.lines.map((l) => ({
          accountId: accountFor.get(l.target)!,
          amountCents: l.cents,
          memo: ETSY_TARGET_LABELS[l.target]
        }))
      })
      for (const r of day.rows) entryForRow.set(r, id)
    }
    for (const d of plan.deposits) {
      const id = postEntry(db, {
        date: d.date,
        memo: 'Etsy deposit to bank',
        source: CHANNEL,
        lines: [
          { accountId: depositAccount!, amountCents: d.cents, memo: d.title },
          { accountId: clearing!, amountCents: -d.cents, memo: '' }
        ]
      })
      entryForRow.set(d.row, id)
    }
    const rec = db.prepare(
      `INSERT INTO marketplace_rows (channel, batch_id, fingerprint, row_date, kind, cents, gross_cents, entry_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    p.fresh.forEach((r, i) => {
      const cents = r.kind === 'deposit' ? r.depositCents : r.amountCents + r.feesCents
      // Gross for the 1099-K: what buyers paid (sales with shipping, and sales tax), before fees and refunds.
      const gross = (r.kind === 'sale' || r.kind === 'sales_tax') && r.amountCents > 0 ? r.amountCents : 0
      rec.run(CHANNEL, batchId, p.freshFps[i], r.date, r.kind, cents, gross, entryForRow.get(r.row) ?? null, stamp)
    })
    return {
      entries: plan.days.length,
      deposits: plan.deposits.length,
      rowsImported: p.fresh.length,
      alreadyImported: p.already,
      beforeBooksStart: p.early
    }
  })()
}

/** Every Etsy deposit and whether the bank side has been found in an imported bank file. */
export function etsyPayouts(db: Database.Database, channel: string = CHANNEL): EtsyPayout[] {
  const rows = db
    .prepare(
      `SELECT m.row_date AS date, m.cents, m.entry_id AS entryId, a.id AS accountId, a.name AS depositAccountName
       FROM marketplace_rows m
       JOIN journal_entries e ON e.id = m.entry_id AND e.status = 'posted'
       JOIN journal_lines l ON l.entry_id = e.id AND l.amount_cents > 0
       JOIN accounts a ON a.id = l.account_id
       WHERE m.channel = ? AND m.kind = 'deposit'
       ORDER BY m.row_date DESC, m.id DESC`
    )
    .all(channel) as { date: string; cents: number; entryId: number; accountId: number; depositAccountName: string }[]
  const tied = db.prepare(
    `SELECT txn_date AS d FROM bank_lines WHERE entry_id = ? AND status IN ('matched', 'posted') LIMIT 1`
  )
  const waiting = db.prepare(
    `SELECT txn_date AS d FROM bank_lines WHERE status = 'new' AND account_id = ? AND amount_cents = ?
       AND abs(julianday(txn_date) - julianday(?)) <= ? ORDER BY abs(julianday(txn_date) - julianday(?)) LIMIT 1`
  )
  return rows.map((r) => {
    const t = tied.get(r.entryId) as { d: string } | undefined
    if (t)
      return {
        date: r.date,
        cents: r.cents,
        entryId: r.entryId,
        depositAccountName: r.depositAccountName,
        status: 'matched',
        bankLineDate: t.d
      }
    const w = waiting.get(r.accountId, r.cents, r.date, MATCH_DAYS, r.date) as { d: string } | undefined
    return {
      date: r.date,
      cents: r.cents,
      entryId: r.entryId,
      depositAccountName: r.depositAccountName,
      status: w ? 'waiting' : 'missing',
      bankLineDate: w?.d ?? null
    }
  })
}
