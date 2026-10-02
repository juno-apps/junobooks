# Build run: what changed

The autonomous build run started on 2026-10-02 and finished Phases 2 to 11. Every unit below was built, tested, checked in the running app by Claude (with Playwright), and committed and pushed to GitHub. **Status of all of it: verified by Claude, owner review pending.** No new installer was released during the run.

At the end: 339 automated tests and 21 click-through live checks, all passing. The database went from schema version 5 to 14 (each step backs up the company file first).

## How to try it
Run `npm start` from the project folder (it uses your test companies in `test-data`), or ask for a release to get an installer. On company home, the buttons are now grouped (Enter, Bring in, Sell and make, Year end) and a summary with a **To do** list sits underneath.

Made-up example files to try the importers are in `samples/` (bank, Etsy, Amazon).

---

## Setup
- **Live checks with Playwright** (dev-only, never shipped): Claude can now click through the real app on its own, using a separate `test-data\live` folder, so your test companies are never touched. `npm run live` runs every check.

## Polish from round 22 (all three you approved)
- A red error message now goes away as soon as you fix what it complained about (on all four entry screens).
- The account drop-down lists are wider, so group headings stay on one line.
- The empty Transactions list now mentions New expense, New income, New transfer and New journal entry.

## Phase 2: manual entry (finished)
- **2d Account register**: click any account on the Chart of accounts tab to see every entry on it with a running balance, a date range with "balance forward", and voided entries on request. Bank accounts say Money in / Money out, cards say Charges / Payments.
- **2e Opening balances**: one screen to enter what each account held when your books start. The difference goes to "Opening balance equity", flagged for your accountant. Saving again replaces the old entry (kept on record as voided).
- **2f Receipts**: attach receipt files to any entry (file picker, drag and drop, or right after posting). Copies are filed as `receipts\<year>\date_vendor_amount.pdf`. Removing one keeps its record. A 📎 shows on entries with receipts.
- **2g Your books' folder**: the installed app now keeps companies in `Documents\JunoBooks`. A **Settings** screen (top right) shows the folder, opens it, and can switch to another folder (it never moves files). Practice companies from earlier test versions are still where they were; Settings points to them.

## Phase 3: bank and card imports
- **3a–3b Import bank file**: choose the account and the CSV download; JunoBooks guesses the columns (date, description, amount or money in/out, date style, and whether a card file shows spending as a plus), shows a preview, and remembers your choices per account. Lines you already imported are skipped, so overlapping downloads are fine. Then **Review imported lines**: pick what each line was for and post it, or ignore it.
- **3c Rules**: "when the description contains RIO GRANDE, use Materials" — make one from any line; matching lines fill in automatically.
- **3d Matching**: if you already typed a payment in by hand (or a card payment came in from the checking side), the imported line offers "Match" instead of posting it twice.
- **3e Reconcile**: check a bank or card account against its statement — tick what cleared until the difference is $0, then finish. Imported lines start ticked. A reconciled entry can't be voided (reverse it instead). Accountant note on payments made in late December that clear in January.

## Phase 4: Etsy
- **Import from Etsy**: the monthly payments statement CSV (plus, optionally, the Sold Orders CSV so shipping is split out of sales). Sales, each kind of fee, Etsy Ads, Offsite Ads, shipping labels, refunds and Etsy-collected sales tax each go to their own account (choices remembered). One entry per day of activity; each deposit becomes a transfer to your bank and matches the bank import. Etsy's accounts are added with one click, with accountant notes. Re-importing a month only adds new rows. A table shows each Etsy deposit as found in the bank, waiting to be matched, or not in the bank yet.

## Phase 5: inventory
- **Inventory** screen: items, material purchases (quantity and cost; the money side is still your expense or bank import), year-end counts with "expected" quantities, and the four methods side by side (periodic count, FIFO, weighted average, expense as purchased). Choosing the filed method for a year records it with history (Form 3115 warning); then one button posts the year-end inventory entry.

## Phase 6: direct sales
- **Invoices** screen: customers (with a wholesale flag and resale certificates on file, with a copy of the certificate), invoices (draft, then finalize; sales tax at a rate on the invoice, skipped automatically for wholesale buyers with a valid certificate), a PDF of each invoice saved in `exports\invoices`, payments received (applied to the oldest invoices first), and "Who owes you" by how late it is.

## Phase 7: Amazon and the 1099-K
- **Import from Amazon**: the settlement report (flat file). Same idea as Etsy: sales, shipping, promotions, refunds, referral and FBA fees, Amazon-collected sales tax, subscription and advertising each to their own account; the payout becomes a transfer to your bank; reserves stay with Amazon.
- **1099-K tie-out**: type box 1a from each 1099-K (Etsy, Amazon, or any payment app) and compare it with what JunoBooks imported, month by month, with the usual reasons for differences.

## Phase 8: sales tax
- **Sales tax** screen: rates are entered with the date they start (old sales keep their old rate); new invoices start with the rate in force on their date. The report for any quarter shows total sales, less marketplace sales, sales for resale (with certificates), other exempt sales and refunds, the taxable amount, tax at the rates versus tax you actually charged, and what's owed. **Record a sales tax payment** moves it out of the bank.

## Phase 9: reports
- **Reports** screen: profit & loss (with month columns), balance sheet, trial balance, general ledger, sales by channel, tax-line summary (grouped by the line on your return), cost of goods sold (Schedule C Part III layout), and inventory methods. Every report has **Open in Excel** and **Save as CSV**.
- **Year-end records**: contractors and the 1099-NEC list (card payments left out; the 2026 threshold is $2,000), fixed assets, a mileage log, and home office details (simplified and regular methods shown).
- **Sub-accounts** (from the backlog): put an account under another (e.g. "Etsy fees" under "Commissions and fees"); the chart and reports show them indented with a subtotal. Etsy and Amazon fee accounts are placed this way automatically.

## Phase 10: accountant package
- **Accountant package**: first a list of notes and things to check for the year (accounts with accountant notes, inventory method not chosen, 1099-K differences, contractors without a W-9, accounts not reconciled, and more). Then one click builds `exports\Accountant package <year>.zip` with an Excel workbook (18 tabs), a PDF summary with the notes, the general ledger and transactions as CSV, the inventory count sheet, the fixed-asset list, the year's receipts with an index, and your resale certificates.

## Phase 11: polish
- **Close books**: lock the books through a date (end of last month, quarter or year); reopening needs a reason, all kept in a history.
- **Year-end close**: moves the year's income and expenses into equity (Owner's capital by default for your LLC; accountant note) and locks the year. The year's reports still show its activity.
- **Company home**: a one-line company summary (Details for the rest), grouped buttons, and a dashboard: sales, costs and net income so far this year, cash, owed to you, you owe, and a To do list that opens the right screen.

---

## Parked (in `docs/backlog.md`) and why
- **Needs owner decision — inventory method filed for 2026**: periodic count, FIFO, weighted average, or expense as purchased. This is your accountant's call; the app shows all four and posts nothing until one is chosen.
- **Test with real files**: bank/card downloads (Phase 3), Etsy statement and Sold Orders (Phase 4), and an Amazon settlement report (Phase 7) were built from published layouts and made-up samples. Anything Etsy or Amazon words differently shows up as "Other … activity" so nothing is lost, but real files may need small adjustments.

## Things for you to try first
1. On a test company: **Opening balances**, then a few **New expense / New income** entries, then the account **register** (click an account on the Chart of accounts tab).
2. **Import bank file** with one of your real bank downloads (on a test company), then **Review imported lines** and make a **rule**.
3. **Import from Etsy** with a real monthly statement and Sold Orders file; check the totals against Etsy's own statement page.
4. Make an **invoice** for a wholesale customer with a resale certificate and open the PDF.
5. Look through **Reports** and build an **Accountant package** for 2026 to see what your accountant would get.
6. Tell me anything that reads oddly or feels slow; small wording and layout fixes are quick.

## Suggested next step
Make a release (a new version tag) so the installed app gets all of this. The installed app will start with an empty `Documents\JunoBooks` folder, which is where your real books would go once you're happy with testing.
