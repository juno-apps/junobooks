# Handoff (current state, rewritten each wrap-up)

## Status
- Build run done (Phases 0–11); owner review ongoing. Schema v15, 349 tests, 25 live checks pass.
- Last feature: Contacts screen with suppliers (R8). Details in `docs/progress-log.md`.
- Latest commit: project settings (Finance plugin enabled for this project, `.claude/settings.json` now kept in Git).
- `main` is 12 commits ahead of `origin/main`. Not pushed: the auto-mode check blocked `git push`; owner runs it or adds a permission rule.

## Done this session
- Loaded spc-picker and lean-project-memory skills.
- Picked this project's plugins; installed Finance (project scope, from `knowledge-work-plugins`).
- `.gitignore` now keeps `.claude/settings.json`; `CLAUDE.md` §10 points to it.

## Next steps
1. [Opus] C2 supplier bills: enter now, pay later, owed-to-suppliers aging (schema change + ledger; plan first, wait for OK).
2. [Sonnet] C3 Supplier box on the Expense screen + spending by supplier.
3. [Sonnet] Owner decision still open: inventory method filed for 2026 (backlog).
4. [Sonnet] Agreed later: read PDFs/photos offline (receipts first).

## Blockers and notes
- Finance plugin's BigQuery connector fails to connect; not needed, ignore or decline.
- Handoff rule in `CLAUDE.md` §4 (numbered files, only on "create new handoff") still stands; this file is a short working note, not a numbered handoff.
- Start next session by reading `docs/progress-log.md` and `docs/architecture.md`, then this file.
