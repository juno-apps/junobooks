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

## Round 4 — Unit 0c: GitHub + installer (in progress)
- Owner created GitHub account (username `juno-apps`) and public repo `junobooks`.
- Added `electron-builder` config to `package.json` (NSIS target, GitHub Releases publish target) and `.github/workflows/release.yml` (builds on `windows-latest`, publishes on any `vX.Y.Z` tag push).
- Local `npm run build:win` can't fully complete in this dev environment (a sandboxed permission restriction, unrelated to the app) — the real build runs on GitHub Actions instead.
- Pushed to GitHub, tagged `v0.0.1`, Actions built and published the installer as a GitHub Release.
- Status: **confirmed** — owner downloaded, installed (per-user), and opened it.

## Round 5 — Unit 0d: auto-update
- Files: `src/main/index.ts` (calls `autoUpdater.checkForUpdatesAndNotify()` on startup, packaged builds only). Version bumped to 0.0.2.
- Status: not yet confirmed — need to push, tag `v0.0.2`, and have owner relaunch her installed 0.0.1 app to see the update offer.
