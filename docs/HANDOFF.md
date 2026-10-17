# Handoff (current state, rewritten each wrap-up)

## Status
- Build run done (Phases 0–11); owner review ongoing. Schema v15, 349 tests, 25 live checks pass.
- Last feature: Contacts screen with suppliers (R8). Details in `docs/progress-log.md`.
- Git: clean, `main` in sync with `origin/main` (latest `e4f8705`). Use the PowerShell tool for git.
- Project plugin picks: Finance plugin in `.claude/settings.json`; `CLAUDE.md` §10–11 hold the pointer and the Memory map.

## Done this session
- Loaded spc-picker and lean-project-memory (newer versions); merged Memory map and session rules into `CLAUDE.md` §11.
- Installed Finance plugin (project scope); `.gitignore` keeps `.claude/settings.json`.
- Committed and pushed 13 commits to GitHub.
- Lossless trim done (owner said yes): old rounds and phase status → `docs/progress-history.md`, folder tree → `docs/topics/folder-layout.md`, copies in `docs/archive/`. Not committed.

## Next steps
1. [Opus] C2 supplier bills: enter now, pay later, owed-to-suppliers aging (schema change + ledger; plan first, wait for OK).
2. [Sonnet] C3 Supplier box on the Expense screen + spending by supplier.
3. [Sonnet] Owner decision still open: inventory method filed for 2026 (backlog).
4. [Sonnet] Agreed later: read PDFs/photos offline (receipts first).

## Blockers and notes
- Session start now reads about 275 lines (was about 440).
- Finance plugin's BigQuery connector fails to connect; not needed, ignore or decline.
- `CLAUDE.md` §4 still rules: numbered handoffs only on "create new handoff"; this file is a short working note.
- Optional, not done: PowerShell git allow rules in `.claude/settings.local.json`; PC safety rules in user settings (see spc-picker).

Deep trim: 2026-10-16 | wrap-ups since: 0
