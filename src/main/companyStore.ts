import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'fs'
import { basename, join } from 'path'
import {
  validateNewCompany,
  type CompanyHistory,
  type CompanyProfile,
  type CompanySummary,
  type EntityChangeInput,
  type EntityChangeResult,
  type HomeStateChangeInput,
  type NewCompanyInput
} from '../shared/company'
import { localDateString } from '../shared/dates'
import type { ChartView } from '../shared/chart'
import type { EntityTypeId } from '../shared/entities'
import { isTemplateId, type TemplateId } from '../shared/templates'
import type { AccountInput } from '../shared/accounts'
import type { EntryListItem, ManualEntryInput } from '../shared/journal'
import { listEntries } from './entries'
import { accountRegister } from './register'
import { addRule, deleteRule, listRules, updateRule } from './rules'
import type { CategorizationRule, RuleInput } from '../shared/rules'
import {
  ignoreBankLines,
  ignoredLines,
  importHistory,
  linesToReview,
  matchBankLine,
  postBankLines,
  restoreBankLine,
  reviewCounts,
  savedMapping,
  stageImport
} from './bankImport'
import type {
  BankLine,
  ImportBatchSummary,
  PostBankLineInput,
  PostBankLinesResult,
  StageImportInput,
  StageImportResult
} from '../shared/bankImport'
import type { ColumnMapping } from '../shared/csvImport'
import { addAttachments, attachmentFile, listAttachments, removeAttachment } from './attachments'
import type { Attachment, AttachResult } from '../shared/attachments'
import { getOpeningBalances, saveOpeningBalances } from './openingBalances'
import type { OpeningBalanceInput, OpeningBalancesView } from '../shared/opening'
import type { RegisterQuery, RegisterView } from '../shared/register'
import { LedgerError, postEntry, reverseEntry, voidEntry } from './ledger'
import { addAccount, deleteAccount, setAccountActive, updateAccount, type ChartContext } from './accounts'
import { accountCount, applyChart, getChart, restoreAccounts } from './chart'
import {
  addEntityTypeChange,
  addHomeStateChange,
  correctStartingEntityType,
  correctStartingHomeState,
  getHistory,
  removeEntityTypeChange,
  removeHomeStateChange
} from './companyHistory'
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
        applyChart(db, input.template as TemplateId, input.entityType as EntityTypeId, now)
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
  // SELECT * so older (not yet upgraded) files can still be listed.
  const p = db.prepare('SELECT * FROM company_profile WHERE id = 1').get() as
    | { name: string; books_start_date: string; template?: TemplateId | null }
    | undefined
  if (!p) throw new Error(`"${folder}" is missing its company profile.`)
  return {
    folder,
    dir,
    name: p.name,
    booksStartDate: p.books_start_date,
    template: p.template ?? null,
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

  chart(now: Date = new Date()): ChartView {
    return getChart(this.db, this.profile(now).entityType, localDateString(now))
  }

  /** One-time setup for a company created before templates existed. */
  setupChart(template: string, now: Date = new Date()): CompanyProfile {
    if (!isTemplateId(template)) throw new Error('Choose a starting chart of accounts.')
    if (accountCount(this.db) > 0) throw new Error('This company already has a chart of accounts.')
    applyChart(this.db, template, this.profile(now).entityType, now)
    return this.profile(now)
  }

  history(): CompanyHistory {
    return getHistory(this.db)
  }

  changeEntityType(input: EntityChangeInput, now: Date = new Date()): EntityChangeResult {
    return { ...addEntityTypeChange(this.db, input, now), profile: this.profile(now) }
  }

  correctStartingEntityType(entityType: string, now: Date = new Date()): EntityChangeResult {
    return { ...correctStartingEntityType(this.db, entityType, now), profile: this.profile(now) }
  }

  removeEntityTypeChange(effectiveDate: string, now: Date = new Date()): CompanyProfile {
    removeEntityTypeChange(this.db, effectiveDate)
    return this.profile(now)
  }

  changeHomeState(input: HomeStateChangeInput, now: Date = new Date()): CompanyProfile {
    addHomeStateChange(this.db, input, now)
    return this.profile(now)
  }

  correctStartingHomeState(stateCode: string, now: Date = new Date()): CompanyProfile {
    correctStartingHomeState(this.db, stateCode)
    return this.profile(now)
  }

  removeHomeStateChange(effectiveDate: string, now: Date = new Date()): CompanyProfile {
    removeHomeStateChange(this.db, effectiveDate)
    return this.profile(now)
  }

  /** Adds back standard accounts (by template number) that the chart is missing. */
  restoreAccounts(wantedNumbers: string[], now: Date = new Date()): ChartView {
    const p = this.profile(now)
    if (p.template) restoreAccounts(this.db, p.template, p.entityType, wantedNumbers, now)
    return this.chart(now)
  }

  private chartContext(now: Date): ChartContext {
    const p = this.profile(now)
    return { template: p.template, entity: p.entityType }
  }

  addAccount(input: AccountInput, now: Date = new Date()): ChartView {
    addAccount(this.db, input, this.chartContext(now), now)
    return this.chart(now)
  }

  updateAccount(id: number, input: AccountInput, now: Date = new Date()): ChartView {
    updateAccount(this.db, id, input, this.chartContext(now), now)
    return this.chart(now)
  }

  setAccountActive(id: number, active: boolean, now: Date = new Date()): ChartView {
    setAccountActive(this.db, id, active, now)
    return this.chart(now)
  }

  deleteAccount(id: number, now: Date = new Date()): ChartView {
    deleteAccount(this.db, id)
    return this.chart(now)
  }

  /** Posts an entry typed on the journal entry screen. Returns its id. */
  postManualEntry(input: ManualEntryInput, now: Date = new Date()): number {
    const start = this.profile(now).booksStartDate
    if (input.date < start) throw new LedgerError(`Your books start on ${start}, so an entry can't be dated earlier.`)
    return postEntry(this.db, { date: input.date, memo: input.memo, source: 'manual', lines: input.lines })
  }

  entries(): EntryListItem[] {
    return listEntries(this.db)
  }

  openingBalances(now: Date = new Date()): OpeningBalancesView {
    return getOpeningBalances(this.db, this.profile(now).booksStartDate)
  }

  saveOpeningBalances(input: OpeningBalanceInput[], now: Date = new Date()): number | null {
    return saveOpeningBalances(this.db, this.profile(now).booksStartDate, input)
  }

  attachments(entryId: number): Attachment[] {
    return listAttachments(this.db, entryId)
  }

  attach(entryId: number, paths: string[], now: Date = new Date()): AttachResult {
    return addAttachments(this.db, this.dir, entryId, paths, now)
  }

  attachmentFile(id: number): string {
    return attachmentFile(this.db, this.dir, id)
  }

  removeAttachment(id: number, reason = '', now: Date = new Date()): void {
    removeAttachment(this.db, this.dir, id, reason, now)
  }

  savedMapping(accountId: number, text: string, hasHeader: boolean): ColumnMapping | null {
    return savedMapping(this.db, accountId, text, hasHeader)
  }

  stageImport(input: StageImportInput, now: Date = new Date()): StageImportResult {
    return stageImport(this.db, this.profile(now).booksStartDate, input, now)
  }

  linesToReview(accountId?: number): BankLine[] {
    return linesToReview(this.db, accountId)
  }

  ignoredLines(accountId: number): BankLine[] {
    return ignoredLines(this.db, accountId)
  }

  reviewCounts(): { accountId: number; count: number }[] {
    return reviewCounts(this.db)
  }

  postBankLines(items: PostBankLineInput[], now: Date = new Date()): PostBankLinesResult {
    return postBankLines(this.db, this.profile(now).booksStartDate, items, now)
  }

  matchBankLine(lineId: number, entryId: number, now: Date = new Date()): void {
    matchBankLine(this.db, lineId, entryId, now)
  }

  ignoreBankLines(ids: number[], now: Date = new Date()): void {
    ignoreBankLines(this.db, ids, now)
  }

  restoreBankLine(id: number, now: Date = new Date()): void {
    restoreBankLine(this.db, id, now)
  }

  importHistory(): ImportBatchSummary[] {
    return importHistory(this.db)
  }

  rules(): CategorizationRule[] {
    return listRules(this.db)
  }

  addRule(input: RuleInput, now: Date = new Date()): CategorizationRule[] {
    addRule(this.db, input, now)
    return listRules(this.db)
  }

  updateRule(id: number, input: RuleInput & { isActive: boolean }, now: Date = new Date()): CategorizationRule[] {
    updateRule(this.db, id, input, now)
    return listRules(this.db)
  }

  deleteRule(id: number): CategorizationRule[] {
    deleteRule(this.db, id)
    return listRules(this.db)
  }

  register(q: RegisterQuery): RegisterView {
    return accountRegister(this.db, q)
  }

  voidEntry(id: number, reason: string): EntryListItem[] {
    voidEntry(this.db, id, reason)
    return this.entries()
  }

  reverseEntry(id: number, date: string, memo?: string): EntryListItem[] {
    reverseEntry(this.db, id, date, memo)
    return this.entries()
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
