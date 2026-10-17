# Progress Log

Pointer log only — a few lines per round. Details live in git history. Older rounds (Phases 0–11, build run, R1–R5): `docs/progress-history.md`.

## Current state
- Phases 0–11 built (build run 2026-10-02); owner review ongoing, start with `docs/build-run-changes.md`. No release made since the build run.
- Schema v15, 349 tests, 25 live checks pass. Last feature: Contacts with suppliers (R8).
- Next: C2 supplier bills (enter now, pay later, owed-to-suppliers aging) [Opus], then C3 Supplier box on Expense + spending by supplier [Sonnet]. Later: reading PDFs/photos offline (receipts first).
- Open owner decision: inventory method filed for 2026 (backlog).

## Recent rounds (owner review)
- R6 (owner review, questions about future years, files, scrap gold, sub-accounts, numbers, contacts): Settings now explains tax forms and future years; account form has "Suggest a free number" (under a parent or in the type's range). Files: `shared/accounts.ts`, `accounts.test.ts`, `AccountForm.tsx`, `Settings.tsx`, `ChartOfAccounts.tsx`, `chart-of-accounts.md`, `architecture.md`. Live check `suggestnumber.mjs`. 342 tests. Agreed next: nested sub-accounts to several levels, Contacts (customers, suppliers, refiners, contractors), reading PDFs/photos offline (receipts first). Scrap-gold exchange: no new function wanted for now. Update check on startup stays on (owner).
- R7: nested sub-accounts up to 5 levels (no loops; moving an account moves its branch); chart and form indent per level; reports total at every level; Etsy/Amazon fee accounts still go under 6100 when it is itself a sub-account. No schema change. Files: `shared/accounts.ts`, `main/accounts.ts`, `main/reports.ts`, `ChartOfAccounts.tsx`, `AccountForm.tsx`, `subAccounts.test.ts`, `chart-of-accounts.md`. Live check `subaccounts.mjs` extended; all 24 live checks pass. 344 tests.
- R8 (C1, owner approved; owner buys on account): schema v15 `suppliers`; Contacts screen (home → Buy): suppliers added/edited there (kind incl. refiner or metal dealer, contact person, account number, payment terms, usual account), customers and contractors listed alongside with links to their own screens; filters, find, inactive. Files: `migrations.ts`, `shared/contacts.ts`, `main/contacts.ts` (+test), `companyStore.ts`, `index.ts`, preload, `Contacts.tsx`, `CompanyHome.tsx`, styles. New topic doc `contacts.md`. Live check `contacts.mjs`; all 25 pass. 349 tests. Next: C2 supplier bills (enter now, pay later, owed-to-suppliers aging), C3 Supplier box on Expense + spending by supplier.
