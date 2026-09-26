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

/** Audit triggers as they were written for v2. Frozen with that migration —
 * a later migration that needs different triggers gets its own helper. */
function auditTriggersV2(table: string, columns: string[]): string {
  const json = (row: string): string => `json_object(${columns.map((c) => `'${c}', ${row}.${c}`).join(', ')})`
  const now = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  return `
    CREATE TRIGGER audit_${table}_insert AFTER INSERT ON ${table} BEGIN
      INSERT INTO audit_log (at, action, table_name, record_id, new_values)
      VALUES (${now}, 'insert', '${table}', NEW.id, ${json('NEW')});
    END;
    CREATE TRIGGER audit_${table}_update AFTER UPDATE ON ${table} BEGIN
      INSERT INTO audit_log (at, action, table_name, record_id, old_values, new_values)
      VALUES (${now}, 'update', '${table}', NEW.id, ${json('OLD')}, ${json('NEW')});
    END;
    CREATE TRIGGER audit_${table}_delete AFTER DELETE ON ${table} BEGIN
      INSERT INTO audit_log (at, action, table_name, record_id, old_values)
      VALUES (${now}, 'delete', '${table}', OLD.id, ${json('OLD')});
    END;
    INSERT INTO audit_log (at, action, table_name, record_id, new_values)
      SELECT ${now}, 'baseline', '${table}', r.id, ${json('r')} FROM ${table} AS r;
  `
}

const V2_AUDITED: Record<string, string[]> = {
  company_profile: ['id', 'name', 'books_start_date', 'created_at'],
  entity_type_history: ['id', 'entity_type', 'effective_date', 'created_at'],
  home_state_history: ['id', 'state_code', 'effective_date', 'created_at'],
  accounts: ['id', 'number', 'name', 'type', 'parent_id', 'description', 'is_active', 'created_at', 'updated_at'],
  journal_entries: [
    'id', 'entry_date', 'memo', 'status', 'source', 'reverses_entry_id',
    'created_at', 'posted_at', 'voided_at', 'void_reason'
  ],
  journal_lines: ['id', 'entry_id', 'line_no', 'account_id', 'amount_cents', 'memo']
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
  },
  {
    version: 2,
    description: 'Accounts, journal entries and lines with balance/immutability rules, audit log',
    sql: `
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'baseline')),
        table_name TEXT NOT NULL,
        record_id INTEGER,
        old_values TEXT,
        new_values TEXT
      ) STRICT;
      CREATE INDEX audit_log_record ON audit_log (table_name, record_id);

      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN
        SELECT RAISE(ABORT, 'The audit log can''t be changed.');
      END;
      CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN
        SELECT RAISE(ABORT, 'The audit log can''t be changed.');
      END;

      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
        parent_id INTEGER REFERENCES accounts (id),
        description TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      -- Amounts are signed integer cents: positive = debit, negative = credit.
      CREATE TABLE journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date TEXT NOT NULL CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        memo TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
        source TEXT NOT NULL DEFAULT 'manual',
        reverses_entry_id INTEGER REFERENCES journal_entries (id),
        created_at TEXT NOT NULL,
        posted_at TEXT,
        voided_at TEXT,
        void_reason TEXT,
        CHECK (status = 'draft' OR posted_at IS NOT NULL),
        CHECK ((status = 'void') = (voided_at IS NOT NULL)),
        CHECK (status <> 'void' OR (void_reason IS NOT NULL AND trim(void_reason) <> ''))
      ) STRICT;
      CREATE INDEX journal_entries_date ON journal_entries (entry_date);

      CREATE TABLE journal_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL REFERENCES journal_entries (id) ON DELETE CASCADE,
        line_no INTEGER NOT NULL,
        account_id INTEGER NOT NULL REFERENCES accounts (id),
        amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
        memo TEXT NOT NULL DEFAULT '',
        UNIQUE (entry_id, line_no)
      ) STRICT;
      CREATE INDEX journal_lines_account ON journal_lines (account_id);

      -- Entries are built as drafts, then posted in one step.
      CREATE TRIGGER je_insert_draft_only BEFORE INSERT ON journal_entries
      WHEN NEW.status <> 'draft' BEGIN
        SELECT RAISE(ABORT, 'New journal entries must start as drafts.');
      END;

      CREATE TRIGGER je_status_transition BEFORE UPDATE OF status ON journal_entries
      WHEN NEW.status <> OLD.status
        AND NOT ((OLD.status = 'draft' AND NEW.status = 'posted') OR (OLD.status = 'posted' AND NEW.status = 'void'))
      BEGIN
        SELECT RAISE(ABORT, 'That status change isn''t allowed.');
      END;

      CREATE TRIGGER je_post_must_balance BEFORE UPDATE OF status ON journal_entries
      WHEN OLD.status = 'draft' AND NEW.status = 'posted' AND (
        (SELECT COUNT(*) FROM journal_lines WHERE entry_id = NEW.id) < 2
        OR (SELECT COALESCE(SUM(amount_cents), 0) FROM journal_lines WHERE entry_id = NEW.id) <> 0)
      BEGIN
        SELECT RAISE(ABORT, 'Journal entry doesn''t balance: it needs at least two lines and debits must equal credits.');
      END;

      -- Posted entries can only be voided; voided entries never change.
      CREATE TRIGGER je_posted_locked BEFORE UPDATE ON journal_entries
      WHEN OLD.status = 'posted' AND NOT (
        NEW.status = 'void'
        AND NEW.id IS OLD.id AND NEW.entry_date IS OLD.entry_date AND NEW.memo IS OLD.memo
        AND NEW.source IS OLD.source AND NEW.reverses_entry_id IS OLD.reverses_entry_id
        AND NEW.created_at IS OLD.created_at AND NEW.posted_at IS OLD.posted_at)
      BEGIN
        SELECT RAISE(ABORT, 'A posted entry can''t be changed. Void or reverse it instead.');
      END;

      CREATE TRIGGER je_void_locked BEFORE UPDATE ON journal_entries
      WHEN OLD.status = 'void' BEGIN
        SELECT RAISE(ABORT, 'A voided entry can''t be changed.');
      END;

      CREATE TRIGGER je_no_delete_posted BEFORE DELETE ON journal_entries
      WHEN OLD.status <> 'draft' BEGIN
        SELECT RAISE(ABORT, 'Posted entries can''t be deleted. Void or reverse them instead.');
      END;

      -- Lines can only change while their entry is a draft.
      CREATE TRIGGER jl_insert_draft_only BEFORE INSERT ON journal_lines
      WHEN (SELECT status FROM journal_entries WHERE id = NEW.entry_id) IS NOT 'draft' BEGIN
        SELECT RAISE(ABORT, 'Lines can only be added to a draft entry.');
      END;

      CREATE TRIGGER jl_update_draft_only BEFORE UPDATE ON journal_lines
      WHEN (SELECT status FROM journal_entries WHERE id = OLD.entry_id) IS NOT 'draft'
        OR (SELECT status FROM journal_entries WHERE id = NEW.entry_id) IS NOT 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'Lines of a posted entry can''t be changed.');
      END;

      -- (A NULL status here means the parent draft is being deleted, which is allowed.)
      CREATE TRIGGER jl_delete_draft_only BEFORE DELETE ON journal_lines
      WHEN (SELECT status FROM journal_entries WHERE id = OLD.entry_id) <> 'draft' BEGIN
        SELECT RAISE(ABORT, 'Lines of a posted entry can''t be deleted.');
      END;

      -- Changing an account's type would silently move posted history between reports.
      CREATE TRIGGER accounts_type_locked BEFORE UPDATE OF type ON accounts
      WHEN NEW.type <> OLD.type AND EXISTS (
        SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = OLD.id AND e.status <> 'draft')
      BEGIN
        SELECT RAISE(ABORT, 'This account has posted entries, so its type can''t be changed.');
      END;

      ${Object.entries(V2_AUDITED)
        .map(([table, cols]) => auditTriggersV2(table, cols))
        .join('\n')}
    `
  }
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

export function getSchemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

/** Applies every migration newer than the file's current version, up to `target`. */
export function runMigrations(db: Database.Database, target: number = LATEST_SCHEMA_VERSION): void {
  const current = getSchemaVersion(db)
  for (const m of MIGRATIONS) {
    if (m.version <= current || m.version > target) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
    })()
  }
}
