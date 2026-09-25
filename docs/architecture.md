# JunoBooks — Architecture

Lean, current-state-only. See `JunoBooks-PLAN.md` for the master plan and phase list.

## Tech stack
- **Shell:** Electron, scaffolded with `electron-vite` (not the interactive `create-electron` wizard — that tool needs a real terminal and wouldn't run non-interactively, so the same file layout was built by hand).
- **UI:** React 18 + TypeScript, built with Vite.
- **Database:** SQLite via `better-sqlite3`, one file per company. (Not yet wired up — see Phase 0 status below.)
- **Installer:** `electron-builder` (NSIS `.exe`), built by GitHub Actions on `windows-latest`. (Not yet configured.)
- **Updates:** `electron-updater` against GitHub Releases. Checks on startup in packaged builds only; on finding a newer Release it downloads it and prompts to restart and install.
- **Tests:** Vitest, for ledger math, imports, and other logic that needs real tests.

## Folder layout
```
JunoBooks-code/
  src/
    main/            Electron main process (window, IPC handlers, database)
      paths.ts       Where the sample/test company lives (dev vs packaged)
      testCompany.ts Opens the sample company's SQLite file, smoke test, backups
    preload/         contextBridge API exposed to the renderer as window.juno
    renderer/         React app (src/renderer/src)
  test-data/          Sample companies for development (git-ignored, never real books)
    Companies/Sample Company/
      books.sqlite
      backups/       Timestamped copies made on app close, newest 30 kept
  docs/
    architecture.md   This file
    progress-log.md   Pointer log of what changed each round
    topics/           One doc per module, read only when a task touches it
    handoffs/         Numbered handoff files, created on request only
  electron.vite.config.ts
  package.json
```

## Database schema
Only a `smoke_test` table exists so far (Phase 0 unit 0b), used to prove the
app can write and read SQLite and take backups. The real schema (chart of
accounts, journal entries, etc.) starts in Phase 1.

Each company is one `better-sqlite3` file, opened in WAL mode. On app close,
the WAL is checkpointed and a timestamped copy of the file is placed in that
company's `backups/` folder; only the newest 30 copies are kept.

In dev (`npm start`) the sample company lives at `<project root>/test-data/Companies/Sample Company/`
(git-ignored). In a packaged build it falls back to a `test-data` folder
under Electron's userData directory, since the project source isn't shipped —
this is still a sample company, never the owner's real books. Real
company management (the `Documents\JunoBooks\` layout in the master plan)
starts in Phase 1.

## Ledger rules
Not yet implemented. Double-entry rules (every entry balances, posted periods lock, no hard deletes) land in Phase 1.

## Verification practice
- Small/low-risk changes: quick syntax/typecheck (`npm run typecheck`).
- Ledger math, schema, imports/exports: real automated tests (`npm test`, Vitest).

## Open questions
See `JunoBooks-PLAN.md` §10 (state for sales tax, inventory method, S-corp election timing, which bank CSVs, which Etsy exports).

## Topic docs index
None yet — created as modules land.

## Latest handoff
None yet. Created only when the owner types "create new handoff."

## Phase 0 status
- 0a confirmed: app scaffolded (window titled "JunoBooks", footer shows version + build date). `npm start` opens the window as expected.
- 0b confirmed: sample company database, smoke-test write/read, backup-on-close with 30-copy pruning. Lives at `test-data/Companies/Sample Company/` inside the project code folder (not `Documents\JunoBooks\` — that starts in Phase 1).
- 0c confirmed: repository is `github.com/juno-apps/junobooks` (public). Pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which builds the NSIS installer on `windows-latest` and publishes it as a GitHub Release. `v0.0.1` built, downloaded, and installed successfully (per-user install, not code-signed yet — expected).
- 0d in progress: `electron-updater` wired up in `src/main/index.ts` — on startup (packaged builds only), it checks GitHub Releases and offers to download and install a newer version. Version bumped to 0.0.2 to test this.
- 0e: not started.
