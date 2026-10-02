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
      paths.ts         Data root (installed vs development copy, Settings choice)
      dataLocation.ts  Data-folder pointer file and folder checks (no Electron imports)
      appSettings.ts   Per-PC prefs in the data root (app-settings.json: last opened company)
      companyStore.ts  Create / list / open companies, backups (no Electron imports, so testable)
      ledger.ts        Ledger engine: post / void / reverse entries, period lock, balances
      chart.ts         Apply a template's accounts; build the chart-of-accounts view
      accounts.ts      Add / edit / deactivate / delete accounts
      companyHistory.ts  Entity-type and home-state history: add / remove a change, correct the starting value
      entries.ts       Read-only entry list for the screens (writing stays in ledger.ts)
      register.ts      Read-only account register (lines + running balance)
      openingBalances.ts  Opening balances: read, and replace (void old + post new)
      attachments.ts   Receipt files: copy into receipts\<year>\, list, remove (kept on record)
      bankImport.ts    Bank/card CSV imports: read file, stage lines, review, post, ignore
      rules.ts         Categorization rules: list, add, edit, delete, matcher
      reconcile.ts     Cleared status and reconciliations (start, tick, finish, cancel, undo)
      etsyImport.ts    Etsy statement imports: accounts setup, preview, posting, payouts tie-out
      inventory.ts     Inventory facts: items, purchases, counts, filed method per year
      inventoryReport.ts  Inventory year report (four methods) and the year-end entry
      sales.ts         Customers, resale certificates, invoices, payments received, aging
      amazonImport.ts  Amazon settlement imports (and the shared add-channel-accounts helper)
      form1099k.ts     1099-K tie-out per year and platform
      salesTax.ts      Sales tax rates (dated), period report, recording a payment
      reports.ts       Profit & loss, balance sheet, trial balance, general ledger
      reportsExtra.ts  Sales by channel, tax-line summary, cost of goods sold schedule
      db/migrations.ts Numbered schema migrations
    preload/           contextBridge API exposed to the renderer as window.juno
    renderer/src/      React screens (App, CompanyPicker, NewCompanyForm, CompanyHome, ChartOfAccounts, AccountForm, TemplatePicker, EntityTypeChange, HomeStateChange, JournalEntry, TransactionList, SimpleEntry, TransferEntry, AccountCombobox, AccountRegister, OpeningBalances, Receipts, Settings, ImportWizard, BankReview, RulesManager, Reconcile, EtsyImport, AmazonImport, Form1099K, Inventory, Sales, SalesTax, Reports, ReportsExtra, ReportBits; useFormError hook)
    shared/            Code used by both main and renderer: entity types, US states, dates, money, company validation,
                       templates.ts (starting charts), taxLines.ts (tax categories + per-year line tables), chart.ts (view types),
                       accounts.ts (account input rules: kinds, debit/credit side, validation, number-range warning),
                       journal.ts (entry-screen rows → ledger lines, live totals, two-line balancing, entry list type),
                       everyday.ts (Expense/Income/Transfer screens: account groups, type-to-narrow filter, entry builders),
                       register.ts (register view types, column wording), opening.ts (opening-balance types, difference), settings.ts (Settings view type),
                       attachments.ts (receipt naming, accepted types), csvImport.ts (CSV reading, column guessing, mapping, fingerprints),
                       bankImport.ts (import types, account groups for import screens), rules.ts (rule matching, suggested text),
                       reconcile.ts (reconciliation view types, totals), etsy.ts (Etsy file reading, row kinds, posting plan, Etsy accounts),
                       etsyImport.ts (Etsy import types), inventory.ts (quantities, the four methods), inventoryView.ts (inventory screen types),
                       sales.ts (direct-sales types, tax rates, invoice totals, aging), invoiceHtml.ts (printable invoice),
                       amazon.ts / amazonImport.ts (Amazon settlement reading, kinds, plan, types), form1099k.ts (tie-out types), salesTax.ts (rates in force, quarters, report types),
                       reports.ts (report shapes, CSV helpers), reportsExtra.ts (detail report shapes)
  scripts/run-tests.cjs
  scripts/live/         Playwright live checks (dev-only; see docs/topics/live-checks.md)
  samples/              Made-up example files (bank CSVs, Etsy statement and orders, Amazon settlement) for trying imports and live checks
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
- **Data root** (`paths.ts`): the installed app uses `Documents\JunoBooks\`; a development copy (`npm start`) uses `<project>\test-data\` (live checks replace it with `JUNOBOOKS_DATA_ROOT`). **Settings** (header link, `Settings.tsx`) shows the folder and its company count, opens it, and switches to another folder or back to the standard one. The choice is a pointer file outside the data root (installed: `<userData>\data-location.json`; development: `test-data\data-location.json`). Switching closes (and backs up) the open company and never moves or copies files. `checkDataFolder` refuses a single company's folder, the `Companies` folder itself, a file, or a folder JunoBooks can't write to; a development copy only accepts folders inside its test data, so it can never open real books. Practice companies from earlier installed test versions stay in `<userData>\test-data\`; Settings mentions them with a "Use that folder" link.
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

**v6**
- `attachments` (`STRICT`): entry_id, stored_path (relative to the company folder), original_name, size_bytes, sha256, added_at, removed_at, remove_reason. Rows can't be deleted; the only change allowed is marking one removed (and its stored_path moving to `receipts/_removed/`). Audited.

**v7** (bank and card imports; details in `docs/topics/bank-import.md`)
- `import_batches`: account_id, file_name, imported_at, mapping (JSON), added / duplicate / problem / early counts. Can't be changed or deleted.
- `bank_lines`: batch_id, account_id, txn_date, description, amount_cents (≠ 0, debit side of the imported account), fingerprint, status (new/posted/matched/ignored), entry_id. Bank facts can't change; rows can't be deleted.
- `import_profiles`: saved column mapping per account + file layout (unique pair).
- `categorization_rules`: match_text, account_id, payee, bank_account_id (optional), is_active.
- Audited: import_batches, bank_lines, categorization_rules.

**v8** (cleared status and reconciliation)
- `reconciliations`: account_id, statement_date, statement_balance_cents (debit side), status (in_progress/finished/undone), started_at, finished_at, undone_at, undo_reason. At most one in progress per account. Finished ones can only be undone; they can't be deleted.
- `line_clearing`: journal_line_id (unique), status (cleared/reconciled), reconciliation_id (set exactly when reconciled). Reconciled rows can't change or be deleted unless their reconciliation is undone.
- Trigger: an entry with a reconciled line can't be voided. Both tables audited.

**v9** (marketplace imports; details in `docs/topics/etsy-import.md`)
- `import_batches` adds `channel` ('bank' default, 'etsy').
- `marketplace_rows` (imported statement rows, unique fingerprint per channel, entry link; can't change or be deleted), `channel_mappings` (account per kind per channel), `marketplace_orders` (orders by channel + order id). Rows and mappings audited.

**v10** (inventory; details in `docs/topics/inventory.md`)
- `inventory_items`, `inventory_purchases` (quantity in thousandths, cost cents, opening flag, soft remove; no delete), `inventory_counts` (unique item + date), `inventory_methods` (append-only filed method per year), `inventory_adjustments` (year-end entries). All audited.

**v11** (direct sales; details in `docs/topics/direct-sales.md`)
- `company_profile` adds address, email, phone (its audit triggers re-created).
- `customers`, `resale_certificates` (no delete), `invoices` (draft/open/void; finalized ones fixed), `invoice_lines` (draft-only changes), `payments` (no delete), `payment_applications` (fixed). All audited.

**v12** (details in `docs/topics/amazon-1099k.md`)
- `marketplace_rows.gross_cents` (gross receipts per imported row, for the 1099-K tie-out).
- `form_1099k` (year + platform unique, box 1a gross, notes). Audited.

**v13** (`docs/topics/sales-tax.md`)
- `sales_tax_rates` (state, place, rate in thousandths of a percent, start date, notes; unique state + place + date). Audited.

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
- **Balances** (`accountBalances`): debits minus credits per account, posted entries only, optionally as of a date. The chart screen shows balances as of today, so entries dated later (e.g. a Dec 31 year-end entry made in October) appear only in registers and reports for those dates. Each account stores its normal side, and the chart screen shows balances on that side (see `docs/topics/chart-of-accounts.md`).
- **Accounts** used by posted entries can't change type or debit/credit side; accounts used in any entry can't be deleted (renaming is fine). Inactive accounts can't receive postings or voids, and only zero-balance accounts can be deactivated. Details in `docs/topics/chart-of-accounts.md`.
- **Audit log** can't be edited or deleted. It rolls back with any failed change.

## Verification practice
- Small/low-risk changes: `npm run typecheck`.
- Ledger math, schema, imports/exports: real automated tests (`npm test`).
- Screens and anything the owner will click: a live check (run the app and click through it) under the owner's standing permission. See `docs/topics/live-checks.md`.

## Agreed design rules
- **Home state has effective dates** (built; see Companies). Sales tax rates by state and date come in Phase 8.
- **Sales tax rates are data with effective dates, not constants** (built; `docs/topics/sales-tax.md`). The owner adds a new rate and the date it starts. Old transactions keep the rate that applied on their date.
- **Judgment calls are flagged, not decided.** Where the app makes a tax/accounting assumption it shows a "Check with your accountant" note, and all notes collect on the accountant package's "Notes for accountant" page.

## Open questions
See `JunoBooks-PLAN.md` §10 (inventory method, S-corp election timing, which bank CSVs, which Etsy exports). Home state resolved: California, switchable per company.

## Topic docs index
- `docs/topics/live-checks.md`: how to run and click through the app for a live check, the standing access permission, traps.
- `docs/topics/manual-entry.md`: journal entry screen, transaction list (void, reverse, duplicate), opening balances, account register, everyday screens, error messages, entry-screen rules, the books-start-date rule for manual entries.
- `docs/topics/bank-import.md`: bank/card CSV import wizard, column guessing, duplicates, review and posting of imported lines, sign rule.
- `docs/topics/etsy-import.md`: Etsy statement + orders import, row kinds, how they post, Etsy accounts, payouts tie-out.
- `docs/topics/inventory.md`: inventory items, purchases, counts, the four methods, filed method, year-end entry.
- `docs/topics/direct-sales.md`: customers, resale certificates, invoices (draft, finalize, void, PDF), payments received, aging.
- `docs/topics/amazon-1099k.md`: Amazon settlement import (kinds, reserves, payout), 1099-K tie-out.
- `docs/topics/sales-tax.md`: dated sales tax rates, invoice rate prefill, period report for the CDTFA return, paying sales tax.
- `docs/topics/reports.md`: reports screen, financial reports, CSV export, year-end detail reports.
- `docs/topics/chart-of-accounts.md`: templates, numbering, entity-specific accounts, tax-line mapping, accountant notes, chart screen, editing accounts, adding/restoring accounts after creation.

## Latest handoff
None yet. Created only when the owner types "create new handoff."

## Status
- **Phase 0 complete:** installs from GitHub, opens, updates itself.
- **Phase 1 complete (schema v5 at the end of Phase 1):** create/list/switch companies, core schema + audit log, ledger engine + period lock, templates + chart of accounts + tax lines, account editing, entity-type and home-state changes with start dates (correct/remove, chart follows entity changes, restore missing accounts). 
- **Phase 2 complete (schema v6):** journal entry screen, transaction list, Expense / Income / Transfer, account register, opening balances, receipts, data folder `Documents\JunoBooks` + Settings (see `docs/topics/manual-entry.md`). 2d–2g verified by Claude, owner review pending. Sub-accounts stay parked until Phase 9.
- **Phase 3 complete (schema v8):** CSV import wizard, review screen, categorization rules, matching to entries already in the books, cleared status and reconciliation (`docs/topics/bank-import.md`). Verified by Claude, owner review pending.
- **Phase 4 complete (schema v9):** Etsy importer with payouts tie-out (`docs/topics/etsy-import.md`). Verified by Claude with made-up files; real exports untested (backlog).
- **Phase 5 complete (schema v10):** inventory with four methods side by side, filed method per year, year-end entry (`docs/topics/inventory.md`). Filed method for 2026 is the owner's/accountant's choice (backlog).
- **Phase 6 complete (schema v11):** customers, resale certificates, invoices with PDF, payments, aging (`docs/topics/direct-sales.md`).
- **Phase 7 complete (schema v12):** Amazon settlement importer and 1099-K tie-out (`docs/topics/amazon-1099k.md`). Real Amazon reports untested (backlog).
- **Phase 8 complete (schema v13):** sales tax rates by date and the period report (`docs/topics/sales-tax.md`).
- **Phase 9 in progress:** Reports screen with profit & loss, balance sheet, trial balance, general ledger, sales by channel, tax-line summary, cost of goods sold, inventory methods, CSV export (`docs/topics/reports.md`).
- Build run in progress: see `progress-log.md` → Build run for the resume point.
