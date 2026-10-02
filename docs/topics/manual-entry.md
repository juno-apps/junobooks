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

## Receipts (`src/renderer/src/Receipts.tsx`, `src/main/attachments.ts`, schema v6 `attachments`)
- Any entry can have receipt files. Open an entry on the Transactions tab: the **Receipts** box lists its files (click to open in the Windows default program, **Show in folder**, **Remove…** with an optional reason) with **Attach receipt…** (file picker, several at once) or drag and drop onto the box. Right after posting on any entry screen, an **Attach receipt…** button sits under the success message. List rows show 📎 (with a count if more than one).
- Files are **copied** into `<company>\receipts\<year of entry>\` named `date_vendor_amount.ext` (`receiptFileName`; vendor = entry memo made Windows-safe, at most 40 characters; amount = debit total; `-2`, `-3` added if the name is taken). The original is left where it was.
- Accepted types: `RECEIPT_EXTENSIONS` (PDF, images, text/email, Office, CSV), up to 50 MB. Unreadable files, other types, and a file already attached to the same entry (same SHA-256) are skipped with a plain-English reason; the rest are attached.
- **Remove** keeps the record (`removed_at`, `remove_reason`) and moves the file to `receipts\_removed\`. Database triggers refuse erasing a receipt record or changing it other than marking it removed; every change is in the audit log.
- Receipts can be attached to voided entries and to entries in closed periods (they don't change any amount).

## Opening balances (`src/renderer/src/OpeningBalances.tsx`, `src/main/openingBalances.ts`)
- Opened by **Opening balances** on company home. Lists every balance-sheet account (assets, liabilities, equity; inactive ones only if they already hold an amount) grouped as "What the business had / owed / Owner and equity accounts". Opening balance equity itself is not listed.
- Amounts are typed on each account's normal side (what you had or owed; a card balance of $1,200 is 1200; an overdrawn bank is a minus amount). Blank = zero. Unreadable amounts get a red border and block saving.
- Saving posts **one entry** (source `opening`, memo "Opening balances") dated the **books start date**: each amount on its normal side, the difference to the `opening_balance` account (3999 Opening balance equity, line memo "Difference (for your accountant to review)"). A live total shows that difference with a "Check with your accountant" note.
- Saving again voids the current opening entry ("Replaced by updated opening balances") and posts a new one, in one transaction. All blank → the old entry is voided, nothing posted. Refused if Opening balance equity is inactive or missing, an account isn't balance-sheet, or the books are closed through the start date (ledger rule).

## Account register (`src/renderer/src/AccountRegister.tsx`, `src/main/register.ts`)
- Opened by clicking an account name on the Chart of accounts tab; "Back to chart of accounts" returns (and reloads balances).
- Read-only. Lists every posted line on the account, oldest first (date, entry id, line order): date, #, description (entry memo, line memo below), other side (the other account's name, or "Split (N accounts)"), increase / decrease, running balance.
- Amounts are on the account's normal side (`registerColumns` in `shared/register.ts`): bank accounts say Money in / Money out, credit cards Charges / Payments, everything else Increase / Decrease. A negative balance shows in the "unusual" style.
- From / To dates (plus "This year" and "All dates"). With a From date the first row is "Balance forward" (posted balance before that date). Ending balance at the bottom. From after To is refused.
- "Show voided entries" lists voided lines greyed, marked "Voided, not counted", without moving the balance.
- Last column: ✓ = seen on a bank statement (cleared), R = reconciled (see `bank-import.md`).

## Everyday screens (`src/shared/everyday.ts`)
Plain questions on screen, one balanced entry underneath, posted through `postManualEntry`. Company home has **New expense**, **New income**, **New transfer** and **New journal entry** buttons.
- **Expense and Income** share one screen, `SimpleEntry.tsx` (a `kind` prop sets the wording, account lists and direction). **Expense**: date, "Paid to" (becomes the entry memo), "How did you pay?", then lines of "What was it for?" / amount / note (filling the last line adds another, for splits). Debits each category, credits the paid-from account once for the total. The paid-from account can't also be a category.
  - *How did you pay?* (`paidFromGroups`): Bank and cash, Credit cards, Not paid yet (accounts payable), Other accounts (any other active asset/liability/equity account, e.g. owner contributions; the screen tells the owner to ask the accountant about paying personally).
  - *What was it for?* (`expenseCategoryGroups`): Expenses, Cost of goods sold, Inventory and equipment.
- **Income**: date, "Received from" (entry memo), "Where was it deposited?", then lines of "What kind of income?" / amount / note. Credits each kind of income, debits the deposit account once for the total. The deposit account can't also be a category.
  - *Where was it deposited?* (`depositToGroups`): Bank and cash, Not received yet (accounts receivable, for an unpaid invoice), Other accounts (other assets except inventory, equipment and contra assets).
  - *What kind of income?* (`incomeCategoryGroups`): Income (contra accounts such as Refunds and returns left out) and Sales tax collected (sales-tax liability; the screen notes it is owed onward, not income).
  - Both builders (`buildExpense`, `buildIncome`) share `buildSplit` in `everyday.ts`.
- **Transfer** (`TransferEntry.tsx`, `buildTransfer`): date, amount, optional note (blank = "Transfer from X to Y"), "Move money from", "To", and a **Swap** link. Debits the "to" account, credits the "from" account. Refused: same account both sides, missing/zero/negative amount. `transferGroups` offers Bank and cash, Credit cards, and Other accounts (loans, payment-processor balances, owner draws); bills, receivables, sales tax, payroll, inventory, equipment, income and expense accounts are not offered. Paying a card = from the bank account to the card. Owner contributions are not covered yet (use the journal entry screen).
- **Account boxes** (`AccountCombobox.tsx`, `filterGroups`): click to see the grouped list, type to narrow (any words, any order, number or name), arrows + Enter or click to choose. Only existing accounts can be chosen; other text reverts when leaving the box (text that fits exactly one account picks it). Enter never posts the form while the list is open. If the chosen account changes from outside (e.g. a categorization rule fills it in), the box shows it. The list grows wider than the box (up to 32rem) so group headings stay on one line.

## Error messages (`useFormError.ts`)
All four entry screens show one red message. A problem found by the screen's own check is re-checked as the form changes: it clears once fixed, or moves on to the next problem. A refusal from the books on saving (e.g. before the books start, closed period) clears as soon as anything in the form changes.

## Shared rules (`src/shared/journal.ts`)
- `rowTotals(rows)`: live totals for the screen.
- `mirrorPair(prev, next, i)`: the two-line balancing rule above.
- `EntryListItem`: the list's entry shape.
- `rowsToLines(rows)`: skips blank rows; each used row needs an account and exactly one of debit/credit, a readable, positive, non-zero amount; at least two lines. Debit → positive cents, credit → negative. The ledger re-checks balance, active accounts and the period lock.
