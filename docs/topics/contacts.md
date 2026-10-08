# Contacts and suppliers

Everyone the business deals with in one list. Code: `src/shared/contacts.ts` (types, kinds, input check), `src/main/contacts.ts` (suppliers, combined list), screen `Contacts.tsx` (company home → Buy → **Contacts**). Schema v15.

## Contacts list
- Shows suppliers, customers and contractors together, sorted by name, with kind, contact person, phone and email. Filters: All / Suppliers / Customers / Contractors (counts are active ones), a Find box (name, contact person, email, phone), and "Show N inactive".
- Customers stay stored and edited under Invoices → Customers (`direct-sales.md`); contractors under Year-end records → Contractors (`reports.md`). Their rows have "Open in Invoices" / "Open in Year-end records".

## Suppliers
- Fields: company name (unique ignoring case and spaces), kind (Materials and supplies · Refiner or metal dealer · Services · Other), contact person, email (checked), phone, website, address, your account number with them, payment terms in days (0–365, blank = pay right away), "What you usually buy from them" (an active expense, cost of goods sold, inventory or equipment account; optional), notes, active.
- Suppliers can't be deleted (database trigger); untick Active instead. Every change is in the audit log.
- Payment terms and the usual account are stored for the supplier bills step (planned next: bills on account, paying them, owed-to-suppliers aging) and the Supplier box on the Expense screen.

## Database (schema v15)
`suppliers` (unique index on lower(trim(name)), no delete, audited).
