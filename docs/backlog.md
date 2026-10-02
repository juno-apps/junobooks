# Backlog

Ideas parked for later. Items are added when the owner starts a message with "backlog:". Nothing here is being worked on. At the start of each phase, the items that fit that phase are shown to the owner.

## Needs owner decision

## Data/logic changes
- Test bank and card imports with real downloads from the owner's banks (Phase 3 was built from public layouts and made-up sample files in `samples/bank/`). Note any file whose columns or signs were guessed wrong.

## Feature ideas
- Cleared status + bank reconciliation (Phase 3): mark entries "cleared" once the bank shows them; a reconciliation screen checks cleared entries against the statement's ending balance and lists outstanding items. Add a "Check with your accountant" note on which date counts for taxes (date paid vs. date cleared, esp. late-December payments).
- Sub-accounts: nest accounts under a parent (e.g. "Etsy fees" under "Commissions and fees") on the chart screen and in reports. `accounts.parent_id` already exists. Parked from unit 1e.

## UI tweaks
