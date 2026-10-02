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

`applyChart` inserts only account numbers that don't exist yet (the owner's own accounts always win) and records the template on `company_profile`. It's used once, when a company is created or first set up.

## Adding accounts after creation
Code: `placeAccounts`, `addEntityAccounts`, `missingAccounts`, `restoreAccounts` in `src/main/chart.ts`. One set of rules decides where each wanted account goes:
- Skipped quietly if an account with the same name exists (renumbered accounts don't return).
- If its number holds an account with the same tax category, that account "covers" it: skipped, and reported (e.g. Owner draws covers Shareholder distributions).
- If its number holds a different kind of account (Owner's capital on 3000), it takes the next free number in the same thousand-range (step 10) and is reported with the number it wanted. No free number → reported as not added.
- Existing accounts are never changed or removed.

**On an entity-type change** (or correcting the starting type): only accounts in the new type's chart that the old type didn't have are considered, so accounts the owner deleted or renumbered from the old type's set don't return. Added right away, even for a future start date. The result box on the change screen lists added, covered and not-added accounts. Old-type accounts (Owner's capital) stay; moving equity over is flagged for the accountant.

**Restore standard accounts:** the chart screen lists standard accounts for the template and current entity type that the chart lacks (`ChartView.missing`), each with "Add back" and an "Add back all" button. Deleted accounts are gone for good (only unused accounts can be deleted); this is the way to bring a standard one back.

## Normal balance
Stored per account. Assets/expenses are debit-normal; liabilities/equity/income are credit-normal. Contra accounts flip it: Accumulated depreciation (credit), Refunds and returns (debit), Owner draws / distributions / dividends (debit). The chart screen shows balances on the normal side (positive = normal; negative in red = unusual).

## Tax-line mapping
- Each account has one stable **tax category** (`TaxCategoryKey`, e.g. `advertising`, `cogs_materials`, `cash`). Each category belongs to one account type (a test enforces the match).
- `TAX_LINE_TABLES` holds one table per IRS form year: category → `{ ref, label }` for each of Schedule C, 1065, 1120-S, 1120. `ref: null` means "not on this form", and the label says why (e.g. Schedule C has no balance sheet).
- `taxTableFor(year)` uses that year's table, else the latest earlier one, else the earliest. There is only a **2025** table (checked against the 2025 IRS PDFs: Sch C, 1065, 1120-S, 1120, and 1125-A Rev. 11-2024). When the IRS changes line numbers, add a new year's table; accounts and older years don't change.
- Entity returns use Form 1125-A for cost of goods sold; materials go to its line 2 (Purchases).
- The chart screen shows lines for the company's **current** return (today's entity type) and says which form year the numbers come from.

## Editing accounts
Code: `src/shared/accounts.ts` (rules shared with the screen), `src/main/accounts.ts`, `src/renderer/src/AccountForm.tsx`.
- **Screen:** "Add account" button and an "Edit" link on each row open the account form above the table. Inactive accounts are hidden unless "Show inactive" is ticked.
- **Fields:** number (digits only, unique), name (unique ignoring case, max 100), type, kind, tax category (only categories of that type, each showing its line on the current return), optional description.
- **Kind** (stored as subtype): asset: regular / bank / inventory / fixed asset / contra; liability: regular / credit card / sales tax / payroll; equity: regular / draws; income: regular / contra (refunds). Expenses have no kind to pick: a `cogs_*` tax category makes it cost of goods sold, anything else a regular expense.
- **Debit/credit side** is derived (`normalBalanceFor`): the type's natural side, flipped for contra and draw kinds. A test checks every template account follows this rule.
- **Special accounts** (`SYSTEM_SUBTYPES`: opening balance equity) can't be created by the owner, can't change type, and can't be deleted.
- **Number range:** outside 1xxx/2xxx/3xxx/4xxx/5xxx (COGS)/6xxx for its type → a warning under the field. Saving is still allowed.
- **Always allowed:** rename, renumber, change tax category, change description, change kind within the same debit/credit side.
- **Locked once the account is in a posted or voided entry:** type, and any kind change that flips the debit/credit side (also a database trigger for type).
- **Deactivate:** refused while the posted balance, all dates, is non-zero; the message shows the amount. Enforced by a v5 trigger too. Reactivate any time.
- **Delete:** only if the account was never used in any entry, even a draft. Otherwise the app says to deactivate. Deletes are in the audit log.

## Sub-accounts
- The account form has **Sub-account of (optional)**: any active top-level account of the same type. One level deep only; an account that has sub-accounts stays top level and isn't offered the choice. Saving an edit without touching the choice keeps it; choosing "None" moves it back to the top.
- Refused (`checkParent` in `src/main/accounts.ts`): a different type, a parent that is itself a sub-account, itself, or making an account with sub-accounts into one. An account with sub-accounts can't change type or be deleted. A sub-account keeps its own tax category.
- The chart lists sub-accounts right under their parent, indented. Reports show them indented under the parent followed by "Total <parent>" (the parent's own amount plus its sub-accounts; not counted again in the section total); a parent with nothing of its own still shows when a sub-account has activity.
- The Etsy and Amazon fee accounts are added as sub-accounts of 6100 Marketplace and payment fees, and their ads accounts under 6000 Advertising and marketing, when those exist (`parentFor`, `parentNumber` in the channel account lists).

## Accountant notes
`accountant_note` on an account marks a judgment call. It shows as "⚑ Check with your accountant: …" under the account name, and will feed the accountant package's "Notes for accountant" page. When the owner sets a tax category: the template's own choice for that account number gets the template's note; a new account in "Other expenses" gets the usual Other-expenses note; any other change to an existing account's category gets "The tax category was changed from X to Y. Confirm this is right." An unchanged category keeps its note. Current notes: shipping income as gross receipts · marketplace fees → Commissions and fees · meals 50% · small tools under the de minimis safe harbor · inventory method pending · materials line on Sch C vs 1125-A · packaging as cost of goods sold · postage/shipping expense line · everything mapped to "Other expenses" (a test enforces this) · interest income reported separately · officer reasonable compensation · LLC-as-S-corp "Members' capital" presentation · opening balance equity should end at zero · one set of partner accounts · C-corp income tax not deductible.
