# Reports

Company home → **Reports**. Code: `src/main/reports.ts` (computations), `src/shared/reports.ts` (shapes, CSV helpers), screens `Reports.tsx` (tabs, period picker, CSV buttons) and `ReportsExtra.tsx` (year-end detail reports). Every report uses posted entries only (voided entries never count).

## Period picker
From/To dates (or "As of" for balance reports), with quick links for each year since the books start ("End of YYYY" for as-of reports) and this year's quarters.

## Financial reports
- **Profit & loss** (`profitAndLoss`): Income (income accounts, credit side positive; contra accounts like Refunds and returns show negative), Cost of goods sold (expense accounts with the COGS subtype), Gross profit, Expenses, Net income. Accounts with nothing in the period are left out. "Show each month" adds a column per month plus Total.
- **Balance sheet** (`balanceSheet`): Assets, Liabilities, Equity as of a date, plus "Profit this year (not yet closed into equity)" (since January 1) and "Profit from earlier years (not yet closed into equity)" until a year-end close exists. Shows "Balanced" when assets = liabilities + equity + profit.
- **Trial balance** (`trialBalance`): every account with a balance as of a date in Debit or Credit, with equal totals.
- **General ledger** (`generalLedger`): each account with activity in the period (or a balance at its start): opening balance, every line (date, entry, description, other side, debit, credit, running balance on the account's normal side), closing balance. Built from the account register.

## Year-end detail reports (`src/main/reportsExtra.ts`, `ReportsExtra.tsx`)
- **Sales by channel** (period): credits to gross-receipts accounts and debits to returns accounts, grouped by where the entry came from: Etsy, Amazon, Invoices (direct sales), Bank and card imports, Typed in (New income, journal entries). Sales include shipping charged; refunds include marketplace promotions.
- **Tax-line summary** (year): for the entity's federal form in force at year end (line numbers from the IRS table year shown), each line with its accounts and amounts (income and expenses for the year; balance-sheet lines as of Dec 31) and their accountant notes. Accounts without a tax category are listed in red as not mapped. Accountant note: a starting point, not the final figures.
- **Cost of goods sold** (year; Schedule C Part III layout): beginning inventory (inventory accounts before the year plus opening balances), purchases (COGS purchases accounts plus stock bought straight into inventory accounts), labor, materials and supplies, other costs, subtotal, ending inventory (inventory accounts at Dec 31), cost of goods sold (equals the profit & loss figure). Notes the filed inventory method and whether the year-end inventory entry is posted.
- **Inventory methods** (year): the four methods side by side (same as the Inventory screen), with the filed one marked and items not counted at year end.
- The period picker and CSV buttons live in `ReportBits.tsx`.

## Saving
Every report has **Open in Excel** and **Save as CSV**: the report is written to `<company>\exports\reports\<report name and dates>.csv` (UTF-8 with BOM so Excel reads it; amounts as plain numbers like 1234.56). Open in Excel also opens the file.
