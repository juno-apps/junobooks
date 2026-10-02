# Reports

Company home → **Reports**. Code: `src/main/reports.ts` (computations), `src/shared/reports.ts` (shapes, CSV helpers), screens `Reports.tsx` (tabs, period picker, CSV buttons) and `ReportsExtra.tsx` (year-end detail reports). Every report uses posted entries only (voided entries never count).

## Period picker
From/To dates (or "As of" for balance reports), with quick links for each year since the books start ("End of YYYY" for as-of reports) and this year's quarters.

## Financial reports
- **Profit & loss** (`profitAndLoss`): Income (income accounts, credit side positive; contra accounts like Refunds and returns show negative), Cost of goods sold (expense accounts with the COGS subtype), Gross profit, Expenses, Net income. Accounts with nothing in the period are left out. "Show each month" adds a column per month plus Total.
- **Balance sheet** (`balanceSheet`): Assets, Liabilities, Equity as of a date, plus "Profit this year (not yet closed into equity)" (since January 1) and "Profit from earlier years (not yet closed into equity)" until a year-end close exists. Shows "Balanced" when assets = liabilities + equity + profit.
- **Trial balance** (`trialBalance`): every account with a balance as of a date in Debit or Credit, with equal totals.
- **General ledger** (`generalLedger`): each account with activity in the period (or a balance at its start): opening balance, every line (date, entry, description, other side, debit, credit, running balance on the account's normal side), closing balance. Built from the account register.

## Saving
Every report has **Open in Excel** and **Save as CSV**: the report is written to `<company>\exports\reports\<report name and dates>.csv` (UTF-8 with BOM so Excel reads it; amounts as plain numbers like 1234.56). Open in Excel also opens the file.
