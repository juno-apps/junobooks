# Direct sales (customers, invoices, payments)

For sales outside the marketplaces: wholesale orders, shows, custom work. Code: `src/shared/sales.ts` (types, rates, totals, aging; pure), `src/shared/invoiceHtml.ts` (printable invoice), `src/main/sales.ts` (storage and posting), PDF saving in `src/main/index.ts` (`saveInvoicePdf`), screen `Sales.tsx` (company home → **Invoices**). Schema v11.

## Business details
`company_profile` has address, email and phone, shown on invoices. Edited from the Invoices tab ("Add your address and email" / "Change").

## Customers and resale certificates
- Customer: name, email (checked), phone, billing address, notes, **wholesale** flag, active. The list shows what each owes (open finalized invoices). Click a customer to edit.
- **Resale certificates** per customer: number, state, issued date, expiry date (optional), notes, optional copy of the file (copied to `<company>\resale-certificates\<customer>_<number>.<ext>`; Open file). Valid on a date when issued on/before it and not expired (`certificateValid`). Removing keeps the record; rows can't be deleted. Accountant note: keep a valid certificate (CA: CDTFA-230) for every untaxed sale for resale.

## Invoices
- Number (next free number from 1001, editable, unique), customer, date, due date (default +30 days), lines (description, quantity, price, income account (default Sales), taxable box; filling the last line adds another), sales tax % (a new invoice starts with the home state's rate in force on its date, see `sales-tax.md`; editable; thousandths of a percent stored), "No sales tax" with a reason, note.
- If the customer has a resale certificate valid on the invoice date, a new invoice starts as "No sales tax" with "Resale certificate <number> (<state>)". Exempt without a valid certificate shows a "Check with your accountant" warning.
- Totals (`invoiceTotals`): line = quantity × price (rounded to the cent); tax = taxable lines × rate (none when exempt); total = subtotal + tax.
- **Draft**: changes nothing in the books; can be edited or deleted. **Finalize**: posts one entry (source `invoice`, dated the invoice date): Accounts receivable debited for the total, each income account credited, sales tax credited to the Sales tax payable account. Finalized invoices are fixed (database triggers); dated no earlier than the books start.
- **Void…** (needs a reason) voids the entry; refused while posted payments are applied. Status shows Draft, Open, Paid (nothing left owed), Voided, plus "N days late".
- **Open PDF / Save PDF**: renders `invoiceHtml` in a hidden window and saves `<company>\exports\invoices\Invoice-<number>.pdf` (Open also opens it in Windows). Sending is up to the owner (email or print); the app never emails.

## Payments received
- Customer, date, amount, deposited-to account (bank/cash/other assets), method, reference. The customer's open invoices are listed; typing the amount fills them oldest first (editable). The applied amounts must add up to the payment and can't exceed what's owed; invoices must be the customer's and open.
- Posts one entry (source `payment`): deposit account debited, Accounts receivable credited. **Record payment** on an open invoice jumps here prefilled.
- **Void…** (reason) voids the entry; the invoices reopen. Payments and their applications can't be deleted or changed.

## Who owes you (aging)
Open amounts per customer on an as-of date, by days past due: not due yet, 1–30, 31–60, 61–90, over 90 (invoices dated after the as-of date are left out).

## Database (schema v11)
`company_profile` + address/email/phone (audit triggers re-created with them); `customers`; `resale_certificates` (no delete); `invoices` (unique number; finalized ones change only by voiding; only drafts deleted); `invoice_lines` (change only while the invoice is a draft); `payments` (no delete); `payment_applications` (no change or delete). All audited.
