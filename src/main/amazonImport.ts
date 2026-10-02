import type Database from 'better-sqlite3'
import {
  ALL_AMAZON_TARGETS,
  AMAZON_ACCOUNTS,
  AMAZON_DEFAULT_NUMBERS,
  AMAZON_TARGET_LABELS,
  amazonFingerprints,
  amazonGross,
  parseAmazonSettlement,
  planAmazon,
  type AmazonRow,
  type AmazonSettlement,
  type AmazonTarget
} from '../shared/amazon'
import type { AmazonImportInput, AmazonImportResult, AmazonMapping, AmazonPreview } from '../shared/amazonImport'
import type { ChannelAccountSpec } from '../shared/etsy'
import type { EtsyAccountStatus } from '../shared/etsyImport'
import { addAccount, parentFor, type ChartContext } from './accounts'
import { LedgerError, postEntry } from './ledger'

/** Amazon settlement imports: same approach as Etsy (marketplace_rows for re-imports, one entry per day through a
 * payment account, the payout as a transfer), channel 'amazon'. */

export const AMAZON = 'amazon'
const DEPOSIT_FP = (id: string): string => `payout|${id}`

function findByName(db: Database.Database, name: string): { id: number; isActive: number } | undefined {
  return db.prepare('SELECT id, is_active AS isActive FROM accounts WHERE lower(name) = lower(?)').get(name) as
    { id: number; isActive: number } | undefined
}

export function channelAccounts(db: Database.Database, specs: ChannelAccountSpec[]): EtsyAccountStatus[] {
  return specs.map((s) => ({ number: s.number, name: s.name, accountId: findByName(db, s.name)?.id ?? null }))
}

/** Adds the channel's accounts the chart doesn't have yet (by name), with their accountant notes. */
export function addChannelAccounts(
  db: Database.Database,
  ctx: ChartContext,
  specs: ChannelAccountSpec[],
  description: string,
  now: Date = new Date()
): void {
  const taken = db.prepare('SELECT 1 FROM accounts WHERE number = ?')
  db.transaction(() => {
    for (const s of specs) {
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
          description,
          parentId: parentFor(db, s.parentNumber, s.type)
        },
        ctx,
        now
      )
      if (s.note) db.prepare('UPDATE accounts SET accountant_note = ? WHERE id = ?').run(s.note, id)
    }
  })()
}

export function amazonMapping(db: Database.Database): AmazonMapping {
  const saved = new Map(
    (
      db
        .prepare(
          `SELECT m.target, m.account_id AS accountId FROM channel_mappings m JOIN accounts a ON a.id = m.account_id
           WHERE m.channel = ? AND a.is_active = 1`
        )
        .all(AMAZON) as { target: AmazonTarget; accountId: number }[]
    ).map((r) => [r.target, r.accountId])
  )
  const byNumber = db.prepare('SELECT id FROM accounts WHERE number = ? AND is_active = 1')
  const out: AmazonMapping = {}
  for (const t of ALL_AMAZON_TARGETS) {
    if (saved.has(t)) {
      out[t] = saved.get(t)!
      continue
    }
    const spec = AMAZON_ACCOUNTS.find((s) => (s.targets as string[]).includes(t))
    const byName = spec ? findByName(db, spec.name) : undefined
    const num = AMAZON_DEFAULT_NUMBERS[t]
    out[t] = byName?.isActive ? byName.id : num ? ((byNumber.get(num) as { id: number } | undefined)?.id ?? null) : null
  }
  return out
}

function depositAccount(db: Database.Database): number | null {
  const r = db
    .prepare(
      `SELECT m.account_id AS id FROM channel_mappings m JOIN accounts a ON a.id = m.account_id
       WHERE m.channel = ? AND m.target = 'deposit' AND a.is_active = 1`
    )
    .get(AMAZON) as { id: number } | undefined
  if (r) return r.id
  const bank = db
    .prepare("SELECT id FROM accounts WHERE subtype = 'bank' AND is_active = 1 ORDER BY number LIMIT 1")
    .get() as { id: number } | undefined
  return bank?.id ?? null
}

interface Read {
  s: AmazonSettlement
  fresh: AmazonRow[]
  freshFps: string[]
  already: number
  early: number
  depositDone: boolean
}

function read(db: Database.Database, booksStart: string, text: string): Read {
  let s: AmazonSettlement
  try {
    s = parseAmazonSettlement(text)
  } catch (err) {
    throw new LedgerError(err instanceof Error ? err.message : String(err))
  }
  const fps = amazonFingerprints(s.rows)
  const seen = db.prepare('SELECT 1 FROM marketplace_rows WHERE channel = ? AND fingerprint = ?')
  const fresh: AmazonRow[] = []
  const freshFps: string[] = []
  let already = 0
  let early = 0
  s.rows.forEach((r, i) => {
    if (seen.get(AMAZON, fps[i])) already++
    else if (r.date < booksStart) early++
    else {
      fresh.push(r)
      freshFps.push(fps[i])
    }
  })
  return { s, fresh, freshFps, already, early, depositDone: !!seen.get(AMAZON, DEPOSIT_FP(s.settlementId)) }
}

export function previewAmazon(db: Database.Database, booksStart: string, text: string): AmazonPreview {
  const p = read(db, booksStart, text)
  const totals = new Map<AmazonTarget, { cents: number; rows: number }>()
  for (const r of p.fresh) {
    if (r.kind === 'reserve') continue
    const t = totals.get(r.kind) ?? { cents: 0, rows: 0 }
    t.cents -= r.amountCents
    t.rows++
    totals.set(r.kind, t)
  }
  const plan = planAmazon(p.s, p.fresh)
  const clearing = plan.days
    .flatMap((d) => d.lines)
    .filter((l) => l.target === 'clearing')
    .reduce((s, l) => s + l.cents, 0)
  if (clearing) totals.set('clearing', { cents: clearing, rows: 0 })
  const deposit = plan.deposit && !p.depositDone && plan.deposit.date >= booksStart ? plan.deposit : null
  return {
    settlementId: p.s.settlementId,
    startDate: p.s.startDate,
    endDate: p.s.endDate,
    rows: p.s.rows.length,
    newRows: p.fresh.length,
    alreadyImported: p.already,
    beforeBooksStart: p.early,
    problems: p.s.problems,
    totals: ALL_AMAZON_TARGETS.filter((t) => totals.has(t)).map((t) => ({ target: t, ...totals.get(t)! })),
    unknown: p.fresh
      .filter((r) => r.kind === 'unknown')
      .slice(0, 10)
      .map((r) => ({
        transactionType: r.transactionType,
        amountType: r.amountType,
        description: r.description,
        cents: r.amountCents
      })),
    reserveCents: p.fresh.filter((r) => r.kind === 'reserve').reduce((s, r) => s + r.amountCents, 0),
    days: plan.days.length,
    deposit,
    depositAlreadyImported: p.depositDone,
    negativeTotalCents: p.s.totalCents < 0 ? p.s.totalCents : 0,
    mapping: amazonMapping(db),
    depositAccountId: depositAccount(db)
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

export function importAmazon(
  db: Database.Database,
  booksStart: string,
  input: AmazonImportInput,
  now: Date = new Date()
): AmazonImportResult {
  const p = read(db, booksStart, input.text)
  const plan = planAmazon(p.s, p.fresh)
  const deposit = plan.deposit && !p.depositDone && plan.deposit.date >= booksStart ? plan.deposit : null
  if (p.fresh.length === 0 && !deposit) throw new LedgerError('Everything in this settlement was already imported.')
  const used = new Set<AmazonTarget>(plan.days.flatMap((d) => d.lines.map((l) => l.target)))
  if (deposit) used.add('clearing')
  if (p.fresh.some((r) => r.kind === 'reserve')) used.add('clearing')
  const accountFor = new Map<AmazonTarget, number>()
  for (const t of used) accountFor.set(t, activeAccount(db, input.mapping[t], `"${AMAZON_TARGET_LABELS[t]}"`))
  const clearing = accountFor.get('clearing')
  for (const [t, id] of accountFor) {
    if (t !== 'clearing' && id === clearing) {
      throw new LedgerError(
        `"${AMAZON_TARGET_LABELS[t]}" can't use the Amazon payment account itself. Choose another account.`
      )
    }
  }
  const depositTo = deposit ? activeAccount(db, input.depositAccountId, 'the Amazon payout') : null
  if (depositTo !== null && depositTo === clearing)
    throw new LedgerError('The payout must go to your bank account, not the Amazon payment account.')

  const stamp = now.toISOString()
  return db.transaction(() => {
    const batchId = Number(
      db
        .prepare(
          `INSERT INTO import_batches (account_id, file_name, imported_at, mapping, added_count, duplicate_count, problem_count, early_count, channel)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          clearing ?? depositTo,
          input.fileName,
          stamp,
          JSON.stringify({
            settlementId: p.s.settlementId,
            mapping: input.mapping,
            depositAccountId: input.depositAccountId
          }),
          p.fresh.length,
          p.already,
          p.s.problems.length,
          p.early,
          AMAZON
        ).lastInsertRowid
    )
    const saveMap = db.prepare(
      `INSERT INTO channel_mappings (channel, target, account_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (channel, target) DO UPDATE SET account_id = excluded.account_id, updated_at = excluded.updated_at`
    )
    for (const t of ALL_AMAZON_TARGETS) if (input.mapping[t]) saveMap.run(AMAZON, t, input.mapping[t], stamp)
    if (depositTo) saveMap.run(AMAZON, 'deposit', depositTo, stamp)

    const entryForRow = new Map<number, number>()
    for (const day of plan.days) {
      const id = postEntry(db, {
        date: day.date,
        memo: `${day.memo} (settlement ${p.s.settlementId})`,
        source: AMAZON,
        lines: day.lines.map((l) => ({
          accountId: accountFor.get(l.target)!,
          amountCents: l.cents,
          memo: AMAZON_TARGET_LABELS[l.target]
        }))
      })
      for (const r of day.rows) entryForRow.set(r, id)
    }
    const rec = db.prepare(
      `INSERT INTO marketplace_rows (channel, batch_id, fingerprint, row_date, kind, cents, gross_cents, entry_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    p.fresh.forEach((r, i) =>
      rec.run(
        AMAZON,
        batchId,
        p.freshFps[i],
        r.date,
        r.kind,
        r.amountCents,
        amazonGross(r),
        entryForRow.get(r.row) ?? null,
        stamp
      )
    )
    if (deposit) {
      const id = postEntry(db, {
        date: deposit.date,
        memo: `Amazon payout to bank (settlement ${p.s.settlementId})`,
        source: AMAZON,
        lines: [
          { accountId: depositTo!, amountCents: deposit.cents, memo: '' },
          { accountId: clearing!, amountCents: -deposit.cents, memo: '' }
        ]
      })
      rec.run(AMAZON, batchId, DEPOSIT_FP(p.s.settlementId), deposit.date, 'deposit', deposit.cents, 0, id, stamp)
    }
    return {
      entries: plan.days.length,
      deposits: deposit ? 1 : 0,
      rowsImported: p.fresh.length,
      alreadyImported: p.already,
      beforeBooksStart: p.early
    }
  })()
}
