import type Database from 'better-sqlite3'
import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import type {
  BankLine,
  ImportBatchSummary,
  MatchCandidate,
  ImportFile,
  PostBankLineInput,
  PostBankLinesResult,
  StageImportInput,
  StageImportResult
} from '../shared/bankImport'
import { MATCH_DAYS } from '../shared/bankImport'
import { applyMapping, layoutKey, numberedFingerprints, parseCsv, type ColumnMapping } from '../shared/csvImport'
import { LedgerError, postEntry } from './ledger'
import { ruleMatcher } from './rules'
import { clearEntryLines } from './reconcile'

/** Bank and card CSV imports: lines are staged in bank_lines, reviewed, then posted as entries (source 'import'). */

export const IMPORT_SOURCE = 'import'
const MAX_FILE_BYTES = 10 * 1024 * 1024

/** Reads a CSV file as text (UTF-8, or Windows-1252 if it isn't valid UTF-8). */
export function readImportFile(path: string): ImportFile {
  const st = statSync(path)
  if (!st.isFile()) throw new LedgerError('That is not a file.')
  if (st.size > MAX_FILE_BYTES)
    throw new LedgerError('That file is larger than 10 MB, which is too big for a bank download.')
  const buf = readFileSync(path)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    text = new TextDecoder('windows-1252').decode(buf)
  }
  return { fileName: basename(path), text }
}

function importableAccount(db: Database.Database, id: number): { id: number; name: string } {
  const a = db.prepare('SELECT id, name, type, is_active FROM accounts WHERE id = ?').get(id) as
    { id: number; name: string; type: string; is_active: number } | undefined
  if (!a) throw new LedgerError('That account no longer exists.')
  if (!a.is_active) throw new LedgerError(`"${a.name}" is inactive.`)
  if (a.type !== 'asset' && a.type !== 'liability')
    throw new LedgerError('Choose a bank, cash or card account to import into.')
  return a
}

/** The mapping used last time for this account and file layout, if any. */
export function savedMapping(
  db: Database.Database,
  accountId: number,
  text: string,
  hasHeader: boolean
): ColumnMapping | null {
  const row = db
    .prepare('SELECT mapping FROM import_profiles WHERE account_id = ? AND layout_key = ?')
    .get(accountId, layoutKey(parseCsv(text), hasHeader)) as { mapping: string } | undefined
  return row ? (JSON.parse(row.mapping) as ColumnMapping) : null
}

/** Reads the file with the mapping, skips duplicates and lines before the books start, and stages the rest for review. */
export function stageImport(
  db: Database.Database,
  booksStart: string,
  input: StageImportInput,
  now: Date = new Date()
): StageImportResult {
  importableAccount(db, input.accountId)
  const rows = parseCsv(input.text)
  const mapped = applyMapping(rows, input.mapping)
  if (mapped.lines.length === 0 && mapped.problems.length > 0) {
    throw new LedgerError(
      `None of the rows could be read (row ${mapped.problems[0].row}: ${mapped.problems[0].reason}). Check the column choices.`
    )
  }
  const fps = numberedFingerprints(mapped.lines)
  const exists = db.prepare('SELECT 1 FROM bank_lines WHERE account_id = ? AND fingerprint = ?')
  const stamp = now.toISOString()

  return db.transaction(() => {
    let duplicates = 0
    let early = 0
    const fresh: { line: (typeof mapped.lines)[number]; fp: string }[] = []
    mapped.lines.forEach((line, i) => {
      if (line.date < booksStart) early++
      else if (exists.get(input.accountId, fps[i])) duplicates++
      else fresh.push({ line, fp: fps[i] })
    })
    const batchId = Number(
      db
        .prepare(
          `INSERT INTO import_batches (account_id, file_name, imported_at, mapping, added_count, duplicate_count, problem_count, early_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.accountId,
          input.fileName,
          stamp,
          JSON.stringify(input.mapping),
          fresh.length,
          duplicates,
          mapped.problems.length,
          early
        ).lastInsertRowid
    )
    const insert = db.prepare(
      `INSERT INTO bank_lines (batch_id, account_id, txn_date, description, amount_cents, fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const { line, fp } of fresh)
      insert.run(batchId, input.accountId, line.date, line.description, line.amountCents, fp, stamp, stamp)
    db.prepare(
      `INSERT INTO import_profiles (account_id, layout_key, mapping, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (account_id, layout_key) DO UPDATE SET mapping = excluded.mapping, updated_at = excluded.updated_at`
    ).run(input.accountId, layoutKey(rows, input.mapping.hasHeader), JSON.stringify(input.mapping), stamp)
    return { batchId, added: fresh.length, duplicates, problems: mapped.problems, early }
  })()
}

const LINE_SELECT = `SELECT l.id, l.batch_id AS batchId, l.account_id AS accountId, l.txn_date AS date, l.description,
  l.amount_cents AS amountCents, l.status, l.entry_id AS entryId,
  CASE WHEN e.status = 'void' THEN 1 ELSE 0 END AS entryVoided
  FROM bank_lines l LEFT JOIN journal_entries e ON e.id = l.entry_id`

type LineRow = Omit<BankLine, 'entryVoided' | 'suggestion' | 'matches'> & { entryVoided: number }

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Posted entries that look like this imported line: a line on the same account for the same amount, dated within
 * MATCH_DAYS, and not already tied to another imported line of that account. Closest date first, at most three. */
export function matchCandidates(
  db: Database.Database,
  line: { id: number; accountId: number; amountCents: number; date: string }
): MatchCandidate[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.id AS entryId, e.entry_date AS date, e.memo, e.source
       FROM journal_entries e JOIN journal_lines jl ON jl.entry_id = e.id
       WHERE e.status = 'posted' AND jl.account_id = @acct AND jl.amount_cents = @amt
         AND e.entry_date BETWEEN @from AND @to
         AND NOT EXISTS (SELECT 1 FROM bank_lines b WHERE b.entry_id = e.id AND b.account_id = @acct
                         AND b.status IN ('posted', 'matched') AND b.id <> @line)
         AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = e.id AND r.status = 'posted')
         AND e.reverses_entry_id IS NULL
       ORDER BY abs(julianday(e.entry_date) - julianday(@date)), e.id
       LIMIT 3`
    )
    .all({
      acct: line.accountId,
      amt: line.amountCents,
      from: addDays(line.date, -MATCH_DAYS),
      to: addDays(line.date, MATCH_DAYS),
      date: line.date,
      line: line.id
    }) as Omit<MatchCandidate, 'otherSide'>[]
  const others = db.prepare(
    `SELECT DISTINCT a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? AND l.account_id <> ?`
  )
  return rows.map((r) => {
    const names = (others.all(r.entryId, line.accountId) as { name: string }[]).map((x) => x.name)
    return { ...r, otherSide: names.length === 1 ? names[0] : `Split (${names.length} accounts)` }
  })
}

/** Ties an imported line to an entry already in the books, instead of posting a second one. */
export function matchBankLine(db: Database.Database, lineId: number, entryId: number, now: Date = new Date()): void {
  db.transaction(() => {
    const l = lineForUpdate(db, lineId)
    if (!reviewable(l)) throw new LedgerError('This line was already dealt with.')
    if (!matchCandidates(db, l).some((c) => c.entryId === entryId)) {
      throw new LedgerError(
        `Entry #${entryId} doesn't match this line (same account and amount, within ${MATCH_DAYS} days).`
      )
    }
    db.prepare(`UPDATE bank_lines SET status = 'matched', entry_id = ?, updated_at = ? WHERE id = ?`).run(
      entryId,
      now.toISOString(),
      lineId
    )
    clearEntryLines(db, entryId, l.accountId, now)
  })()
}

/** Lines waiting for review: new ones, plus posted/matched ones whose entry was voided since. */
export function linesToReview(db: Database.Database, accountId?: number): BankLine[] {
  const rows = db
    .prepare(
      `${LINE_SELECT}
       WHERE (l.status = 'new' OR (l.status IN ('posted', 'matched') AND e.status = 'void'))
         AND (@acct IS NULL OR l.account_id = @acct)
       ORDER BY l.txn_date, l.id`
    )
    .all({ acct: accountId ?? null }) as LineRow[]
  const match = ruleMatcher(db)
  return rows.map((r) => {
    const rule = match(r)
    return {
      ...r,
      entryVoided: !!r.entryVoided,
      matches: matchCandidates(db, r),
      suggestion: rule
        ? { accountId: rule.accountId, payee: rule.payee, ruleId: rule.id, matchText: rule.matchText }
        : null
    }
  })
}

export function ignoredLines(db: Database.Database, accountId: number): BankLine[] {
  return (
    db
      .prepare(`${LINE_SELECT} WHERE l.status = 'ignored' AND l.account_id = ? ORDER BY l.txn_date, l.id`)
      .all(accountId) as LineRow[]
  ).map((r) => ({ ...r, entryVoided: !!r.entryVoided, matches: [], suggestion: null }))
}

/** How many lines wait for review, per account. */
export function reviewCounts(db: Database.Database): { accountId: number; count: number }[] {
  return db
    .prepare(
      `SELECT l.account_id AS accountId, COUNT(*) AS count FROM bank_lines l LEFT JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.status = 'new' OR (l.status IN ('posted', 'matched') AND e.status = 'void')
       GROUP BY l.account_id`
    )
    .all() as { accountId: number; count: number }[]
}

function lineForUpdate(db: Database.Database, id: number): LineRow {
  const row = db.prepare(`${LINE_SELECT} WHERE l.id = ?`).get(id) as LineRow | undefined
  if (!row) throw new LedgerError('That imported line no longer exists.')
  return row
}

function reviewable(row: LineRow): boolean {
  return row.status === 'new' || ((row.status === 'posted' || row.status === 'matched') && !!row.entryVoided)
}

/** Posts imported lines as entries: the imported account on one side, the chosen account on the other. */
export function postBankLines(
  db: Database.Database,
  booksStart: string,
  items: PostBankLineInput[],
  now: Date = new Date()
): PostBankLinesResult {
  const result: PostBankLinesResult = { posted: [], failed: [] }
  const setPosted = db.prepare(`UPDATE bank_lines SET status = 'posted', entry_id = ?, updated_at = ? WHERE id = ?`)
  for (const item of items) {
    try {
      const entryId = db.transaction(() => {
        const l = lineForUpdate(db, item.lineId)
        if (!reviewable(l)) throw new LedgerError('This line was already dealt with.')
        if (l.date < booksStart) throw new LedgerError(`It is dated before your books start (${booksStart}).`)
        if (item.accountId === l.accountId)
          throw new LedgerError('Choose a different account from the one it was imported into.')
        const id = postEntry(db, {
          date: l.date,
          memo: item.memo.trim() || l.description,
          source: IMPORT_SOURCE,
          lines: [
            { accountId: l.accountId, amountCents: l.amountCents, memo: l.description },
            { accountId: item.accountId, amountCents: -l.amountCents, memo: '' }
          ]
        })
        setPosted.run(id, now.toISOString(), l.id)
        clearEntryLines(db, id, l.accountId, now)
        return id
      })()
      result.posted.push({ lineId: item.lineId, entryId })
    } catch (err) {
      result.failed.push({ lineId: item.lineId, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}

/** Sets lines aside (e.g. already entered by hand, or not business). They stay on record and can be brought back. */
export function ignoreBankLines(db: Database.Database, ids: number[], now: Date = new Date()): void {
  db.transaction(() => {
    for (const id of ids) {
      const l = lineForUpdate(db, id)
      if (!reviewable(l)) throw new LedgerError('A line was already dealt with.')
      db.prepare(`UPDATE bank_lines SET status = 'ignored', updated_at = ? WHERE id = ?`).run(now.toISOString(), id)
    }
  })()
}

export function restoreBankLine(db: Database.Database, id: number, now: Date = new Date()): void {
  const l = lineForUpdate(db, id)
  if (l.status !== 'ignored') throw new LedgerError('Only an ignored line can be brought back.')
  db.prepare(`UPDATE bank_lines SET status = 'new', entry_id = NULL, updated_at = ? WHERE id = ?`).run(
    now.toISOString(),
    id
  )
}

export function importHistory(db: Database.Database): ImportBatchSummary[] {
  return db
    .prepare(
      `SELECT b.id, b.account_id AS accountId, a.name AS accountName, b.file_name AS fileName, b.imported_at AS importedAt,
         b.added_count AS added, b.duplicate_count AS duplicates,
         (SELECT COUNT(*) FROM bank_lines l WHERE l.batch_id = b.id AND l.status = 'new') AS waiting
       FROM import_batches b JOIN accounts a ON a.id = b.account_id ORDER BY b.id DESC`
    )
    .all() as ImportBatchSummary[]
}
