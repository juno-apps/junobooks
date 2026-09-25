# JunoBooks — Master Plan

Read this file only when starting a new phase. Day-to-day state lives in `docs/progress-log.md` and `docs/architecture.md`, which Phase 0 creates. If this plan and those docs ever disagree, the docs win.

## 1. What JunoBooks is
A Windows desktop accounting app for small businesses. It is:
- **Offline-first.** Every core feature works without internet.
- **Multi-company.** It works for any industry and any entity type.
- **Built for a year-end accountant package.** Producing that package cleanly is the real goal: every module exists to feed accurate data into it.

**Owner:** not a programmer. She builds entirely by talking to Claude Code (see `CLAUDE.md`).

**First company:**
- Jewelry manufacturer, currently an LLC, possibly electing S-corp later
- Assumed California-based (sales tax filed with the CDTFA); confirm with the owner
- Sales channels: about 90% Etsy, some Amazon, plus a few wholesale and retail orders a year
- Books start this year. She will enter this year's transactions to date by hand.

## 2. Locked decisions
| Topic | Decision |
|---|---|
| Platform | Windows desktop app, installed like any program. No browser. |
| Framework | Electron |
| Database | SQLite (via `better-sqlite3` in the main process). One database file per company. |
| Suggested UI stack | TypeScript + React + Vite. Claude Code may propose alternatives in the Phase 0 plan, and the owner approves. |
| Money | Stored as integer cents. Never use floating-point numbers for money. |
| Multiple PCs | Each PC keeps its **own separate books**. No syncing or file locking between PCs. |
| Online features | Optional, and the app talks to each service directly. No AI or Claude calls inside the app, and no paid services (e.g. bank-feed providers). Every online feature must degrade gracefully when offline. |
| Code hosting | GitHub (the owner is new to it, so walk her through every step) |
| Installer | `electron-builder` NSIS `.exe`, built by GitHub Actions on a Windows runner and published as a GitHub Release |
| Updates | `electron-updater` checks GitHub Releases and offers to update |
| Code signing | Deferred. **Ask the owner when it becomes needed**, and explain it in plain English. |
| Code folder | `Documents\claude\JunoBooks-code` |

## 3. Data layout (on each PC)
```
Documents\JunoBooks\                 (configurable in Settings)
  Companies\
    <Company Name>\
      books.sqlite
      receipts\<year>\               (named date_vendor_amount.ext)
      backups\                       (auto copy on close, keep 30)
      exports\                       (accountant packages)
```
Development and testing use a separate test data folder containing sample companies. Never touch real company data unless the owner explicitly asks.

## 4. Accounting core (non-negotiable)
- **Double-entry.** Every journal entry's lines must sum to zero, enforced in code and in the database.
- **Friendly screens on top.** The user sees plain screens ("Sale," "Expense," "Material purchase," "Transfer"). Each one posts balanced journal entries underneath.
- **Tax-line mapping.** The chart of accounts maps each account to tax-form lines for each form (Schedule C, 1065, 1120-S, 1120).
- **Period locking.** A closed month or year cannot be changed.
- **No hard deletes of posted entries.** Mistakes are fixed by voiding or reversing, and every action goes in an audit log.
- **Receipts.** Any transaction can have receipt files attached.
- **Accountant decides judgment calls.** Tax and accounting judgment calls are flagged for the accountant, never decided silently by the app.

## 5. Companies and entity types
- A company switcher is the app's top level.
- **Entity types:** sole proprietor, single-member LLC, multi-member LLC, LLC taxed as S-corp, S-corp, C-corp, partnership.
- **Classification changes:**
  - Tax-classification history is stored with **effective dates**, e.g. LLC → S-corp starting Jan 1.
  - The classification in force on a given date drives the equity accounts: owner draws vs. shareholder distributions and officer payroll.
  - It also drives the tax-form mapping for that period.
  - Earlier periods stay intact.
- **Industry templates** supply a starting chart of accounts and turn optional modules on or off. Templates: general, product/manufacturing, retail, service.

## 6. Inventory (simple approach)
- **What's recorded:** material purchases (item, quantity, unit, cost) and periodic physical counts. No per-design recipes or bills of materials for now.
- **Methods are reporting views over the same facts.** They can be switched at any time, even mid-year, and switching never rewrites the ledger. Methods:
  - Periodic count (beginning + purchases − ending = cost of goods sold)
  - FIFO
  - Weighted average
  - Expense as purchased (small-business materials treatment)
- **One "filed" method per company per year** drives the official books and the accountant package. The other methods produce side-by-side what-if reports.
- **In-app warning:** changing the filed tax method generally needs IRS consent (Form 3115), so the accountant should confirm before any change.

## 7. Modules
- **A. Foundation:** companies, entities, templates, chart of accounts, ledger engine, settings, backups.
- **B. Manual entry:**
  - Fast, keyboard-friendly entry screen
  - Split transactions, duplicate-last-entry, receipt attachments
  - Opening balances
- **C. Bank and credit card imports:**
  - CSV import with a column-mapping wizard
  - Auto-categorization rules (e.g. "Rio Grande" → materials)
  - Duplicate detection
- **D. Etsy importer:**
  - Imports the monthly Etsy CSVs
  - Splits each order into gross sale, shipping collected, and marketplace-collected sales tax
  - Splits each fee type: listing, transaction, processing, offsite ads, shipping labels
  - Matches each payout to its bank deposit
- **E. Inventory:** as described in §6.
- **F. Direct sales:** customers, invoices, payments received, accounts receivable, and resale certificates on file for wholesale buyers.
- **G. Amazon importer:** settlement reports, split the same way as Etsy, plus the 1099-K tie-out.
- **H. Sales tax:**
  - Separates marketplace-collected sales from sales where the business owes the tax
  - Lists wholesale sales exempted by resale certificates
  - Produces a report for the CDTFA return
- **I. Reports:**
  - Profit & loss, balance sheet, general ledger, trial balance
  - Sales by channel, tax-line summary, cost-of-goods-sold schedule, inventory method comparison
  - 1099-K reconciliation, 1099-NEC contractor list, fixed-asset list, mileage and home-office summary
- **J. Accountant package:** one-click year-end ZIP containing:
  - An Excel workbook (summary tab + one tab per report)
  - General ledger and transaction CSVs
  - A PDF summary
  - The receipts folder
  - An inventory count sheet
  - The fixed-asset list
  - A "notes for accountant" page

**Optional online features, added later:**
- Update check (Phase 0)
- Etsy API order pull, as an alternative to CSV import (needs a free Etsy developer key)
- Gold and silver spot prices, for reference

## 8. Build phases
Each phase is split into small units. After each unit comes a checkpoint the owner tests in the running app.

| Phase | Scope | Checkpoint the owner can see |
|---|---|---|
| **0** | Scaffold + pipeline (see §9) | JunoBooks installs from GitHub, opens, and updates itself |
| 1 | Foundation (Module A) | Create a company, pick an entity type, see its chart of accounts |
| 2 | Manual entry (Module B) | Enter this year's transactions and see balances |
| 3 | Bank and card imports (Module C) | Import a real bank CSV and categorize it |
| 4 | Etsy importer (Module D) | A month of Etsy statements imports and ties to deposits |
| 5 | Inventory (Module E) | Purchases, counts, cost of goods sold by each method |
| 6 | Direct sales (Module F) | Send an invoice, record a payment |
| 7 | Amazon + 1099-K (Module G) | Settlement import; 1099-K ties out |
| 8 | Sales tax (Module H) | Sales tax report for a quarter |
| 9 | Reports (Module I) | Full report set |
| 10 | Accountant package (Module J) | Year-end ZIP |
| 11 | Polish | Year-end close, dashboard, period-lock screens |

## 9. Phase 0 detail (propose a short plan to the owner before building)
- **0a. Local app:**
  - Electron + chosen UI stack scaffolded in the code folder
  - A window titled JunoBooks, with a footer build tag showing version and build date
  - `npm start` runs it
  - `git init`, with a `.gitignore` that excludes `node_modules`, builds, and test data
- **0b. Database smoke test:**
  - Create a test company folder with a `books.sqlite`
  - Write and read one record
  - Automatic backup on close
- **0c. GitHub + installer:**
  - Walk the owner through creating a repository and connecting it
  - A GitHub Actions workflow builds the NSIS installer on `windows-latest` and publishes a Release
  - The owner installs it
- **0d. Auto-update:** publish version 0.0.2 and confirm the installed app offers the update.
- **0e. Docs:** create `docs/progress-log.md`, `docs/architecture.md` (lean core + topic index + a "latest handoff" line), and the `docs/topics/` and `docs/handoffs/` folders.

## 10. Open questions (to confirm with the owner or the accountant)
- Confirm California is the state for sales tax and any state filings.
- Which inventory method will the accountant file with this year?
- Timing of any S-corp election.
- Which banks and credit cards to support first? (Get sample CSVs in Phase 3.)
- Which Etsy CSV exports does the owner have access to? (Get samples in Phase 4.)
