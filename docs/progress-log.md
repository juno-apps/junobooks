# Progress Log

Pointer log only — a few lines per round. Details live in git history.

## Rounds 1–6 — Phase 0 (scaffold, pipeline)
- 1: plan agreed (Electron + React + TypeScript, SQLite, NSIS installer via GitHub Actions, electron-updater). 2 (0a): scaffold. 3 (0b): database smoke test. 4 (0c): GitHub repo `juno-apps/junobooks`, installer published. 5 (0d): auto-update confirmed (v0.0.4; use `"releaseType": "release"`, not `"draft"`). 6 (0e): topic/handoff folder READMEs.
- Status: **Phase 0 confirmed.** Tag deletion is blocked by the safety classifier, so a failed release tag is skipped, not retried.

## Rounds 7–12 — Phase 1 (foundation)
- 7: Phase 1 plan approved; California default, state switchable with effective dates; sales tax rates are dated data; judgment calls flagged for the accountant; backlog file added.
- 8 (1a): company manager, migration runner, schema v1. 14 tests.
- 9 (1b): schema v2 (accounts, journal, audit log, triggers). 31 tests.
- 10 (1c): ledger engine, period lock ("reopen allowed, with a reason"), schema v3. 78 tests.
- 11 (1d): templates, tax lines (checked against 2025 IRS PDFs), chart screen, schema v4. 119 tests.
- 12 (1e): add/edit/deactivate/delete accounts (deactivating a non-zero balance is blocked), schema v5. 139 tests.
- Status: all **confirmed** by owner.

## Rounds 13–15 — Unit 1f: entity-type and home-state changes
- Owner decisions: a start date can't be before the books start or inside a locked period; added "Correct starting type/state", "Remove a change", restore-missing-accounts, "what was skipped" in the result box, clearer green box.
- 13 (step 1): entity-type change with start date, `companyHistory.ts`, `EntityTypeChange.tsx`. 14 (step 2): chart follows entity changes (`placeAccounts`, `addEntityAccounts`, `missingAccounts`, `restoreAccounts` in `chart.ts`). 15 (step 3): home-state change; both share one set of rules; history list now refreshes after save.
- Owner rule added to `CLAUDE.md` §6: after a model-switch suggestion, don't start until the switch is confirmed.
- No schema change. 177 tests pass. Status: **confirmed** by owner.

## Round 16 — Unit 1g: docs, Phase 1 complete
- Decision: packaged builds move to `Documents\JunoBooks` right after the Phase 2 checkpoint (with a Settings screen to choose the folder), not before.
- Docs pass: fixed stale lines in `architecture.md`, removed the finished Phase 1 plan list, condensed old log entries.
- **Phase 1 done.** Good time to start a fresh session before Phase 2 (manual entry).
