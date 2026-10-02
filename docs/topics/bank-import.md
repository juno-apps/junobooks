# Bank and card imports

Bringing in transactions from bank and card CSV downloads. Imported lines are **staged** first, reviewed, then posted as normal entries (source `import`). Code: `src/shared/csvImport.ts` (reading and mapping, pure), `src/shared/bankImport.ts` (types, account groups), `src/main/bankImport.ts` (staging, review, posting), `rules.ts` (shared + main), screens `ImportWizard.tsx`, `BankReview.tsx`, `RulesManager.tsx`. Schema v7 (see `architecture.md`).

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

## Categorization rules (`src/shared/rules.ts`, `src/main/rules.ts`, `RulesManager.tsx`)
- A rule: "when the bank description contains *words*, use *account* (and *memo*)", optionally only for lines imported into one account. Stored in `categorization_rules` (audited; rules are settings, so deleting is allowed).
- `findRule`: active rules whose words appear in the description (ignoring case and extra spaces), skipping rules for another bank account, rules pointing at an inactive account, or at the imported account itself. The longest words win, then the newest rule.
- Lines waiting for review carry a `suggestion`; the review screen fills the account and memo of any line with no account chosen yet and notes "From rule "…"". The owner still posts each line.
- **Make a rule…** on a review row opens a form prefilled with the description minus reference numbers (`suggestMatchText`, at most four words), the row's account and memo, and "Only for lines imported into <account>" (on by default). Saving fills in every matching line still without an account.
- **Categorization rules** (link at the top of the review screen) lists rules with Edit, Turn off/on and Delete. Words need at least three letters.

## Matching lines to entries already in the books (`matchCandidates`, `matchBankLine`)
- For each line waiting for review, posted entries that have a line on the **same account for the same amount**, dated within **10 days** (`MATCH_DAYS`), are offered (closest date first, at most three) in an "Already in your books?" box: **Match #N · date · memo (other side)**.
- Left out: entries already tied to another imported line of the same account, reversed entries, and reversals.
- Matching sets the line to `matched` with that entry; nothing new is posted. Typical cases: a payment typed in by hand that cleared the bank days later; a card payment posted from the checking import, then seen again in the card import.
- If the matched entry is voided later, the line returns to review.

## Cleared status and reconciliation (`src/main/reconcile.ts`, `src/shared/reconcile.ts`, `Reconcile.tsx`, schema v8)
- A posted line on a bank, card or loan account can be **cleared** (seen on a statement) or **reconciled** (part of a finished reconciliation), kept in `line_clearing`. Posting or matching an imported line marks that entry's line on the imported account cleared (`clearEntryLines`).
- Company home → **Reconcile**: choose the account; enter the **statement end date** and **ending balance** (for a card, the balance owed; amounts on the account's normal side). The screen lists posted, not-yet-reconciled lines dated on or before the statement date (later ones are counted as "left for the next statement"), each with a tick box, plus Tick all.
- Summary: statement balance, **cleared balance** (all reconciled lines + ticked lines), **difference**. **Finish reconciliation** only works at $0.00: ticked lines become reconciled and the reconciliation is finished. **Cancel this reconciliation** drops it but keeps the ticks. The statement can be changed while in progress.
- A new statement can't end before the last finished one. **Undo the last reconciliation…** (needs a reason) turns its lines back to cleared; the undone one stays in "Past reconciliations" with its reason.
- Database rules: reconciled lines can't be unticked or deleted unless their reconciliation is undone first; a finished reconciliation can only be undone (not edited or deleted); **an entry with a reconciled line can't be voided** (reverse it instead, or undo the reconciliation). All audited.
- The account register shows ✓ (cleared) or R (reconciled) per line.
- The screen carries a "Check with your accountant" note: entries count on the date recorded, not the date they cleared (late-December payments).

## Rules kept by the database (schema v7)
- `bank_lines`: what the bank said (account, date, description, amount, fingerprint) can never change and rows can't be deleted; only status and entry link change. `import_batches` can't be changed or deleted. Both audited, as are `categorization_rules`.

