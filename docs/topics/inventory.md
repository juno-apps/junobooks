# Inventory

Plan §6: the facts are material purchases (item, quantity, cost) and physical counts; the four methods are reports over the same facts and switching never changes them. One **filed** method per year drives the books (a year-end entry); the others are what-if reports. Code: `src/shared/inventory.ts` (quantities, methods math; pure), `src/shared/inventoryView.ts` (types), `src/main/inventory.ts` (items, purchases, counts, filed method), `src/main/inventoryReport.ts` (year report, year-end entry), screen `Inventory.tsx`. Schema v10.

## Facts
- **Items**: name (unique, any case), unit (g, dwt, ozt, each…; suggestions offered), notes; can be turned off. Edited in place.
- **Purchases**: date, item, quantity, total cost, note, and "opening stock" (what was on hand when the books start; counts as beginning inventory, not a purchase of the year). Quantities are stored in thousandths (`parseQuantity`, `formatQuantity`; up to three decimals). Purchases are **quantity and cost facts only**: the money side is recorded as usual (New expense, bank imports). Removing keeps the record (`removed_at`); rows can't be deleted. Dates can't be before the books start or in a closed period.
- **Counts**: a count sheet per date lists every active item with "Expected" (last count plus purchases since) and a Counted box; blank = not counted that day. Earlier count dates are links. Not allowed in a closed period.

## Methods (`itemYear`, `methodYear`), per calendar year
- Ending quantity at Dec 31 = the latest count on or before it plus purchases after that count (with no count, everything bought). Items not counted exactly on Dec 31 are listed with a warning.
- **Periodic count (latest cost)**: ending quantity × the most recent unit price.
- **FIFO**: the most recent purchases are what's left; anything beyond what was bought is valued at the latest price.
- **Weighted average**: (beginning value + the year's purchases) ÷ (beginning quantity + purchased quantity) × ending quantity.
- **Expense as purchased**: no inventory carried; everything bought is cost of goods sold (beginning 0).
- Cost of goods sold = beginning + purchases − ending. The first year starts from opening stock; later years from the previous year's ending value under the same method. Money math is exact integer cents (`scaleCents`, rounding half away from zero).
- **Check**: purchases recorded on this screen in the year vs. posted amounts in the books on inventory accounts and Materials/Merchandise purchases accounts (excluding the year-end entry). A difference is pointed out.

## Filed method and year-end entry
- The filed method is chosen per year (`inventory_methods`, append-only history; the latest row wins). "Not chosen yet" is allowed and is the default: nothing is posted until one is chosen. Changing an existing choice needs a reason; not allowed once the year is closed. The screen carries a "Check with your accountant" note and the Form 3115 warning; the question is parked in the backlog ("Needs owner decision").
- **Post year-end inventory entry** (`postInventoryAdjustment`): dated Dec 31, source `inventory`; moves the chosen inventory account so that all inventory accounts together equal the filed method's ending value, the difference to the chosen cost of goods sold account (defaults: first inventory account; Materials, else Merchandise purchases). Opening balances already in inventory accounts are taken into account. Posting again voids the previous year-end entry and posts a new one. Each posting is recorded in `inventory_adjustments`.

## Database (schema v10)
- `inventory_items`, `inventory_purchases` (no delete; `removed_at`), `inventory_counts` (one per item per date), `inventory_methods` (append-only), `inventory_adjustments`. All audited.
