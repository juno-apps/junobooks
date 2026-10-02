# Reports

Company home → **Reports**. Code: `src/main/reports.ts` (computations), `src/shared/reports.ts` (shapes, CSV helpers), screens `Reports.tsx` (tabs, period picker, CSV buttons) and `ReportsExtra.tsx` (year-end detail reports). Every report uses posted entries only (voided entries never count).

## Period picker
From/To dates (or "As of" for balance reports), with quick links for each year since the books start ("End of YYYY" for as-of reports) and this year's quarters.

## Financial reports
- **Profit & loss** (`profitAndLoss`): Income (income accounts, credit side positive; contra accounts like Refunds and returns show negative), Cost of goods sold (expense accounts with the COGS subtype), Gross profit, Expenses, Net income. Accounts with nothing in the period are left out. Sub-accounts appear indented under their parent with a "Total <parent>" line (see `chart-of-accounts.md`). "Show each month" adds a column per month plus Total.
- **Balance sheet** (`balanceSheet`): Assets, Liabilities, Equity as of a date, plus "Profit this year (not yet closed into equity)" (since January 1) and "Profit from earlier years (not yet closed into equity)" until a year-end close exists. Shows "Balanced" when assets = liabilities + equity + profit.
- **Trial balance** (`trialBalance`): every account with a balance as of a date in Debit or Credit, with equal totals.
- **General ledger** (`generalLedger`): each account with activity in the period (or a balance at its start): opening balance, every line (date, entry, description, other side, debit, credit, running balance on the account's normal side), closing balance. Built from the account register.

## Year-end detail reports (`src/main/reportsExtra.ts`, `ReportsExtra.tsx`)
- **Sales by channel** (period): credits to gross-receipts accounts and debits to returns accounts, grouped by where the entry came from: Etsy, Amazon, Invoices (direct sales), Bank and card imports, Typed in (New income, journal entries). Sales include shipping charged; refunds include marketplace promotions.
- **Tax-line summary** (year): for the entity's federal form in force at year end (line numbers from the IRS table year shown), each line with its accounts and amounts (income and expenses for the year; balance-sheet lines as of Dec 31) and their accountant notes. Accounts without a tax category are listed in red as not mapped. Accountant note: a starting point, not the final figures.
- **Cost of goods sold** (year; Schedule C Part III layout): beginning inventory (inventory accounts before the year plus opening balances), purchases (COGS purchases accounts plus stock bought straight into inventory accounts), labor, materials and supplies, other costs, subtotal, ending inventory (inventory accounts at Dec 31), cost of goods sold (equals the profit & loss figure). Notes the filed inventory method and whether the year-end inventory entry is posted.
- **Inventory methods** (year): the four methods side by side (same as the Inventory screen), with the filed one marked and items not counted at year end.
- The period picker and CSV buttons live in `ReportBits.tsx`.

## Year-end records (`src/main/records.ts`, `src/shared/records.ts`, `YearEndRecords.tsx`; company home → **Year-end records**; schema v14)
Year picker and four tabs, each with CSV buttons and a "Check with your accountant" note.
- **Contractors (1099-NEC)**: contractors with address, "I have their W-9", the last four digits of their tax ID only (never the full number), and words to find their payments (default: the name). The list for the year totals debits to Contract labor and Legal and professional accounts whose entry or line memo contains those words (longest match wins); payments whose other side is a credit card are shown separately and left out (the card company reports them). "Needs a 1099-NEC" when bank/cash/check payments reach the threshold (`necThresholdCents`: $600 through 2025, $2,000 from 2026). Unmatched contract-labor payments are listed so a contractor can be added.
- **Fixed assets**: name, account (fixed-asset accounts), cost, in-service date, sold/scrapped date, notes. The year's list shows assets in service during the year (new / in use / sold or scrapped) and compares the cost of those in use with the fixed-asset accounts in the books at year end. Depreciation is the accountant's.
- **Mileage**: trips (date, miles to a tenth, business purpose (required), from, to; Remove), the year's total, and the standard rate typed in for the year (¢ per mile) giving miles × rate.
- **Home office**: office and home square feet plus the year's home expenses; shows the office share, the simplified method ($5 per sq ft up to 300 sq ft) and the regular method (share of the expenses).

## Saving
Every report has **Open in Excel** and **Save as CSV**: the report is written to `<company>\exports\reports\<report name and dates>.csv` (UTF-8 with BOM so Excel reads it; amounts as plain numbers like 1234.56). Open in Excel also opens the file.
