# Accountant package

Company home → **Accountant package**. Code: `src/main/accountantNotes.ts` (notes), `src/main/accountantPackage.ts` (workbook, CSVs, ZIP; no Electron), `src/shared/summaryHtml.ts` (PDF summary page), `buildAccountantPackage` / `htmlToPdf` in `src/main/index.ts`, screen `AccountantPackage.tsx`. Libraries: `exceljs` (workbook), `jszip` (ZIP).

## Notes for the accountant (`accountantNotes`)
For a year, a list of notes (`note`: information) and checks (`check`: review or fix before sending), each with an area:
- **Company**: entity type at year end and its return; entity type or home state changes during the year; books starting mid-year; books not closed through Dec 31.
- **Accounts**: the accountant note of every account used in the year; accounts with no tax category.
- **Equity**: Opening balance equity not zero at year end.
- **Marketplaces**: Etsy/Amazon payment accounts holding money at year end.
- **Inventory** (when there is any): no filed method; year-end entry not posted; items not counted on Dec 31; inventory-screen purchases differing from the books.
- **Sales tax**: exempt invoices without a valid certificate; tax at the rates differing from tax charged; missing rates; payable at year end.
- **1099-K**: imported platforms without box 1a entered; differences; notes typed on the tie-out.
- **1099-NEC**: contractors over the threshold (check when no W-9); unmatched contract-labor payments.
- **Bank**: imported lines not reviewed; bank and card accounts used in the year not reconciled through Dec 31.
- **Fixed assets** (list vs books; new assets), **Mileage** (miles without a rate), **Home office** (details entered).

## The package (`buildPackage`)
Saved as `<company>\exports\Accountant package <year>.zip` (replaced when built again). Contents:
- `<Company> <year> accountant workbook.xlsx`: tabs Summary, Profit and loss (by month), Balance sheet, Trial balance, General ledger, Transactions (every posted and voided line), Sales by channel, Tax lines, Cost of goods sold, Inventory methods, Inventory count (each item's Dec 31 quantity, whether counted that day, value under the filed method or FIFO when none is filed), Fixed assets, 1099-NEC, 1099-K (with months), Sales tax (by quarter), Mileage, Home office, Notes for accountant. Money cells are numbers with two decimals.
- `<Company> <year> summary.pdf`: key figures (profit and loss, balance sheet, sales by channel, cost of goods sold, 1099-K for platforms with activity) and a second page of notes (checks first).
- `general-ledger.csv`, `transactions.csv`, `inventory-count-sheet.csv`, `fixed-assets.csv`, `notes-for-accountant.txt`.
- `receipts/` (receipts attached to the year's entries, with `index.csv` linking each file to its entry) and `resale-certificates/` (certificate copies on file).

## Screen
Year picker (defaults to last year when there is one), the checks and notes, **Build <year> package** (can be run again after fixing things), the saved path with file and receipt counts, and **Show in folder**. Sending it is up to the owner.
