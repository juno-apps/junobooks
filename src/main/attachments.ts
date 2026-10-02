import type Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'fs'
import { basename, extname, join } from 'path'
import {
  MAX_RECEIPT_BYTES,
  RECEIPT_EXTENSIONS,
  receiptFileName,
  type Attachment,
  type AttachResult
} from '../shared/attachments'
import { LedgerError } from './ledger'

/** Receipt files live under <company>\receipts\<year>\ and are recorded in the attachments table.
 * Removing one keeps its record (marked removed) and moves the file to receipts\_removed\. */

const SELECT = `SELECT id, entry_id AS entryId, stored_path AS storedPath, original_name AS originalName,
  size_bytes AS sizeBytes, added_at AS addedAt FROM attachments`

export function listAttachments(db: Database.Database, entryId: number): Attachment[] {
  return db.prepare(`${SELECT} WHERE entry_id = ? AND removed_at IS NULL ORDER BY id`).all(entryId) as Attachment[]
}

function getAttachment(db: Database.Database, id: number): Attachment & { removed: boolean } {
  const row = db.prepare(`${SELECT.replace(' FROM', ', removed_at AS removedAt FROM')} WHERE id = ?`).get(id) as
    (Attachment & { removedAt: string | null }) | undefined
  if (!row) throw new LedgerError('That receipt no longer exists.')
  return { ...row, removed: row.removedAt !== null }
}

/** Full path of a receipt file, refusing anything that would leave the company folder. */
export function attachmentFile(db: Database.Database, companyDir: string, id: number): string {
  const a = getAttachment(db, id)
  if (a.removed) throw new LedgerError('That receipt was removed.')
  const full = join(companyDir, a.storedPath)
  if (!full.startsWith(join(companyDir, 'receipts')))
    throw new LedgerError('That receipt is stored somewhere unexpected.')
  if (!existsSync(full)) throw new LedgerError(`The file for this receipt is missing from ${a.storedPath}.`)
  return full
}

function uniqueName(dir: string, name: string): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = name
  for (let n = 2; existsSync(join(dir, candidate)); n++) candidate = `${stem}-${n}${ext}`
  return candidate
}

/** Copies files into receipts\<year>\ and attaches them to an entry. Files that can't be used are skipped with a reason. */
export function addAttachments(
  db: Database.Database,
  companyDir: string,
  entryId: number,
  sourcePaths: string[],
  now: Date = new Date()
): AttachResult {
  const entry = db
    .prepare(
      `SELECT e.id, e.entry_date AS date, e.memo,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM journal_lines WHERE entry_id = e.id AND amount_cents > 0) AS amount
       FROM journal_entries e WHERE e.id = ?`
    )
    .get(entryId) as { id: number; date: string; memo: string; amount: number } | undefined
  if (!entry) throw new LedgerError('That entry no longer exists.')

  const year = entry.date.slice(0, 4)
  const dir = join(companyDir, 'receipts', year)
  mkdirSync(dir, { recursive: true })
  const existing = new Set(
    (
      db.prepare('SELECT sha256 FROM attachments WHERE entry_id = ? AND removed_at IS NULL').all(entryId) as {
        sha256: string
      }[]
    ).map((r) => r.sha256)
  )
  const insert = db.prepare(
    `INSERT INTO attachments (entry_id, stored_path, original_name, size_bytes, sha256, added_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  const result: AttachResult = { added: [], skipped: [] }
  const copied: string[] = []
  try {
    db.transaction(() => {
      for (const src of sourcePaths) {
        const name = basename(src)
        const ext = extname(name).slice(1).toLowerCase()
        let size: number
        try {
          const st = statSync(src)
          if (!st.isFile()) throw new Error()
          size = st.size
        } catch {
          result.skipped.push({ name, reason: "couldn't be read (is it a file?)" })
          continue
        }
        if (!RECEIPT_EXTENSIONS.includes(ext)) {
          result.skipped.push({ name, reason: `.${ext || '(none)'} files aren't accepted as receipts` })
          continue
        }
        if (size > MAX_RECEIPT_BYTES) {
          result.skipped.push({ name, reason: 'is larger than 50 MB' })
          continue
        }
        const sha = createHash('sha256').update(readFileSync(src)).digest('hex')
        if (existing.has(sha)) {
          result.skipped.push({ name, reason: 'is already attached to this entry' })
          continue
        }
        const stored = uniqueName(dir, receiptFileName(entry.date, entry.memo, entry.amount, ext, entry.id))
        copyFileSync(src, join(dir, stored))
        copied.push(join(dir, stored))
        const storedPath = `receipts/${year}/${stored}`
        const id = Number(insert.run(entryId, storedPath, name, size, sha, now.toISOString()).lastInsertRowid)
        existing.add(sha)
        result.added.push({ id, entryId, storedPath, originalName: name, sizeBytes: size, addedAt: now.toISOString() })
      }
    })()
  } catch (err) {
    // Only the copies this call just made are removed.
    for (const f of copied) {
      try {
        unlinkSync(f)
      } catch {
        // leave it; a stray copy is harmless
      }
    }
    throw err
  }
  return result
}

/** Takes a receipt off its entry. The record stays (marked removed) and the file moves to receipts\_removed\. */
export function removeAttachment(
  db: Database.Database,
  companyDir: string,
  id: number,
  reason = '',
  now: Date = new Date()
): void {
  const a = getAttachment(db, id)
  if (a.removed) return
  const removedDir = join(companyDir, 'receipts', '_removed')
  mkdirSync(removedDir, { recursive: true })
  const from = join(companyDir, a.storedPath)
  const name = uniqueName(removedDir, basename(a.storedPath))
  const moved = existsSync(from)
  if (moved) renameSync(from, join(removedDir, name))
  try {
    db.prepare('UPDATE attachments SET removed_at = ?, remove_reason = ?, stored_path = ? WHERE id = ?').run(
      now.toISOString(),
      reason.trim(),
      moved ? `receipts/_removed/${name}` : a.storedPath,
      id
    )
  } catch (err) {
    if (moved) renameSync(join(removedDir, name), from)
    throw err
  }
}
