# JunoBooks — Architecture

Lean, current-state-only. See `JunoBooks-PLAN.md` for the master plan and phase list.

## Tech stack
- **Shell:** Electron, scaffolded with `electron-vite` (file layout built by hand; the interactive wizard can't run non-interactively).
- **UI:** React 18 + TypeScript, built with Vite.
- **Database:** SQLite via `better-sqlite3`, one file per company. See Database schema below.
- **Installer:** `electron-builder` (NSIS `.exe`), built by GitHub Actions on `windows-latest` whenever a `vX.Y.Z` tag is pushed (`.github/workflows/release.yml`), published to GitHub Releases (`juno-apps/junobooks`, `releaseType: "release"`). Per-user install, not code-signed yet.
- **Updates:** `electron-updater` against GitHub Releases. Checks on startup in packaged builds only; downloads a newer Release and prompts to restart and install.
- **Tests:** Vitest, run by `npm test` through `scripts/run-tests.cjs`, which launches Vitest inside Electron's Node (`ELECTRON_RUN_AS_NODE=1`) because `better-sqlite3` is compiled for Electron and won't load in plain Node. Test files sit next to the code (`*.test.ts`).

## Folder layout
```
JunoBooks-code/
  src/
    main/              Electron main process
      index.ts         Window, IPC handlers, the one open company
      paths.ts         Data root (dev vs packaged)
      appSettings.ts   Per-PC prefs (app-settings.json: last opened company)
      companyStore.ts  Create / list / open companies, backups (no Electron imports, so testable)
      ledger.ts        Ledger engine: post / void / reverse entries, period lock, balances
      chart.ts         Apply a template's accounts; build the chart-of-accounts view
      accounts.ts      Add / edit / deactivate / delete accounts
      companyHistory.ts  Entity-type and home-state history: add / remove a change, correct the starting value
      db/migrations.ts Numbered schema migrations
    preload/           contextBridge API exposed to the renderer as window.juno
    renderer/src/      React screens (App, CompanyPicker, NewCompanyForm, CompanyHome, ChartOfAccounts, AccountForm, TemplatePicker, EntityTypeChange, HomeStateChange)
    shared/            Code used by both main and renderer: entity types, US states, dates, money, company validation,
                       templates.ts (starting charts), taxLines.ts (tax categories + per-year line tables), chart.ts (view types),
                       accounts.ts (account input rules: kinds, debit/credit side, validation, number-range warning)
  scripts/run-tests.cjs
  test-data/           Dev data root (git-ignored, never real books)
    app-settings.json
    Companies/<Company Name>/
      books.sqlite
      backups/  receipts/  exports/
  docs/
    architecture.md    This file
    progress-log.md    Pointer log of what changed each round
    backlog.md         Parked ideas ("backlog:" messages), reviewed at each phase start
    topics/            One doc per module, read only when a task touches it
    handoffs/          Numbered handoff files, created on request only
```

## Companies
- **Data root:** dev (`npm start`) uses `<project>/test-data`. Packaged builds use `<userData>/test-data`. **Decision:** both stay on test folders until the Phase 2 checkpoint (manual entry) passes; right after it, packaged builds move to `Documents\JunoBooks\` with a Settings screen to choose the folder (Phase 3 imports real bank files, so real books must not start before then). Nothing touches the owner's real books until then.
- A company = a folder under `Companies\`. The folder name is the company name made Windows-safe (`folderNameFor`). The folder name is the company's ID on this PC. Duplicate names are rejected.
- The company list is built by scanning folders and reading each `books.sqlite` read-only. Folders that aren't JunoBooks companies (schema version 0, e.g. the old Phase 0 `Sample Company` smoke-test file) are skipped.
- One company is open at a time. Switching opens the new one first, then closes (and backs up) the old one. The last opened company reopens on startup.
- New company form: name, entity type, home state (default CA), books start date (default Jan 1 this year), starting chart of accounts (template). The initial entity type and home state take effect on the books start date. The chart is created in the same transaction.
- Companies created before templates existed show a one-time "Set up the chart of accounts" panel (refused if the company already has accounts).
- Company home shows the profile and the chart of accounts. See `docs/topics/chart-of-accounts.md`.
- **Entity type and home state changes** (`companyHistory.ts`, "Change" links on company home): a new value plus a start date is added to `entity_type_history` / `home_state_history`. Both share one set of rules (`validateHistoryChange` in `shared/company.ts`): the date can't be before the books start, on or before the books-closed-through date, on a date that already has an entry, or change nothing. Future dates are allowed. "Correct starting type/state" replaces the first row's value (same date); "Remove" deletes a later change (never the starting one). Both are refused if the books are closed through the date involved. Every change shows a "Check with your accountant" note. The history list reloads after every save. An entity-type add/correct also adds the accounts the new type needs, in the same transaction (see `docs/topics/chart-of-accounts.md`); existing accounts are never changed or removed. A home-state change records history only.

## Database schema
Schema version is SQLite's `user_version` (0 = not a JunoBooks file). Migrations live in `src/main/db/migrations.ts`, each in its own transaction. Shipped migrations are never edited — add a new one.
Opening an older file backs it up first (`backups/books-<time>-before-upgrade-vX-to-vY.sqlite`), then migrates. A file from a newer app version is refused.

**v1**
- `company_profile` (single row, id = 1): name, books_start_date, created_at.
- `entity_type_history`: entity_type (CHECK against the 7 types), effective_date (unique), created_at.
- `home_state_history`: state_code, effective_date (unique), created_at.
- The value in force on a date = latest row with effective_date ≤ that date (falls back to the earliest row).

**v2** (all new tables `STRICT`)
- `accounts`: number (unique text), name, type (asset/liability/equity/income/expense), parent_id, description, is_active, created_at, updated_at.
- `journal_entries`: entry_date, memo, status (draft/posted/void), source (e.g. `manual`), reverses_entry_id, created_at, posted_at, voided_at, void_reason.
- `journal_lines`: entry_id, line_no, account_id, amount_cents (signed integer, never 0), memo.
- `audit_log`: at (UTC ms), action (insert/update/delete/baseline), table_name, record_id, old_values / new_values (JSON). Filled by triggers on every table above, so no code path can skip it. Rows that existed before v2 were logged as `baseline`.

**v3**
- `period_lock_history` (append-only): locked_through (date or NULL = nothing locked), reason, created_at. The latest row is the lock in force. Audited.
- Unique index: at most one *posted* reversal per entry.

**v4**
- `accounts` adds subtype (e.g. bank, credit_card, sales_tax, inventory, cogs, contra, owner_draw), normal_balance (debit/credit), tax_category, accountant_note.
- `company_profile` adds template (NULL = no chart yet).
- Audit triggers for both tables re-created to log the new columns.

**v5** (triggers only)
- No journal line may be added to (or moved onto) an inactive account.
- Posting or voiding an entry is refused if any of its accounts is inactive.
- An account can't be deactivated while its posted balance (all dates) is non-zero.

Files open in WAL mode with foreign keys on. Dates are `YYYY-MM-DD` text.

**Backups:** on close (and before any migration) the WAL is checkpointed and the file copied to `backups/books-<ISO time>[-label].sqlite`. Only the newest 30 are kept (sorted by name, since names start with the timestamp).

## Entity types → federal return
Sole proprietor, Single-member LLC → Schedule C · Multi-member LLC, Partnership → 1065 · LLC taxed as S-corp, S-corp → 1120-S · C-corp → 1120. Defined in `src/shared/entities.ts`.

## Ledger rules
`src/main/ledger.ts` is the only code that writes journal entries. It checks every rule first (plain-English errors), and database triggers enforce the same rules underneath, so they hold even if the code is bypassed.
- **Money** is signed integer cents: positive = debit, negative = credit. `shared/money.ts` converts typed amounts ↔ cents with string handling only (`parseMoney`, `formatCents`). Max $10 trillion per line.
- **Posting** (`postEntry`): valid date, ≥ 2 lines, whole non-zero cents, active accounts, debits = credits, date not locked. Draft → lines → posted in one transaction. A failure leaves nothing behind.
- **Posted = locked:** a posted entry and its lines can't be edited or deleted. Only draft → posted → void is allowed.
- **Void** (`voidEntry`): needs a reason, and every account in the entry must be active. The entry stays on record but drops out of balances. Voided entries never change.
- **Reverse** (`reverseEntry`): posts an equal-and-opposite entry (source `reversal`) linked by `reverses_entry_id`, dated on or after the original. It works even when the original's period is locked. An entry can have only one live reversal, and a reversed entry can't be voided (void the reversal first).
- **Period lock** (`setLockedThrough`): one "books closed through" date per company. Nothing dated on or before it can be posted or voided. Moving it later needs no reason. Moving it earlier or clearing it (reopening) needs a reason, and every change is kept in `period_lock_history` and the audit log.
- **Balances** (`accountBalances`): debits minus credits per account, posted entries only, optionally as of a date. Each account stores its normal side, and the chart screen shows balances on that side (see `docs/topics/chart-of-accounts.md`).
- **Accounts** used by posted entries can't change type or debit/credit side; accounts used in any entry can't be deleted (renaming is fine). Inactive accounts can't receive postings or voids, and only zero-balance accounts can be deactivated. Details in `docs/topics/chart-of-accounts.md`.
- **Audit log** can't be edited or deleted. It rolls back with any failed change.

## Verification practice
- Small/low-risk changes: `npm run typecheck`.
- Ledger math, schema, imports/exports: real automated tests (`npm test`).

## Agreed design rules
- **Home state has effective dates** (built; see Companies). Sales tax rates by state and date come in Phase 8.
- **Sales tax rates are data with effective dates, not constants** (not built yet; Phase 8). The owner adds a new rate and the date it starts. Old transactions keep the rate that applied on their date.
- **Judgment calls are flagged, not decided.** Where the app makes a tax/accounting assumption it shows a "Check with your accountant" note, and all notes collect on the accountant package's "Notes for accountant" page.

## Open questions
See `JunoBooks-PLAN.md` §10 (inventory method, S-corp election timing, which bank CSVs, which Etsy exports). Home state resolved: California, switchable per company.

## Topic docs index
- `docs/topics/chart-of-accounts.md`: templates, numbering, entity-specific accounts, tax-line mapping, accountant notes, chart screen, editing accounts, adding/restoring accounts after creation.

## Latest handoff
None yet. Created only when the owner types "create new handoff."

## Status
- **Phase 0 complete:** installs from GitHub, opens, updates itself.
- **Phase 1 complete (schema v5):** create/list/switch companies, core schema + audit log, ledger engine + period lock, templates + chart of accounts + tax lines, account editing, entity-type and home-state changes with start dates (correct/remove, chart follows entity changes, restore missing accounts). No screen posts entries yet; that starts in Phase 2.
- **Next: Phase 2** (manual entry). Parked backlog item that may fit: sub-accounts (see `docs/backlog.md`).
