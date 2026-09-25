# Progress Log

Pointer log only — a few lines per round. Details live in git history.

## Round 1 — Phase 0 plan agreed
- Agreed Phase 0 plan: Electron + React + TypeScript via electron-vite, better-sqlite3, electron-builder/NSIS installer via GitHub Actions, electron-updater, public GitHub repo.
- Status: plan confirmed by owner, not yet built.

## Round 2 — Unit 0a: scaffold
- Files: `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/**`, `.gitignore`, `docs/architecture.md`, `docs/progress-log.md`.
- Window titled "JunoBooks" with a footer showing version + build date.
- Status: **confirmed** by owner (`npm start` opens the window correctly).

## Round 3 — Unit 0b: database smoke test
- Files: `src/main/paths.ts` (sample-company location), `src/main/testCompany.ts` (open/write/read + backup-on-close, keeps last 30), IPC wiring in `src/main/index.ts`, `src/preload/*`, `src/renderer/src/App.tsx` (shows the DB path and rows on screen).
- Verified write/read and backup-pruning logic with a standalone script (Electron's GUI can't run headlessly from this automation shell, so this checked the same code path without a window).
- Status: **confirmed** by owner, after pointing her to the exact path (`test-data` sits inside the project code folder, not `Documents\JunoBooks\` — easy to miss since it's git-ignored).
