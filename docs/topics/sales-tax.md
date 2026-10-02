# Sales tax

Code: `src/shared/salesTax.ts` (types, `rateOn`, `quarters`), `src/main/salesTax.ts` (rates, report, payment), screen `SalesTax.tsx` (company home → **Sales tax**: Report and Rates tabs). Schema v13.

## Rates as dated data
- Each rate: state, place (optional label, e.g. San Diego), rate (thousandths of a percent; 7.75% = 7750), start date, notes. Unique per state + place + start date. Removing a rate deletes it (audited).
- `rateOn`: the rate in force on a date is the latest one for the state started on or before it (blank place preferred on ties). The home state comes from the home-state history for the date.
- New invoices start with the home state's rate in force on the invoice date and follow date changes until the owner types a rate; saved invoices keep their own rate (`invoices.tax_rate_milli`).

## Report for a period (`salesTaxReport`)
Period by year + Q1–Q4 buttons or From/To dates. Figures come from posted entries in the period:
- **Total sales**: credits to income accounts with tax category gross receipts (sales and shipping charged).
- Less **sales through marketplaces**: the same, from entries with source `etsy` or `amazon` (per channel).
- Less **sales for resale**: finalized invoices marked no-tax whose customer has a resale certificate valid on the invoice date (listed with the certificate).
- Less **other sales marked tax-exempt**: exempt invoices without a valid certificate (listed, flagged).
- Less **refunds and returns** outside the marketplaces (returns-and-allowances debits).
- = **Taxable sales**; **tax at the rates in force** computed month by month (a mid-period rate change applies from its month; missing rates are flagged); **sales tax you charged** (Sales tax payable credits, excluding payments); the **difference**; payments recorded in the period; **Sales tax payable** balance at the end of the period.
- A "Check with your accountant" note covers return line numbers, district taxes, shipping taxability and out-of-state shipments.

## Paying
**Record a sales tax payment…** (date, amount defaulting to what's owed, paid-from account, memo) posts an entry with source `sales_tax_payment`: Sales tax payable debited, the bank credited.

## Database (schema v13)
`sales_tax_rates` (state_code, place, rate_milli 0–100000, effective_date, notes; unique state + place + date). Audited.
