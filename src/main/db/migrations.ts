import type Database from 'better-sqlite3'

/**
 * Schema migrations for a company's books.sqlite. The file's schema version
 * lives in SQLite's built-in `user_version` (0 = not a JunoBooks company).
 *
 * Rules: never edit a migration that has shipped — add a new one. Each
 * migration runs in its own transaction, so a failure leaves the file at the
 * previous version. Callers take a backup before migrating an existing file.
 */
export interface Migration {
  version: number
  description: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Company profile, entity type history, home state history',
    sql: `
      CREATE TABLE company_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL,
        books_start_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE entity_type_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL CHECK (entity_type IN
          ('sole_prop', 'smllc', 'mmllc', 'llc_s_corp', 's_corp', 'c_corp', 'partnership')),
        effective_date TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE home_state_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_code TEXT NOT NULL CHECK (length(state_code) = 2),
        effective_date TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
    `
  }
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

export function getSchemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

/** Applies every migration newer than the file's current version. */
export function runMigrations(db: Database.Database): void {
  const current = getSchemaVersion(db)
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
    })()
  }
}
