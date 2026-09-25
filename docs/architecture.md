# JunoBooks — Architecture

Lean, current-state-only. See `JunoBooks-PLAN.md` for the master plan and phase list.

## Tech stack
- **Shell:** Electron, scaffolded with `electron-vite` (not the interactive `create-electron` wizard — that tool needs a real terminal and wouldn't run non-interactively, so the same file layout was built by hand).
- **UI:** React 18 + TypeScript, built with Vite.
- **Database:** SQLite via `better-sqlite3`, one file per company. (Not yet wired up — see Phase 0 status below.)
- **Installer:** `electron-builder` (NSIS `.exe`), built by GitHub Actions on `windows-latest`. (Not yet configured.)
- **Updates:** `electron-updater` against GitHub Releases. (Dependency installed, not yet wired up.)
- **Tests:** Vitest, for ledger math, imports, and other logic that needs real tests.

## Folder layout
```
JunoBooks-code/
  src/
    main/            Electron main process (window, IPC handlers)
    preload/         contextBridge API exposed to the renderer as window.juno
    renderer/         React app (src/renderer/src)
  test-data/          Sample companies for development (git-ignored, never real books)
  docs/
    architecture.md   This file
    progress-log.md   Pointer log of what changed each round
    topics/           One doc per module, read only when a task touches it
    handoffs/         Numbered handoff files, created on request only
  electron.vite.config.ts
  package.json
```

## Database schema
Not yet created. Phase 0 unit 0b will add a smoke-test table; the real schema starts in Phase 1.

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
- 0a in progress: app scaffolded (window titled "JunoBooks", footer shows version + build date), `git init` and `.gitignore` pending, this doc set just created.
- 0b–0e: not started.
