# Chart of accounts

How starting charts, tax-line mapping, and the chart screen work. Code: `src/shared/templates.ts`, `src/shared/taxLines.ts`, `src/main/chart.ts`, `src/renderer/src/ChartOfAccounts.tsx`.

## Building a chart
Chart = **common accounts** + **industry template extras** + **entity-type accounts** (`buildChart(template, entity)`), sorted by number.

Numbering: 1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income · 5xxx cost of goods sold (type `expense`, subtype `cogs`) · 6xxx expenses.

| Template | Adds |
|---|---|
| General | nothing beyond the common set |
| Product / manufacturing | Inventory: raw materials, Inventory: finished goods, Materials, Production labor, Outside production services, Packaging |
| Retail / resale | Inventory: merchandise, Merchandise purchases, Freight in, Packaging |
| Service | Professional development, Dues and memberships |

| Entity type | Adds |
|---|---|
| Sole proprietor, Single-member LLC | Owner's capital, Owner contributions, Owner draws |
| Multi-member LLC, Partnership | Loans from partners, Partners' capital, Partner contributions, Partner distributions, Guaranteed payments |
| S-corp, LLC taxed as S-corp | Loans from shareholders, Common stock (Members' capital for the LLC), APIC, Retained earnings, Shareholder distributions, payroll set |
| C-corp | Same corporate equity + Dividends paid, Income taxes payable, Federal income tax, payroll set |

Payroll set: Payroll liabilities, Officer compensation, Wages, Payroll taxes.

`applyChart` inserts only account numbers that don't exist yet (the owner's own accounts always win) and records the template on `company_profile`. Re-running it for a new entity type (unit 1f) adds just the missing accounts.

## Normal balance
Stored per account. Assets/expenses are debit-normal; liabilities/equity/income are credit-normal. Contra accounts flip it: Accumulated depreciation (credit), Refunds and returns (debit), Owner draws / distributions / dividends (debit). The chart screen shows balances on the normal side (positive = normal; negative in red = unusual).

## Tax-line mapping
- Each account has one stable **tax category** (`TaxCategoryKey`, e.g. `advertising`, `cogs_materials`, `cash`). Each category belongs to one account type (a test enforces the match).
- `TAX_LINE_TABLES` holds one table per IRS form year: category → `{ ref, label }` for each of Schedule C, 1065, 1120-S, 1120. `ref: null` means "not on this form", and the label says why (e.g. Schedule C has no balance sheet).
- `taxTableFor(year)` uses that year's table, else the latest earlier one, else the earliest. There is only a **2025** table (checked against the 2025 IRS PDFs: Sch C, 1065, 1120-S, 1120, and 1125-A Rev. 11-2024). When the IRS changes line numbers, add a new year's table; accounts and older years don't change.
- Entity returns use Form 1125-A for cost of goods sold; materials go to its line 2 (Purchases).
- The chart screen shows lines for the company's **current** return (today's entity type) and says which form year the numbers come from.

## Accountant notes
`accountant_note` on an account marks a judgment call. It shows as "⚑ Check with your accountant: …" under the account name, and will feed the accountant package's "Notes for accountant" page. Current notes: shipping income as gross receipts · marketplace fees → Commissions and fees · meals 50% · small tools under the de minimis safe harbor · inventory method pending · materials line on Sch C vs 1125-A · packaging as cost of goods sold · postage/shipping expense line · everything mapped to "Other expenses" (a test enforces this) · interest income reported separately · officer reasonable compensation · LLC-as-S-corp "Members' capital" presentation · opening balance equity should end at zero · one set of partner accounts · C-corp income tax not deductible.
