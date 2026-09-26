import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'fs'
import { basename, join } from 'path'
import { validateNewCompany, type CompanyProfile, type CompanySummary, type NewCompanyInput } from '../shared/company'
import { localDateString } from '../shared/dates'
import type { EntityTypeId } from '../shared/entities'
import { getSchemaVersion, LATEST_SCHEMA_VERSION, runMigrations } from './db/migrations'

/**
 * Company folders on disk: <companiesDir>\<folder>\books.sqlite plus
 * backups\, receipts\ and exports\. Nothing here imports Electron, so it can
 * be tested directly against a temporary folder.
 */

export const DB_FILE = 'books.sqlite'
export const BACKUPS_TO_KEEP = 30
const SUBFOLDERS = ['backups', 'receipts', 'exports']

/** Turns a company name into a safe Windows folder name. */
export function folderNameFor(name: string): string {
  let folder = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/, '')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(folder)) folder += ' company'
  return folder
}

function assertPlainFolderName(folder: string): void {
  if (!folder || folder !== basename(folder) || folder === '.' || folder === '..') {
    throw new Error('Invalid company folder name.')
  }
}

/** Creates a new company folder and database. Returns the folder name. */
export function createCompany(companiesDir: string, input: NewCompanyInput, now: Date = new Date()): string {
  const problem = validateNewCompany(input)
  if (problem) throw new Error(problem)

  const folder = folderNameFor(input.name)
  const dir = join(companiesDir, folder)
  if (existsSync(dir)) throw new Error(`A company named "${folder}" already exists.`)

  mkdirSync(companiesDir, { recursive: true })
  mkdirSync(dir)
  try {
    for (const sub of SUBFOLDERS) mkdirSync(join(dir, sub))
    const db = new Database(join(dir, DB_FILE))
    try {
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = ON')
      runMigrations(db)
      const createdAt = now.toISOString()
      db.transaction(() => {
        db.prepare('INSERT INTO company_profile (id, name, books_start_date, created_at) VALUES (1, ?, ?, ?)').run(
          input.name.trim(),
          input.booksStartDate,
          createdAt
        )
        db.prepare('INSERT INTO entity_type_history (entity_type, effective_date, created_at) VALUES (?, ?, ?)').run(
          input.entityType,
          input.booksStartDate,
          createdAt
        )
        db.prepare('INSERT INTO home_state_history (state_code, effective_date, created_at) VALUES (?, ?, ?)').run(
          input.homeState,
          input.booksStartDate,
          createdAt
        )
      })()
      db.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
      db.close()
    }
  } catch (err) {
    // Only removes the folder this call just created.
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
  return folder
}

/** The value in force on `date`; if the history starts later, its earliest value. */
function valueAsOf(db: Database.Database, table: string, column: string, date: string): string {
  const row =
    (db
      .prepare(`SELECT ${column} AS v FROM ${table} WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1`)
      .get(date) as { v: string } | undefined) ??
    (db.prepare(`SELECT ${column} AS v FROM ${table} ORDER BY effective_date ASC LIMIT 1`).get() as
      | { v: string }
      | undefined)
  if (!row) throw new Error(`Company file is missing ${table} data.`)
  return row.v
}

function readProfile(db: Database.Database, dir: string, folder: string, today: string): CompanyProfile {
  const p = db.prepare('SELECT name, books_start_date FROM company_profile WHERE id = 1').get() as
    | { name: string; books_start_date: string }
    | undefined
  if (!p) throw new Error(`"${folder}" is missing its company profile.`)
  return {
    folder,
    dir,
    name: p.name,
    booksStartDate: p.books_start_date,
    entityType: valueAsOf(db, 'entity_type_history', 'entity_type', today) as EntityTypeId,
    homeState: valueAsOf(db, 'home_state_history', 'state_code', today),
    schemaVersion: getSchemaVersion(db)
  }
}

/** Every valid company under companiesDir, sorted by name. Folders that
 * aren't JunoBooks companies (e.g. the old Phase 0 smoke-test file) are skipped. */
export function listCompanies(companiesDir: string, now: Date = new Date()): CompanySummary[] {
  if (!existsSync(companiesDir)) return []
  const today = localDateString(now)
  const result: CompanySummary[] = []
  for (const entry of readdirSync(companiesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(companiesDir, entry.name)
    const dbPath = join(dir, DB_FILE)
    if (!existsSync(dbPath)) continue
    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true })
      if (getSchemaVersion(db) === 0) continue
      const { folder, name, entityType, homeState } = readProfile(db, dir, entry.name, today)
      result.push({ folder, name, entityType, homeState })
    } catch {
      // Unreadable or unrecognized file: leave it out of the list.
    } finally {
      db?.close()
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** Copies the database into backups\ and keeps only the newest BACKUPS_TO_KEEP. */
export function backupCompany(dir: string, db: Database.Database, label?: string, now: Date = new Date()): string {
  db.pragma('wal_checkpoint(TRUNCATE)')
  const backupsDir = join(dir, 'backups')
  mkdirSync(backupsDir, { recursive: true })
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const backupPath = join(backupsDir, `books-${stamp}${label ? `-${label}` : ''}.sqlite`)
  copyFileSync(join(dir, DB_FILE), backupPath)
  pruneBackups(backupsDir)
  return backupPath
}

/** Backup names start with an ISO timestamp, so sorting by name is sorting by age. */
export function pruneBackups(backupsDir: string): void {
  const files = readdirSync(backupsDir)
    .filter((f) => f.startsWith('books-') && f.endsWith('.sqlite'))
    .sort()
    .reverse()
  for (const name of files.slice(BACKUPS_TO_KEEP)) unlinkSync(join(backupsDir, name))
}

/** An open company. Close it to write the on-close backup. */
export class CompanyBooks {
  constructor(
    readonly folder: string,
    readonly dir: string,
    readonly db: Database.Database
  ) {}

  profile(now: Date = new Date()): CompanyProfile {
    return readProfile(this.db, this.dir, this.folder, localDateString(now))
  }

  close(): void {
    backupCompany(this.dir, this.db)
    this.db.close()
  }
}

/** Opens a company, backing it up and upgrading it first if its schema is older. */
export function openCompany(companiesDir: string, folder: string): CompanyBooks {
  assertPlainFolderName(folder)
  const dir = join(companiesDir, folder)
  const dbPath = join(dir, DB_FILE)
  if (!existsSync(dbPath)) throw new Error(`No books file found for "${folder}".`)

  const db = new Database(dbPath, { fileMustExist: true })
  try {
    const version = getSchemaVersion(db)
    if (version === 0) throw new Error(`"${folder}" isn't a JunoBooks company file.`)
    if (version > LATEST_SCHEMA_VERSION) {
      throw new Error(`"${folder}" was saved by a newer version of JunoBooks. Update the app to open it.`)
    }
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    if (version < LATEST_SCHEMA_VERSION) {
      backupCompany(dir, db, `before-upgrade-v${version}-to-v${LATEST_SCHEMA_VERSION}`)
      runMigrations(db)
    }
    const books = new CompanyBooks(folder, dir, db)
    books.profile() // fail now, not later, if the file is incomplete
    return books
  } catch (err) {
    db.close()
    throw err
  }
}
