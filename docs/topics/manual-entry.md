# Manual entry

Screens for typing transactions in by hand. All of them post through `postManualEntry` on `CompanyBooks` (`src/main/companyStore.ts`), which adds one rule on top of the ledger's (see `architecture.md` → Ledger rules): **no entry dated before the books start date.** Entries get `source = 'manual'`.

## Journal entry screen (`src/renderer/src/JournalEntry.tsx`)
- Opened by **New journal entry** on company home (only once a chart exists). Closing it keeps the chart in view.
- Fields: date (default today), memo, and lines of account / debit / credit / line memo.
- **Account picker:** a text box with a list of active accounts ("number name"). An exact label or bare account number picks the account while typing; on leaving the box, text that fits exactly one account is completed. Unmatched text shows a red border and blocks posting.
- **Rows:** typing in the last row adds a blank row. Fully blank rows are ignored. ✕ removes a row (never below two).
- **Fill the difference:** entering an empty amount box fills in the amount that balances the entry, if it belongs in that column.
- **Two-line entries stay balanced** (`mirrorPair`): when exactly two lines have amounts, the entry balanced before the edit, and the upper line's amount changes (same column), the lower line follows. Never bottom-to-top, so a split can be typed on line 2 without touching line 1.
- **Totals row:** debits, credits, and "Balanced" or "Off by $X (needs more debits/credits)".
- **Copy mode** (`copyOf`, from Duplicate): starts with the copied entry's memo and lines, dated today; title says "copy of #N".
- **Posting:** Enter or **Post entry**. On success: "Entry #N posted.", rows and memo clear, date stays, focus returns to line 1, chart balances reload.

## Transaction list (`src/renderer/src/TransactionList.tsx`)
- Company home has two tabs: **Transactions** (default) and **Chart of accounts**. Posting, voiding or reversing reloads both.
- Data: `listEntries` in `src/main/entries.ts` (read-only; all entries newest date first, then newest id, with lines, account number/name, debit total, void reason, reversal links).
- Columns: date, #, memo, accounts (up to three names, then "+N more"), amount, status ("Voided", "Reversed by #N", "Reversal of #N"). Voided rows are greyed.
- Clicking a row opens its lines and actions: **Duplicate** (always) opens the entry screen in copy mode; **Void…** (needs a reason) and **Reverse…** (date default today, optional memo) only on posted entries that aren't reversed. Each shows a one-line plain-English explanation. Errors come from the ledger.

## Shared rules (`src/shared/journal.ts`)
- `rowTotals(rows)`: live totals for the screen.
- `mirrorPair(prev, next, i)`: the two-line balancing rule above.
- `EntryListItem`: the list's entry shape.
- `rowsToLines(rows)`: skips blank rows; each used row needs an account and exactly one of debit/credit, a readable, positive, non-zero amount; at least two lines. Debit → positive cents, credit → negative. The ledger re-checks balance, active accounts and the period lock.
