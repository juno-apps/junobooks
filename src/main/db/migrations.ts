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

/** Audit triggers as first written for v2. Never edit it (that would change
 * shipped migrations). Later migrations may reuse it as is, or add a new helper. */
function auditTriggersV2(table: string, columns: string[], baseline = true): string {
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
    ${
      baseline
        ? `INSERT INTO audit_log (at, action, table_name, record_id, new_values)
      SELECT ${now}, 'baseline', '${table}', r.id, ${json('r')} FROM ${table} AS r;`
        : ''
    }
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
  },
  {
    version: 3,
    description: 'Period locking (with reopen reasons), one live reversal per entry',
    sql: `
      -- Append-only: the latest row is the lock in force. NULL = nothing locked.
      CREATE TABLE period_lock_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        locked_through TEXT CHECK (locked_through IS NULL
          OR locked_through GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TRIGGER period_lock_no_update BEFORE UPDATE ON period_lock_history BEGIN
        SELECT RAISE(ABORT, 'Period lock history can''t be changed.');
      END;
      CREATE TRIGGER period_lock_no_delete BEFORE DELETE ON period_lock_history BEGIN
        SELECT RAISE(ABORT, 'Period lock history can''t be changed.');
      END;

      CREATE TRIGGER period_lock_reopen_needs_reason BEFORE INSERT ON period_lock_history
      WHEN trim(NEW.reason) = ''
        AND (SELECT locked_through FROM period_lock_history ORDER BY id DESC LIMIT 1) IS NOT NULL
        AND (NEW.locked_through IS NULL
          OR NEW.locked_through < (SELECT locked_through FROM period_lock_history ORDER BY id DESC LIMIT 1))
      BEGIN
        SELECT RAISE(ABORT, 'Reopening closed books needs a reason.');
      END;

      -- No posting or voiding on or before the locked-through date.
      CREATE TRIGGER je_locked_period BEFORE UPDATE OF status ON journal_entries
      WHEN NEW.status <> OLD.status
        AND min(OLD.entry_date, NEW.entry_date)
          <= (SELECT locked_through FROM period_lock_history ORDER BY id DESC LIMIT 1)
      BEGIN
        SELECT RAISE(ABORT, 'The books are closed for that date.');
      END;

      CREATE UNIQUE INDEX journal_entries_one_live_reversal ON journal_entries (reverses_entry_id)
        WHERE reverses_entry_id IS NOT NULL AND status = 'posted';

      ${auditTriggersV2('period_lock_history', ['id', 'locked_through', 'reason', 'created_at'])}
    `
  },
  {
    version: 4,
    description: 'Account details for templates and tax-line mapping; company template',
    sql: `
      ALTER TABLE accounts ADD COLUMN subtype TEXT NOT NULL DEFAULT '';
      ALTER TABLE accounts ADD COLUMN normal_balance TEXT NOT NULL DEFAULT 'debit'
        CHECK (normal_balance IN ('debit', 'credit'));
      ALTER TABLE accounts ADD COLUMN tax_category TEXT;
      ALTER TABLE accounts ADD COLUMN accountant_note TEXT NOT NULL DEFAULT '';
      UPDATE accounts SET normal_balance = 'credit' WHERE type IN ('liability', 'equity', 'income');

      -- NULL until a chart of accounts has been set up from a template.
      ALTER TABLE company_profile ADD COLUMN template TEXT
        CHECK (template IS NULL OR template IN ('general', 'product', 'retail', 'service'));

      -- Re-create these tables' audit triggers so the new columns are logged too.
      DROP TRIGGER audit_accounts_insert;
      DROP TRIGGER audit_accounts_update;
      DROP TRIGGER audit_accounts_delete;
      DROP TRIGGER audit_company_profile_insert;
      DROP TRIGGER audit_company_profile_update;
      DROP TRIGGER audit_company_profile_delete;
      ${auditTriggersV2(
        'accounts',
        [
          'id', 'number', 'name', 'type', 'parent_id', 'description', 'is_active', 'created_at', 'updated_at',
          'subtype', 'normal_balance', 'tax_category', 'accountant_note'
        ],
        false
      )}
      ${auditTriggersV2('company_profile', ['id', 'name', 'books_start_date', 'created_at', 'template'], false)}
    `
  },
  {
    version: 5,
    description: 'Inactive accounts: no new postings, no voids touching them, deactivate only at zero balance',
    sql: `
      CREATE TRIGGER jl_insert_account_active BEFORE INSERT ON journal_lines
      WHEN (SELECT is_active FROM accounts WHERE id = NEW.account_id) = 0
      BEGIN
        SELECT RAISE(ABORT, 'That account is inactive, so it can''t be used in entries.');
      END;

      CREATE TRIGGER jl_update_account_active BEFORE UPDATE OF account_id ON journal_lines
      WHEN NEW.account_id <> OLD.account_id
        AND (SELECT is_active FROM accounts WHERE id = NEW.account_id) = 0
      BEGIN
        SELECT RAISE(ABORT, 'That account is inactive, so it can''t be used in entries.');
      END;

      -- Posting or voiding changes balances, so every account in the entry must be active.
      CREATE TRIGGER je_status_accounts_active BEFORE UPDATE OF status ON journal_entries
      WHEN NEW.status <> OLD.status AND EXISTS (
        SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.entry_id = NEW.id AND a.is_active = 0)
      BEGIN
        SELECT RAISE(ABORT, 'An account in this entry is inactive. Reactivate it first.');
      END;

      -- Deactivating must never hide money.
      CREATE TRIGGER accounts_deactivate_zero_balance BEFORE UPDATE OF is_active ON accounts
      WHEN NEW.is_active = 0 AND OLD.is_active = 1 AND (
        SELECT COALESCE(SUM(l.amount_cents), 0)
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = OLD.id AND e.status = 'posted') <> 0
      BEGIN
        SELECT RAISE(ABORT, 'This account still has a balance, so it can''t be deactivated.');
      END;
    `
  },
  {
    version: 6,
    description: 'Receipt attachments on entries',
    sql: `
      CREATE TABLE attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
        stored_path TEXT NOT NULL,
        original_name TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        sha256 TEXT NOT NULL,
        added_at TEXT NOT NULL,
        removed_at TEXT,
        remove_reason TEXT
      ) STRICT;
      CREATE INDEX attachments_entry ON attachments(entry_id);

      -- Receipts are part of the record: they can be marked removed, never erased.
      CREATE TRIGGER attachments_no_delete BEFORE DELETE ON attachments BEGIN
        SELECT RAISE(ABORT, 'Receipts can be removed from an entry, but their record is kept.');
      END;
      CREATE TRIGGER attachments_only_remove BEFORE UPDATE ON attachments
      WHEN NEW.entry_id IS NOT OLD.entry_id OR NEW.original_name IS NOT OLD.original_name
        OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.sha256 IS NOT OLD.sha256 OR NEW.added_at IS NOT OLD.added_at
        OR OLD.removed_at IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'A receipt record can only be marked removed.');
      END;
      ${auditTriggersV2(
        'attachments',
        ['id', 'entry_id', 'stored_path', 'original_name', 'size_bytes', 'sha256', 'added_at', 'removed_at', 'remove_reason'],
        false
      )}
    `
  },
  {
    version: 7,
    description: 'Bank and card imports: import batches, imported lines, saved column mappings, categorization rules',
    sql: `
      CREATE TABLE import_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        file_name TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        mapping TEXT NOT NULL,
        added_count INTEGER NOT NULL,
        duplicate_count INTEGER NOT NULL,
        problem_count INTEGER NOT NULL,
        early_count INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE bank_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES import_batches(id),
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        txn_date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'posted', 'matched', 'ignored')),
        entry_id INTEGER REFERENCES journal_entries(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX bank_lines_account_fp ON bank_lines(account_id, fingerprint);
      CREATE INDEX bank_lines_status ON bank_lines(status);

      -- What the bank said never changes; only the line's status and link do.
      CREATE TRIGGER bank_lines_no_delete BEFORE DELETE ON bank_lines BEGIN
        SELECT RAISE(ABORT, 'Imported bank lines are kept on record. Ignore a line instead.');
      END;
      CREATE TRIGGER bank_lines_fixed BEFORE UPDATE ON bank_lines
      WHEN NEW.batch_id IS NOT OLD.batch_id OR NEW.account_id IS NOT OLD.account_id OR NEW.txn_date IS NOT OLD.txn_date
        OR NEW.description IS NOT OLD.description OR NEW.amount_cents IS NOT OLD.amount_cents
        OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.created_at IS NOT OLD.created_at
      BEGIN
        SELECT RAISE(ABORT, 'What the bank file said can''t be changed.');
      END;
      CREATE TRIGGER import_batches_no_change BEFORE UPDATE ON import_batches BEGIN
        SELECT RAISE(ABORT, 'Import records can''t be changed.');
      END;
      CREATE TRIGGER import_batches_no_delete BEFORE DELETE ON import_batches BEGIN
        SELECT RAISE(ABORT, 'Import records are kept.');
      END;

      CREATE TABLE import_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        layout_key TEXT NOT NULL,
        mapping TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (account_id, layout_key)
      ) STRICT;

      CREATE TABLE categorization_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_text TEXT NOT NULL CHECK (length(trim(match_text)) > 0),
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        payee TEXT NOT NULL DEFAULT '',
        bank_account_id INTEGER REFERENCES accounts(id),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      ${auditTriggersV2(
        'import_batches',
        ['id', 'account_id', 'file_name', 'imported_at', 'added_count', 'duplicate_count', 'problem_count', 'early_count'],
        false
      )}
      ${auditTriggersV2(
        'bank_lines',
        ['id', 'batch_id', 'account_id', 'txn_date', 'description', 'amount_cents', 'status', 'entry_id', 'updated_at'],
        false
      )}
      ${auditTriggersV2(
        'categorization_rules',
        ['id', 'match_text', 'account_id', 'payee', 'bank_account_id', 'is_active', 'created_at', 'updated_at'],
        false
      )}
    `
  },
  {
    version: 8,
    description: 'Cleared status on bank and card lines, and reconciliations',
    sql: `
      CREATE TABLE reconciliations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        statement_date TEXT NOT NULL,
        statement_balance_cents INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('in_progress', 'finished', 'undone')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        undone_at TEXT,
        undo_reason TEXT
      ) STRICT;
      CREATE UNIQUE INDEX reconciliations_one_open ON reconciliations(account_id) WHERE status = 'in_progress';

      CREATE TABLE line_clearing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_line_id INTEGER NOT NULL UNIQUE REFERENCES journal_lines(id),
        status TEXT NOT NULL CHECK (status IN ('cleared', 'reconciled')),
        reconciliation_id INTEGER REFERENCES reconciliations(id),
        updated_at TEXT NOT NULL,
        CHECK ((status = 'reconciled') = (reconciliation_id IS NOT NULL))
      ) STRICT;

      -- A finished reconciliation can't lose or change its lines unless it is undone first.
      CREATE TRIGGER line_clearing_keep_reconciled BEFORE UPDATE ON line_clearing
      WHEN OLD.status = 'reconciled'
        AND (SELECT status FROM reconciliations WHERE id = OLD.reconciliation_id) <> 'undone'
      BEGIN
        SELECT RAISE(ABORT, 'This line is part of a finished reconciliation. Undo that reconciliation first.');
      END;
      CREATE TRIGGER line_clearing_no_delete_reconciled BEFORE DELETE ON line_clearing
      WHEN OLD.status = 'reconciled'
      BEGIN
        SELECT RAISE(ABORT, 'This line is part of a finished reconciliation. Undo that reconciliation first.');
      END;
      CREATE TRIGGER reconciliations_finished_stay BEFORE UPDATE ON reconciliations
      WHEN OLD.status <> 'in_progress' AND NOT (OLD.status = 'finished' AND NEW.status = 'undone')
      BEGIN
        SELECT RAISE(ABORT, 'A finished reconciliation can only be undone.');
      END;
      CREATE TRIGGER reconciliations_no_delete_finished BEFORE DELETE ON reconciliations
      WHEN OLD.status <> 'in_progress'
      BEGIN
        SELECT RAISE(ABORT, 'Finished reconciliations are kept on record.');
      END;

      -- Voiding would change a balance the bank statement already agreed with.
      CREATE TRIGGER je_void_not_reconciled BEFORE UPDATE OF status ON journal_entries
      WHEN NEW.status = 'void' AND OLD.status <> 'void' AND EXISTS (
        SELECT 1 FROM line_clearing c JOIN journal_lines l ON l.id = c.journal_line_id
        WHERE l.entry_id = NEW.id AND c.status = 'reconciled')
      BEGIN
        SELECT RAISE(ABORT, 'This entry is part of a finished bank reconciliation. Reverse it instead, or undo that reconciliation first.');
      END;

      ${auditTriggersV2(
        'reconciliations',
        ['id', 'account_id', 'statement_date', 'statement_balance_cents', 'status', 'started_at', 'finished_at', 'undone_at', 'undo_reason'],
        false
      )}
      ${auditTriggersV2('line_clearing', ['id', 'journal_line_id', 'status', 'reconciliation_id', 'updated_at'], false)}
    `
  },
  {
    version: 9,
    description: 'Marketplace imports (Etsy): imported statement rows, account choices per kind, orders',
    sql: `
      ALTER TABLE import_batches ADD COLUMN channel TEXT NOT NULL DEFAULT 'bank';

      CREATE TABLE marketplace_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        batch_id INTEGER NOT NULL REFERENCES import_batches(id),
        fingerprint TEXT NOT NULL,
        row_date TEXT NOT NULL,
        kind TEXT NOT NULL,
        cents INTEGER NOT NULL,
        entry_id INTEGER REFERENCES journal_entries(id),
        created_at TEXT NOT NULL,
        UNIQUE (channel, fingerprint)
      ) STRICT;
      CREATE TRIGGER marketplace_rows_no_change BEFORE UPDATE ON marketplace_rows BEGIN
        SELECT RAISE(ABORT, 'Imported marketplace rows can''t be changed.');
      END;
      CREATE TRIGGER marketplace_rows_no_delete BEFORE DELETE ON marketplace_rows BEGIN
        SELECT RAISE(ABORT, 'Imported marketplace rows are kept on record.');
      END;

      CREATE TABLE channel_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        target TEXT NOT NULL,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        updated_at TEXT NOT NULL,
        UNIQUE (channel, target)
      ) STRICT;

      CREATE TABLE marketplace_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        order_id TEXT NOT NULL,
        sale_date TEXT,
        items_cents INTEGER NOT NULL,
        shipping_cents INTEGER NOT NULL,
        discount_cents INTEGER NOT NULL,
        sales_tax_cents INTEGER NOT NULL,
        total_cents INTEGER NOT NULL,
        ship_state TEXT NOT NULL,
        ship_country TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (channel, order_id)
      ) STRICT;

      ${auditTriggersV2('marketplace_rows', ['id', 'channel', 'batch_id', 'row_date', 'kind', 'cents', 'entry_id'], false)}
      ${auditTriggersV2('channel_mappings', ['id', 'channel', 'target', 'account_id', 'updated_at'], false)}
    `
  },
  {
    version: 10,
    description: 'Inventory: items, material purchases, physical counts, filed method per year, year-end adjustments',
    sql: `
      CREATE TABLE inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
        unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
        notes TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE inventory_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES inventory_items(id),
        purchase_date TEXT NOT NULL,
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
        cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
        is_opening INTEGER NOT NULL DEFAULT 0 CHECK (is_opening IN (0, 1)),
        memo TEXT NOT NULL DEFAULT '',
        removed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER inventory_purchases_no_delete BEFORE DELETE ON inventory_purchases BEGIN
        SELECT RAISE(ABORT, 'Purchases are kept on record. Remove one instead.');
      END;

      CREATE TABLE inventory_counts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        count_date TEXT NOT NULL,
        item_id INTEGER NOT NULL REFERENCES inventory_items(id),
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (count_date, item_id)
      ) STRICT;

      -- Append-only: the latest row for a year is the filed method in force.
      CREATE TABLE inventory_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        method TEXT CHECK (method IS NULL OR method IN ('periodic', 'fifo', 'average', 'expensed')),
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER inventory_methods_append_only_u BEFORE UPDATE ON inventory_methods BEGIN
        SELECT RAISE(ABORT, 'The filed-method history can''t be changed.');
      END;
      CREATE TRIGGER inventory_methods_append_only_d BEFORE DELETE ON inventory_methods BEGIN
        SELECT RAISE(ABORT, 'The filed-method history can''t be changed.');
      END;

      CREATE TABLE inventory_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        as_of_date TEXT NOT NULL,
        method TEXT NOT NULL,
        value_cents INTEGER NOT NULL,
        entry_id INTEGER REFERENCES journal_entries(id),
        created_at TEXT NOT NULL
      ) STRICT;

      ${auditTriggersV2('inventory_items', ['id', 'name', 'unit', 'notes', 'is_active', 'created_at', 'updated_at'], false)}
      ${auditTriggersV2(
        'inventory_purchases',
        ['id', 'item_id', 'purchase_date', 'quantity_milli', 'cost_cents', 'is_opening', 'memo', 'removed_at', 'updated_at'],
        false
      )}
      ${auditTriggersV2('inventory_counts', ['id', 'count_date', 'item_id', 'quantity_milli', 'updated_at'], false)}
      ${auditTriggersV2('inventory_methods', ['id', 'year', 'method', 'reason', 'created_at'], false)}
      ${auditTriggersV2('inventory_adjustments', ['id', 'as_of_date', 'method', 'value_cents', 'entry_id', 'created_at'], false)}
    `
  },
  {
    version: 11,
    description: 'Direct sales: business contact details, customers, resale certificates, invoices, payments received',
    sql: `
      ALTER TABLE company_profile ADD COLUMN address TEXT NOT NULL DEFAULT '';
      ALTER TABLE company_profile ADD COLUMN email TEXT NOT NULL DEFAULT '';
      ALTER TABLE company_profile ADD COLUMN phone TEXT NOT NULL DEFAULT '';
      DROP TRIGGER audit_company_profile_insert;
      DROP TRIGGER audit_company_profile_update;
      DROP TRIGGER audit_company_profile_delete;
      ${auditTriggersV2('company_profile', ['id', 'name', 'books_start_date', 'created_at', 'template', 'address', 'email', 'phone'], false)}

      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        is_wholesale INTEGER NOT NULL DEFAULT 0 CHECK (is_wholesale IN (0, 1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE resale_certificates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        cert_number TEXT NOT NULL,
        state_code TEXT NOT NULL,
        issued_date TEXT,
        expires_date TEXT,
        stored_path TEXT,
        original_name TEXT,
        notes TEXT NOT NULL DEFAULT '',
        removed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER resale_certificates_no_delete BEFORE DELETE ON resale_certificates BEGIN
        SELECT RAISE(ABORT, 'Resale certificates are kept on record. Remove one instead.');
      END;

      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL UNIQUE,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        issue_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'void')),
        memo TEXT NOT NULL DEFAULT '',
        tax_rate_milli INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_milli >= 0),
        tax_exempt INTEGER NOT NULL DEFAULT 0 CHECK (tax_exempt IN (0, 1)),
        exempt_reason TEXT NOT NULL DEFAULT '',
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        tax_cents INTEGER NOT NULL DEFAULT 0,
        total_cents INTEGER NOT NULL DEFAULT 0,
        entry_id INTEGER REFERENCES journal_entries(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finalized_at TEXT,
        voided_at TEXT,
        void_reason TEXT
      ) STRICT;
      -- Once finalized, an invoice only changes by being voided.
      CREATE TRIGGER invoices_fixed BEFORE UPDATE ON invoices
      WHEN OLD.status <> 'draft' AND NOT (OLD.status = 'open' AND NEW.status = 'void'
        AND NEW.number IS OLD.number AND NEW.total_cents IS OLD.total_cents AND NEW.customer_id IS OLD.customer_id)
      BEGIN
        SELECT RAISE(ABORT, 'A finalized invoice can''t be changed. Void it and make a new one.');
      END;
      CREATE TRIGGER invoices_delete_drafts_only BEFORE DELETE ON invoices WHEN OLD.status <> 'draft' BEGIN
        SELECT RAISE(ABORT, 'Only a draft invoice can be deleted.');
      END;

      CREATE TABLE invoice_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        line_no INTEGER NOT NULL,
        description TEXT NOT NULL,
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
        unit_price_cents INTEGER NOT NULL,
        amount_cents INTEGER NOT NULL,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        taxable INTEGER NOT NULL DEFAULT 1 CHECK (taxable IN (0, 1))
      ) STRICT;
      CREATE TRIGGER invoice_lines_draft_only_i BEFORE INSERT ON invoice_lines
      WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'A finalized invoice can''t be changed.');
      END;
      CREATE TRIGGER invoice_lines_draft_only_u BEFORE UPDATE ON invoice_lines
      WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'A finalized invoice can''t be changed.');
      END;
      CREATE TRIGGER invoice_lines_draft_only_d BEFORE DELETE ON invoice_lines
      WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'A finalized invoice can''t be changed.');
      END;

      CREATE TABLE payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        payment_date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        deposit_account_id INTEGER NOT NULL REFERENCES accounts(id),
        method TEXT NOT NULL DEFAULT '',
        reference TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
        entry_id INTEGER REFERENCES journal_entries(id),
        created_at TEXT NOT NULL,
        voided_at TEXT,
        void_reason TEXT
      ) STRICT;
      CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN
        SELECT RAISE(ABORT, 'Payments are kept on record. Void one instead.');
      END;

      CREATE TABLE payment_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES payments(id),
        invoice_id INTEGER NOT NULL REFERENCES invoices(id),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)
      ) STRICT;
      CREATE TRIGGER payment_applications_fixed_u BEFORE UPDATE ON payment_applications BEGIN
        SELECT RAISE(ABORT, 'Payment applications can''t be changed. Void the payment instead.');
      END;
      CREATE TRIGGER payment_applications_fixed_d BEFORE DELETE ON payment_applications BEGIN
        SELECT RAISE(ABORT, 'Payment applications can''t be changed. Void the payment instead.');
      END;

      ${auditTriggersV2('customers', ['id', 'name', 'email', 'phone', 'address', 'notes', 'is_wholesale', 'is_active', 'updated_at'], false)}
      ${auditTriggersV2(
        'resale_certificates',
        ['id', 'customer_id', 'cert_number', 'state_code', 'issued_date', 'expires_date', 'stored_path', 'notes', 'removed_at', 'updated_at'],
        false
      )}
      ${auditTriggersV2(
        'invoices',
        ['id', 'number', 'customer_id', 'issue_date', 'due_date', 'status', 'memo', 'tax_rate_milli', 'tax_exempt', 'exempt_reason',
          'subtotal_cents', 'tax_cents', 'total_cents', 'entry_id', 'finalized_at', 'voided_at', 'void_reason'],
        false
      )}
      ${auditTriggersV2(
        'invoice_lines',
        ['id', 'invoice_id', 'line_no', 'description', 'quantity_milli', 'unit_price_cents', 'amount_cents', 'account_id', 'taxable'],
        false
      )}
      ${auditTriggersV2(
        'payments',
        ['id', 'customer_id', 'payment_date', 'amount_cents', 'deposit_account_id', 'method', 'reference', 'status', 'entry_id', 'voided_at', 'void_reason'],
        false
      )}
      ${auditTriggersV2('payment_applications', ['id', 'payment_id', 'invoice_id', 'amount_cents'], false)}
    `
  },
  {
    version: 12,
    description: 'Gross receipts per imported marketplace row, and 1099-K amounts per year and platform',
    sql: `
      ALTER TABLE marketplace_rows ADD COLUMN gross_cents INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE form_1099k (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        platform TEXT NOT NULL CHECK (length(trim(platform)) > 0),
        gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        UNIQUE (year, platform)
      ) STRICT;
      ${auditTriggersV2('form_1099k', ['id', 'year', 'platform', 'gross_cents', 'notes', 'updated_at'], false)}
    `
  },
  {
    version: 13,
    description: 'Sales tax rates as dated data',
    sql: `
      CREATE TABLE sales_tax_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_code TEXT NOT NULL CHECK (length(state_code) = 2),
        place TEXT NOT NULL DEFAULT '',
        rate_milli INTEGER NOT NULL CHECK (rate_milli >= 0 AND rate_milli <= 100000),
        effective_date TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (state_code, place, effective_date)
      ) STRICT;
      ${auditTriggersV2('sales_tax_rates', ['id', 'state_code', 'place', 'rate_milli', 'effective_date', 'notes', 'created_at'], false)}
    `
  },
  {
    version: 14,
    description: 'Year-end records: contractors (1099-NEC), fixed assets, mileage log and rates, home office',
    sql: `
      CREATE TABLE contractors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        address TEXT NOT NULL DEFAULT '',
        w9_on_file INTEGER NOT NULL DEFAULT 0 CHECK (w9_on_file IN (0, 1)),
        tin_last4 TEXT NOT NULL DEFAULT '',
        match_text TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE fixed_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        account_id INTEGER REFERENCES accounts(id),
        in_service_date TEXT NOT NULL,
        cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
        disposed_date TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE mileage_trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_date TEXT NOT NULL,
        miles_tenths INTEGER NOT NULL CHECK (miles_tenths > 0),
        purpose TEXT NOT NULL CHECK (length(trim(purpose)) > 0),
        from_place TEXT NOT NULL DEFAULT '',
        to_place TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE mileage_rates (
        year INTEGER PRIMARY KEY,
        rate_tenth_cents INTEGER NOT NULL CHECK (rate_tenth_cents >= 0),
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE home_office (
        year INTEGER PRIMARY KEY,
        office_sqft INTEGER NOT NULL CHECK (office_sqft >= 0),
        home_sqft INTEGER NOT NULL CHECK (home_sqft >= 0),
        rent_cents INTEGER NOT NULL DEFAULT 0,
        mortgage_interest_cents INTEGER NOT NULL DEFAULT 0,
        property_tax_cents INTEGER NOT NULL DEFAULT 0,
        utilities_cents INTEGER NOT NULL DEFAULT 0,
        insurance_cents INTEGER NOT NULL DEFAULT 0,
        repairs_cents INTEGER NOT NULL DEFAULT 0,
        other_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      ) STRICT;

      ${auditTriggersV2('contractors', ['id', 'name', 'address', 'w9_on_file', 'tin_last4', 'match_text', 'notes', 'is_active', 'updated_at'], false)}
      ${auditTriggersV2('fixed_assets', ['id', 'name', 'account_id', 'in_service_date', 'cost_cents', 'disposed_date', 'notes', 'updated_at'], false)}
      ${auditTriggersV2('mileage_trips', ['id', 'trip_date', 'miles_tenths', 'purpose', 'from_place', 'to_place', 'created_at'], false)}
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
