# Closing the books

Company home → **Close books**. Code: `src/main/closing.ts`, `src/shared/closing.ts`, screen `CloseBooks.tsx`. Uses the ledger's period lock (`setLockedThrough`, `period_lock_history`; see `architecture.md` → Ledger rules).

## Books closed through a date
- Shows the date in force ("Nothing dated on or before … can be added, changed or voided"). Choose a date (quick links: end of last month, last quarter, last year) and **Close books through …**. A date in the future is refused.
- Choosing an earlier date (or **Reopen everything…**) reopens; a reason is required and kept. History lists every change with its reason.

## Closing a year (`closeYear`)
- Years that have ended are offered. The screen shows the year's net income (closing entries left out), whether it's already closed, and how many checks the accountant notes have (see `accountant-package.md`).
- **Close into**: an active equity account (not Opening balance equity, not draws); default by entity (`defaultClosingEquity`): sole proprietor / single-member LLC → owner's equity (Owner's capital), multi-member LLC / partnership → partners' capital, corporations → retained earnings. Accountant note: which account, and whether draws should also be closed into capital.
- **Close YYYY** posts one entry dated Dec 31 (source `closing`) reversing every income and expense balance for the year into that equity account, then closes the books through Dec 31. Closing again (after reopening the year) voids the old closing entry and posts a new one.

## How reports treat closing entries
- Left out: profit & loss, sales by channel, the income/expense part of the tax-line summary, the cost of goods sold schedule, the sales tax report, the inventory purchases check, and "accounts used" in the accountant notes, so a closed year still shows its activity.
- Trial balance as of a date leaves out closing entries dated that day (a year-end trial balance shows the balances before closing).
- Balance sheet and general ledger include them: after closing, the year's profit sits in equity and "profit not yet closed" is zero.
