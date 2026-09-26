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
      db/migrations.ts Numbered schema migrations
    preload/           contextBridge API exposed to the renderer as window.juno
    renderer/src/      React screens (App, CompanyPicker, NewCompanyForm, CompanyHome)
    shared/            Code used by both main and renderer: entity types, US states, dates, company validation
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
- **Data root:** dev (`npm start`) uses `<project>/test-data`. Packaged builds use `<userData>/test-data` until the ledger is finished, then switch to `Documents\JunoBooks\` (configurable in Settings). Nothing touches the owner's real books.
- A company = a folder under `Companies\`. The folder name is the company name made Windows-safe (`folderNameFor`). The folder name is the company's ID on this PC. Duplicate names are rejected.
- The company list is built by scanning folders and reading each `books.sqlite` read-only. Folders that aren't JunoBooks companies (schema version 0, e.g. the old Phase 0 `Sample Company` smoke-test file) are skipped.
- One company is open at a time. Switching opens the new one first, then closes (and backs up) the old one. The last opened company reopens on startup.
- New company form: name, entity type, home state (default CA), books start date (default Jan 1 this year). The initial entity type and home state take effect on the books start date.

## Database schema
Schema version is SQLite's `user_version` (0 = not a JunoBooks file). Migrations live in `src/main/db/migrations.ts`, each in its own transaction. Shipped migrations are never edited — add a new one.
Opening an older file backs it up first (`backups/books-<time>-before-upgrade-vX-to-vY.sqlite`), then migrates. A file from a newer app version is refused.

**v1**
- `company_profile` (single row, id = 1): name, books_start_date, created_at.
- `entity_type_history`: entity_type (CHECK against the 7 types), effective_date (unique), created_at.
- `home_state_history`: state_code, effective_date (unique), created_at.
- The value in force on a date = latest row with effective_date ≤ that date (falls back to the earliest row).

Files open in WAL mode with foreign keys on. Dates are `YYYY-MM-DD` text.

**Backups:** on close (and before any migration) the WAL is checkpointed and the file copied to `backups/books-<ISO time>[-label].sqlite`. Only the newest 30 are kept (sorted by name, since names start with the timestamp).

## Entity types → federal return
Sole proprietor, Single-member LLC → Schedule C · Multi-member LLC, Partnership → 1065 · LLC taxed as S-corp, S-corp → 1120-S · C-corp → 1120. Defined in `src/shared/entities.ts`.

## Ledger rules
Not yet implemented (units 1b–1c). Every entry balances, posted periods lock, no hard deletes, money as integer cents.

## Verification practice
- Small/low-risk changes: `npm run typecheck`.
- Ledger math, schema, imports/exports: real automated tests (`npm test`).

## Agreed design rules (not yet built)
- **Home state has effective dates** (stored since v1). A screen to change it with a start date comes in unit 1e.
- **Sales tax rates are data with effective dates, not constants.** The owner adds a new rate and the date it starts. Old transactions keep the rate that applied on their date. Built in Phase 8.
- **Judgment calls are flagged, not decided.** Where the app makes a tax/accounting assumption it shows a "Check with your accountant" note, and all notes collect on the accountant package's "Notes for accountant" page.

## Phase 1 plan
1a company manager · 1b core schema + audit log · 1c ledger engine · 1d templates + chart of accounts + tax-line mapping · 1e classification/state history screens + settings · 1f docs.

## Open questions
See `JunoBooks-PLAN.md` §10 (inventory method, S-corp election timing, which bank CSVs, which Etsy exports). Home state resolved: California, switchable per company.

## Topic docs index
None yet — created as modules land.

## Latest handoff
None yet. Created only when the owner types "create new handoff."

## Status
- **Phase 0 complete:** installs from GitHub, opens, updates itself.
- **Phase 1:** 1a confirmed (create, list, switch companies).
