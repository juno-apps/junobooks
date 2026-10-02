# Etsy importer

Imports Etsy's monthly **payments statement** CSV (Shop Manager → Finances → Monthly statements) and, optionally, the **Sold Orders** CSV (Settings → Options → Download Data → Orders). Built from Etsy's publicly described layout and the made-up files in `samples/etsy/`; real exports still need testing (backlog). Code: `src/shared/etsy.ts` (reading, classifying, planning; pure), `src/shared/etsyImport.ts` (types), `src/main/etsyImport.ts` (accounts, preview, posting, payouts), screen `EtsyImport.tsx`. Schema v9.

## Reading the files
- Statement columns found by name: Date, Type, Title, Info, Currency, Amount, Fees & Taxes, Net. Dates like "March 3, 2026", "Mar 3, 2026", "3 March 2026", 03/03/26, 2026-03-03. Amounts like "$12.00", "-$0.20"; "--" or blank means nothing. Non-USD rows and unreadable rows are listed and left out; rows with nothing in Amount and Fees (e.g. a $0.00 processing fee) are skipped.
- **Kinds** (`classifyEtsyRow`, from Type and Title): sale ("Payment for Order #…"), refund, sales tax paid by buyer, transaction fee, processing fee, listing fee (incl. renewals), Etsy Ads, Offsite Ads, shipping label, subscription (Etsy Plus), tax on fees (VAT etc.), other fee (e.g. regulatory operating fee), payment (money paid in to Etsy), deposit ("$X sent to your bank account"; amount read from the title), and unknown.
- Orders file (`parseEtsyOrders`): Order ID, Order Value, Discount Amount, Shipping, Shipping Discount, Sales Tax, Order Total, Sale Date, Ship State, Ship Country. Items = value − discount; shipping = shipping − shipping discount.

## How rows post (`rowPostings`, `planEtsy`)
- Everything runs through the **Etsy payment account** (clearing, what Etsy holds for you). Each row's postings balance against it.
- Sale: amount credited to Sales, with the order's shipping (capped at the amount) credited to Shipping income instead when the order is known; Fees & Taxes (processing fee) debited to processing fees.
- Refund: amount debited to Refunds and returns; any fee credit back credited to processing fees.
- Sales tax: collected and remitted both go through "Sales tax collected by Etsy", so it nets to zero (accountant note about gross receipts / 1099-K).
- Fee kinds, payments and unknown rows: Amount + Fees to the kind's account.
- **One entry per day** of activity (lines combined per account, memo "Etsy activity DATE: 2 sales, 3 fee and other lines"), source `etsy`. **Each deposit** is its own transfer entry (bank debited, Etsy payment account credited, memo "Etsy deposit to bank"), so the bank import's payout line matches it (see `bank-import.md` → Matching).

## Accounts
- `ETSY_ACCOUNTS`, added by **Add these accounts** on the import screen (by name; number moves up if taken; description "Added for Etsy imports."): 1210 Etsy payment account (asset, other current assets, note), 2210 Sales tax collected by Etsy (liability, note), 6101 Etsy transaction fees, 6102 Etsy payment processing fees, 6103 Etsy listing fees, 6104 Etsy other fees (subscription, tax on fees, other, unknown; note), 6001 Etsy Ads, 6002 Etsy Offsite Ads fees (note: advertising vs commissions is the accountant's call).
- Defaults for the rest by number: Sales 4000, Shipping income 4010, Refunds 4090, shipping labels 6950 Postage and shipping. Payments have no default.
- Every choice can be changed on the screen and is saved per kind (`channel_mappings`, channel `etsy`, plus the deposit account). Deposits default to the first bank account.

## Import screen (`EtsyImport.tsx`)
- Company home → **Import from Etsy**. Accounts setup box (until added), then **Choose statement…** and optional **Choose orders file…**.
- Preview: rows new / already imported / before the books start, how many daily entries and deposits, whether shipping could be split out of every sale, unreadable rows, rows Etsy worded in an unrecognized way (with examples), and a table of each kind of activity with its total and its account box, plus the deposits and the bank account they go to. **Import N Etsy rows** posts everything in one transaction (all or nothing; a closed period refuses the whole import).
- Re-importing a statement skips rows already imported (`marketplace_rows`, fingerprint per row, repeats numbered), so a longer statement later adds only the new rows. Orders are kept (`marketplace_orders`) so later statements can still split shipping, and for sales tax and 1099-K work in later phases.
- **Etsy deposits and your bank** lists every imported deposit: "Found in the bank" (tied to an imported bank line), "In a bank import, waiting in Review imported lines" (a new bank line on that account with the same amount within 10 days), or "Not in an imported bank file yet".

## Database (schema v9)
- `import_batches.channel` ('bank' or 'etsy'); the bank import history shows bank batches only.
- `marketplace_rows`: channel, batch, fingerprint (unique per channel), row date, kind, cents, entry_id. Can't be changed or deleted. Audited.
- `channel_mappings`: channel + target → account (unique pair). Audited.
- `marketplace_orders`: channel + order_id (unique), sale date, items, shipping, discount, sales tax, total, ship state and country (updated on re-import).
