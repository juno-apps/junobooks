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

## Round 17 — Phase 2 plan
- Plan approved: 2a journal entry screen · 2b transaction list (void, reverse, duplicate) · 2c Expense/Income/Transfer screens · 2d account register · 2e opening balances · 2f receipts (schema v6) · 2g move packaged data to `Documents\JunoBooks` + Settings (after the Phase 2 checkpoint).
- Sub-accounts stay parked until Phase 9 (Reports).

## Round 18 — Unit 2a: journal entry screen
- Journal entry screen (account picker, auto-added rows, fill-the-difference, live totals, Enter posts); manual entries can't predate the books start.
- Files: `shared/journal.ts` (+test), `renderer/JournalEntry.tsx`, `CompanyHome.tsx`, `styles.css`, `companyStore.ts` (+test), IPC/preload. New topic doc `manual-entry.md`. No schema change. 185 tests pass. Status: **confirmed** by owner.

## Round 19 — Unit 2b: transaction list
- Transactions / Chart of accounts tabs; transaction list with Duplicate, Void, Reverse; two-line entries keep balancing when line 1's amount changes (fixes duplicate + edit). Backlog: bank-import matching, cleared status + reconciliation.
- Files: `main/entries.ts`, `TransactionList.tsx`, `JournalEntry.tsx`, `CompanyHome.tsx`, `shared/journal.ts` (+test), `companyStore.ts` (+test), IPC/preload, styles. No schema change. 191 tests pass. Status: **confirmed** by owner.

## Round 20 — Unit 2c step 1: Expense screen
- New expense screen (splits, grouped account lists), reusable type-to-narrow account box that only accepts real accounts.
- Files: `shared/everyday.ts` (+test), `ExpenseEntry.tsx`, `AccountCombobox.tsx`, `CompanyHome.tsx`, styles. No schema change. 197 tests pass. Status: **confirmed** by owner.

## Round 21 — Unit 2c step 2: Income screen
- New income screen (deposit-to, kind of income incl. sales tax collected, splits, unpaid invoice via accounts receivable). Expense and Income share `SimpleEntry.tsx` and one builder.
- Files: `shared/everyday.ts` (+test), `SimpleEntry.tsx` (was `ExpenseEntry.tsx`), `CompanyHome.tsx`. No schema change. 201 tests pass. Status: **confirmed** by owner.

## Round 22 — Unit 2c step 3: Transfer screen + live-check permission
- Transfer screen built; end-to-end test of Income/Expense/Transfer through the real books; zero credit balances no longer stored as "-0" (`chart.ts`). Claude live-checked Transfer in the running app (income, transfer, refusal, Swap, balances all right). 205 tests pass.
- Owner decision: standing full access for live checks in every session until they say to revert (`CLAUDE.md` §9, `docs/topics/live-checks.md`).
- Files: `shared/everyday.ts` (+test), `TransferEntry.tsx`, `CompanyHome.tsx`, `main/chart.ts`, `companyStore.test.ts`, docs. No schema change.
- Status: Transfer awaiting the owner's own confirmation (committed as a savepoint).
- (Round 22 polish ideas were approved and built in the build run.)

## Round 23 — Build run agreed (not started)
- Owner approved an autonomous build run through Phase 11 (rules in `CLAUDE.md` §10): no checkpoint stops, Opus throughout, live checks via Playwright, commits/pushes without asking, no releases, owner-only choices parked in backlog under "Needs owner decision", final list in `docs/build-run-changes.md`.
- Owner approved allowing web search/fetch and deletes inside the project/scratch folder; the settings edit is done by the owner (Claude can't edit its own permissions).
- Round 22 polish ideas (1)–(3) approved; Transfer treated as done, pending owner review.

## Build run (started 2026-10-02; status of every unit: verified by Claude, owner review pending)
- Remaining Phase 2 plan: 2d register · 2e opening balances · 2f receipts (schema v6) · 2g data to `Documents\JunoBooks` + Settings. Then Phases 3–11 per `JunoBooks-PLAN.md` §8.
- B1: Playwright live checks set up (`scripts/live/`, data in `test-data\live` via `JUNOBOOKS_DATA_ROOT`); `live-checks.md` rewritten.
- B2: round-22 polish: red error clears once fixed (`useFormError.ts`, all four entry screens), wider account lists, empty Transactions text names all four buttons. Live check `polish.mjs`. 205 tests.
- B3 (2d): account register: click an account on the chart; running balance, date range with balance forward, voided on request, column names fit the account. Files: `main/register.ts` (+test), `shared/register.ts`, `AccountRegister.tsx`, `ChartOfAccounts.tsx`, IPC/preload. Live check `register.mjs`. 209 tests.
- B4 (2e): opening balances screen: one entry on the books start date, difference to Opening balance equity with an accountant note; re-saving voids and replaces. Files: `main/openingBalances.ts` (+test), `shared/opening.ts`, `OpeningBalances.tsx`, `CompanyHome.tsx`, IPC/preload. Live check `opening.mjs`. 214 tests.
- B5 (2f): receipts, schema v6 (`attachments`, no erasing, audited): attach by picker, drag-drop or right after posting; copied as `receipts\\<year>\\date_vendor_amount.ext`; open / show in folder / remove (kept, file moved to `_removed`); 📎 on list rows. Files: `migrations.ts`, `main/attachments.ts` (+test), `shared/attachments.ts`, `Receipts.tsx`, entry screens, `TransactionList.tsx`, `entries.ts`, IPC/preload (`webUtils` for drops). Live check `receipts.mjs`. 220 tests.
- **Resume point:** 2g (data folder to `Documents\\JunoBooks` + Settings) next.
