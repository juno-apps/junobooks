# Folder layout

Where the code and data live. Read when adding a file or looking for one.

```
JunoBooks-code/
  src/
    main/              Electron main process
      index.ts         Window, IPC handlers, the one open company
      paths.ts         Data root (installed vs development copy, Settings choice)
      dataLocation.ts  Data-folder pointer file and folder checks (no Electron imports)
      appSettings.ts   Per-PC prefs in the data root (app-settings.json: last opened company)
      companyStore.ts  Create / list / open companies, backups (no Electron imports, so testable)
      ledger.ts        Ledger engine: post / void / reverse entries, period lock, balances
      chart.ts         Apply a template's accounts; build the chart-of-accounts view
      accounts.ts      Add / edit / deactivate / delete accounts
      companyHistory.ts  Entity-type and home-state history: add / remove a change, correct the starting value
      entries.ts       Read-only entry list for the screens (writing stays in ledger.ts)
      register.ts      Read-only account register (lines + running balance)
      openingBalances.ts  Opening balances: read, and replace (void old + post new)
      attachments.ts   Receipt files: copy into receipts\<year>\, list, remove (kept on record)
      bankImport.ts    Bank/card CSV imports: read file, stage lines, review, post, ignore
      rules.ts         Categorization rules: list, add, edit, delete, matcher
      reconcile.ts     Cleared status and reconciliations (start, tick, finish, cancel, undo)
      etsyImport.ts    Etsy statement imports: accounts setup, preview, posting, payouts tie-out
      inventory.ts     Inventory facts: items, purchases, counts, filed method per year
      inventoryReport.ts  Inventory year report (four methods) and the year-end entry
      sales.ts         Customers, resale certificates, invoices, payments received, aging
      amazonImport.ts  Amazon settlement imports (and the shared add-channel-accounts helper)
      form1099k.ts     1099-K tie-out per year and platform
      salesTax.ts      Sales tax rates (dated), period report, recording a payment
      reports.ts       Profit & loss, balance sheet, trial balance, general ledger
      reportsExtra.ts  Sales by channel, tax-line summary, cost of goods sold schedule
      records.ts       Contractors + 1099-NEC list, fixed assets, mileage log, home office
      contacts.ts      Suppliers and the combined Contacts list
      accountantNotes.ts  Notes and checks for the accountant for a year
      accountantPackage.ts  Year-end ZIP: Excel workbook, CSVs, receipts (exceljs, jszip)
      closing.ts       Close books through a date; year-end closing entry
      dashboard.ts     Company home summary and to-do list
      db/migrations.ts Numbered schema migrations
    preload/           contextBridge API exposed to the renderer as window.juno
    renderer/src/      React screens (App, CompanyPicker, NewCompanyForm, CompanyHome, ChartOfAccounts, AccountForm, TemplatePicker, EntityTypeChange, HomeStateChange, JournalEntry, TransactionList, SimpleEntry, TransferEntry, AccountCombobox, AccountRegister, OpeningBalances, Receipts, Settings, ImportWizard, BankReview, RulesManager, Reconcile, EtsyImport, AmazonImport, Form1099K, Inventory, Sales, SalesTax, Reports, ReportsExtra, ReportBits, YearEndRecords, AccountantPackage, CloseBooks, DashboardPanel, Contacts; useFormError hook)
    shared/            Code used by both main and renderer: entity types, US states, dates, money, company validation,
                       templates.ts (starting charts), taxLines.ts (tax categories + per-year line tables), chart.ts (view types),
                       accounts.ts (account input rules: kinds, debit/credit side, validation, number-range warning),
                       journal.ts (entry-screen rows → ledger lines, live totals, two-line balancing, entry list type),
                       everyday.ts (Expense/Income/Transfer screens: account groups, type-to-narrow filter, entry builders),
                       register.ts (register view types, column wording), opening.ts (opening-balance types, difference), settings.ts (Settings view type),
                       attachments.ts (receipt naming, accepted types), csvImport.ts (CSV reading, column guessing, mapping, fingerprints),
                       bankImport.ts (import types, account groups for import screens), rules.ts (rule matching, suggested text),
                       reconcile.ts (reconciliation view types, totals), etsy.ts (Etsy file reading, row kinds, posting plan, Etsy accounts),
                       etsyImport.ts (Etsy import types), inventory.ts (quantities, the four methods), inventoryView.ts (inventory screen types),
                       sales.ts (direct-sales types, tax rates, invoice totals, aging), invoiceHtml.ts (printable invoice),
                       amazon.ts / amazonImport.ts (Amazon settlement reading, kinds, plan, types), form1099k.ts (tie-out types), salesTax.ts (rates in force, quarters, report types),
                       reports.ts (report shapes, CSV helpers), reportsExtra.ts (detail report shapes), records.ts (year-end record types, 1099-NEC threshold, home-office math),
                       pkg.ts (notes and package types), summaryHtml.ts (PDF summary page), closing.ts (closing types), dashboard.ts (home summary type), contacts.ts (suppliers, contact list types)
  scripts/run-tests.cjs
  scripts/live/         Playwright live checks (dev-only; see docs/topics/live-checks.md)
  samples/              Made-up example files (bank CSVs, Etsy statement and orders, Amazon settlement) for trying imports and live checks
  test-data/           Dev data root (git-ignored, never real books)
    app-settings.json
    Companies/<Company Name>/
      books.sqlite
      backups/  receipts/  exports/
  docs/
    architecture.md    Core design doc and doc index
    progress-log.md    Current state + recent rounds
    progress-history.md  Older rounds and per-phase summary (on demand)
    archive/           Copies saved before trims (read only when restoring)
    backlog.md         Parked ideas ("backlog:" messages), reviewed at each phase start
    topics/            One doc per module, read only when a task touches it
    handoffs/          Numbered handoff files, created on request only
```
