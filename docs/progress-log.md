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
- Files: `src/main/index.ts` (calls `autoUpdater.checkForUpdatesAndNotify()` on startup, packaged builds only). Version bumped to 0.0.2, then 0.0.3.
- Fixed along the way: GitHub Releases were publishing as drafts (invisible to the public update check). First attempt used `"draft": false`, which isn't a real electron-builder option and broke the whole `publish` config (confusing wall of schema errors in CI) — correct fix is `"releaseType": "release"`.
- Sequencing note: v0.0.1 predates the update-check code, so it could never have offered an update — owner installed v0.0.2 (which has the code) so it can check for a newer release.
- v0.0.3's build failed (see fix above); skipped straight to v0.0.4 rather than delete/retry the v0.0.3 tag (tag deletion is blocked by the auto-mode safety classifier as a destructive git action).
- Status: **confirmed** — installed v0.0.2 showed the update popup, installed v0.0.4 on exit, and reopened at v0.0.4.

## Round 6 — Unit 0e: docs, Phase 0 complete
- Added `docs/topics/README.md` and `docs/handoffs/README.md` explaining when files land in each folder.
- **Phase 0 done.** JunoBooks installs from GitHub, opens, and updates itself. Good point to start a fresh session before Phase 1 (Foundation: companies, entities, templates, chart of accounts, ledger engine).

## Round 7 — Phase 1 plan proposed; backlog added
- Proposed Phase 1 units 1a–1f (company manager, schema/migrations, ledger engine, templates/CoA, classification history, docs). Awaiting owner OK.
- Added `docs/backlog.md` and a "backlog:" rule in `CLAUDE.md` §5.
- Owner confirmed California, but state must be switchable per company and sales tax rates must be adjustable with effective dates. Recorded in `architecture.md` "Agreed design rules."
- Owner approved the Phase 1 plan and the "flag judgment calls for the accountant" approach.

## Round 8 — Unit 1a: company manager
- Files: `src/main/{index,paths,appSettings,companyStore}.ts`, `src/main/db/migrations.ts` (schema v1), `src/shared/*`, `src/preload/*`, `src/renderer/src/{App,CompanyPicker,NewCompanyForm,CompanyHome}.tsx`, `styles.css`, `scripts/run-tests.cjs`, `companyStore.test.ts`. Removed `testCompany.ts`.
- Migration runner pulled forward from 1b (needed to store the company profile). Tests run inside Electron's Node.
- 14 tests pass; typecheck and build clean.
- Status: **confirmed** by owner.

## Round 9 — Unit 1b: core schema + audit log
- Files: `src/main/db/migrations.ts` (v2: accounts, journal entries/lines, audit log, integrity triggers), `src/main/db/schema.test.ts`.
- Rules live in the database (triggers), not just code. The "who" in the audit log is implied (one user per PC); no user column.
- 31 tests pass; typecheck and build clean.
- Status: **confirmed** by owner.

## Round 10 — Unit 1c: ledger engine
- Owner chose "reopen allowed, with a reason" for period locks.
- Files: `src/main/ledger.ts`, `src/shared/money.ts`, `src/main/db/migrations.ts` (v3: period lock history, one-live-reversal index), tests `ledger.test.ts`, `money.test.ts`.
- Not wired to any screen yet (first use: chart of accounts in 1d).
- 78 tests pass; typecheck and build clean.
- Status: **confirmed** by owner.

## Round 11 — Unit 1d: templates, tax lines, chart of accounts
- Remaining Phase 1 re-split: 1e account editing, 1f entity/state changes + settings, 1g docs + data-folder switch.
- Checked every tax line against the 2025 IRS PDFs (Sch C, 1065, 1120-S, 1120, 1125-A). 2026 forms not yet published, so 2026 uses the 2025 table.
- Files: `src/shared/{taxLines,templates,chart}.ts`, `src/main/chart.ts`, migrations v4, `companyStore.ts`, IPC/preload, `ChartOfAccounts.tsx`, `TemplatePicker.tsx`, `CompanyHome.tsx`, `NewCompanyForm.tsx`, styles, `chart.test.ts`, new `docs/topics/chart-of-accounts.md`.
- 119 tests pass; typecheck and build clean.
- Status: **confirmed** by owner.

## Round 12 — Unit 1e: account editing
- Owner decisions: deactivating an account with a non-zero balance is **blocked**; sub-accounts parked in backlog.
- Files: `src/shared/accounts.ts`, `src/main/accounts.ts`, migrations v5 (inactive-account triggers), `ledger.ts` (void refuses inactive accounts), `chart.ts` (usage flags, description), `companyStore.ts`, IPC/preload, `AccountForm.tsx`, `ChartOfAccounts.tsx`, styles, `accounts.test.ts`, topic doc.
- Found for 1f: `applyChart` matches by number, so re-applying would bring back renumbered/deleted template accounts.
- 139 tests pass; typecheck and build clean.
- Status: **confirmed** by owner (the "1500" check in my test list clashed with Equipment; the duplicate-number block worked as intended).

## Round 13 — Unit 1f, step 1: entity-type change
- Owner decisions: start date can't be before the books start or inside a locked period; added "Correct starting type" (refused if books are closed through the start date).
- Files: `src/main/companyHistory.ts`, `src/shared/company.ts` (`validateHistoryChange`), `entities.ts` (accountant note), `companyStore.ts`, IPC/preload, `EntityTypeChange.tsx`, `CompanyHome.tsx`, `companyHistory.test.ts`. No schema change.
- 156 tests pass; typecheck clean.
- Status: **confirmed** by owner. Next: step 2 (add accounts new to the entity type), step 3 (home state change).

## Round 14 — Unit 1f, step 2: chart follows entity changes
- Owner testing found gaps, so also built: restore missing standard accounts, remove an entity-type change, list what was skipped, clearer green result box.
- Files: `src/main/chart.ts` (`placeAccounts`, `addEntityAccounts`, `missingAccounts`, `restoreAccounts`), `companyHistory.ts` (`removeEntityTypeChange`, chart update in same transaction), `companyStore.ts`, IPC/preload, `EntityTypeChange.tsx`, `ChartOfAccounts.tsx`, `CompanyHome.tsx`, styles, `shared/{company,chart}.ts`, `companyHistory.test.ts`, topic doc. No schema change.
- 172 tests pass; typecheck clean.
- Status: **confirmed** by owner. Next: step 3 (home state change).
