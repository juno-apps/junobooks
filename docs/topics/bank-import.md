# Bank and card imports

Bringing in transactions from bank and card CSV downloads. Imported lines are **staged** first, reviewed, then posted as normal entries (source `import`). Code: `src/shared/csvImport.ts` (reading and mapping, pure), `src/shared/bankImport.ts` (types, account groups), `src/main/bankImport.ts` (staging, review, posting), screens `ImportWizard.tsx` and `BankReview.tsx`. Schema v7 (see `architecture.md`).

## Sign rule
An imported line's `amountCents` is the change on the **imported account's debit side**: for a bank account money in is positive; for a credit card a payment or refund is positive and a charge is negative. Posting puts that amount on the imported account and the opposite on the chosen account.

## Import screen (`ImportWizard.tsx`)
- Company home → **Import bank file**. Choose the account ("Import into": bank and cash, credit cards, other asset/liability accounts except inventory, equipment, contra and sales tax), then a file (picker or drag and drop). Files: CSV/TXT up to 10 MB, UTF-8 or Windows-1252 (`readImportFile`).
- **Columns:** if this account has imported a file with the same layout before (`import_profiles`, keyed by account + `layoutKey`: header names, or column count when there is no header), those choices are reused; otherwise `guessMapping` guesses from header words and the data: date, description, optional extra column added to the description (e.g. check number; skipped if the description already contains it), amount as one signed column or separate out/in columns, date style (Y-M-D, M/D/Y, D/M/Y; a note appears when every date could be read either way), and "Amounts are backwards" for files showing spending as a plus.
- Card files: a payment line ("payment", "thank you", "autopay") shows which way the signs go; without one, mostly-positive amounts mean the file is backwards.
- **Preview:** first 8 lines as date / description / in / out, the number of lines read, zero-amount rows left out, and unreadable rows listed by row number.
- **Import N lines** stages them (`stageImport`): lines dated before the books start are left out; lines already imported into the same account are skipped as duplicates; the rest become `bank_lines` with status `new`. The result says how many of each, with **Review them now**.
- **Duplicates:** each line's fingerprint is date | amount | description letters and digits, numbered within its file (`#1`, `#2`) so two genuine identical charges both import, while the same lines from an overlapping download are skipped.

## Review screen (`BankReview.tsx`)
- Company home shows **Review imported lines (N)** while lines are waiting. Tabs per account when more than one has lines.
- Each row: date, bank description, in / out (words fit the account: Money in/out, Payments & refunds/Charges), **What was it for?** (`lineCategoryGroups`: money out lists Expenses, Cost of goods sold, Transfers and payments (bank, card, loan accounts), Income, Other; money in lists Income first), memo (blank = the bank description), **Post**, **Ignore**.
- Select boxes + **Post N selected** / **Ignore selected**. Lines without an account are skipped and counted. Failures (closed period, same account both sides, already dealt with) show in red on their row; the others still post.
- **Ignore** sets a line aside (e.g. already typed in by hand). **Show ignored lines** lists them with **Bring back**.
- If an entry made from an imported line is voided later, the line returns to review (marked "Its entry was voided").

## Rules kept by the database (schema v7)
- `bank_lines`: what the bank said (account, date, description, amount, fingerprint) can never change and rows can't be deleted; only status and entry link change. `import_batches` can't be changed or deleted. Both audited, as are `categorization_rules`.

## Not built yet
Categorization rules (3c), matching lines to entries typed in by hand (3d), cleared status and reconciliation (3e).
