import Database from 'better-sqlite3'
import { mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getSampleCompanyDir } from './paths'

export interface SmokeTestRow {
  id: number
  created_at: string
  note: string
}

export interface TestCompanyStatus {
  companyDir: string
  dbPath: string
  rows: SmokeTestRow[]
}

const BACKUPS_TO_KEEP = 30

let db: Database.Database | null = null
let dbPath: string | null = null
let companyDir: string | null = null

/** Opens (creating if needed) the sample company's database and writes one
 * smoke-test record the first time it runs. Safe to call once at startup. */
export function openTestCompany(): void {
  companyDir = getSampleCompanyDir()
  mkdirSync(companyDir, { recursive: true })
  mkdirSync(join(companyDir, 'backups'), { recursive: true })

  dbPath = join(companyDir, 'books.sqlite')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS smoke_test (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      note TEXT NOT NULL
    )
  `)

  const count = (db.prepare('SELECT COUNT(*) AS n FROM smoke_test').get() as { n: number }).n
  if (count === 0) {
    db.prepare('INSERT INTO smoke_test (created_at, note) VALUES (?, ?)').run(
      new Date().toISOString(),
      'JunoBooks database smoke test — write/read works.'
    )
  }
}

export function getTestCompanyStatus(): TestCompanyStatus {
  if (!db || !dbPath || !companyDir) {
    throw new Error('Test company database is not open')
  }
  const rows = db.prepare('SELECT id, created_at, note FROM smoke_test ORDER BY id').all() as SmokeTestRow[]
  return { companyDir, dbPath, rows }
}

/** Closes the database and copies a timestamped backup, keeping only the
 * most recent BACKUPS_TO_KEEP files. Call this before the app quits. */
export function closeTestCompany(): void {
  if (!db || !dbPath || !companyDir) return

  // Checkpoint the WAL back into the main file so the backup copy is complete.
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()

  const backupsDir = join(companyDir, 'backups')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(backupsDir, `books-${stamp}.sqlite`)
  copyFileSync(dbPath, backupPath)

  pruneOldBackups(backupsDir)

  db = null
  dbPath = null
  companyDir = null
}

function pruneOldBackups(backupsDir: string): void {
  const files = readdirSync(backupsDir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((f) => ({ name: f, mtime: statSync(join(backupsDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  for (const file of files.slice(BACKUPS_TO_KEEP)) {
    unlinkSync(join(backupsDir, file.name))
  }
}
