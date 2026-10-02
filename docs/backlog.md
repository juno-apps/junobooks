# Backlog

Ideas parked for later. Items are added when the owner starts a message with "backlog:". Nothing here is being worked on. At the start of each phase, the items that fit that phase are shown to the owner.

## Needs owner decision
- **Inventory method filed for 2026** (Phase 5, ask the accountant): periodic count valued at latest cost, FIFO, weighted average, or expense as purchased (small-business materials and supplies treatment). The Inventory screen shows all four side by side and posts nothing to the books until one is chosen for the year. Changing it later generally needs IRS consent (Form 3115).

## Data/logic changes
- Test bank and card imports with real downloads from the owner's banks (Phase 3 was built from public layouts and made-up sample files in `samples/bank/`). Note any file whose columns or signs were guessed wrong.

- Test the Etsy importer with real exports (monthly payments statement CSV and Sold Orders CSV). Phase 4 was built from Etsy's publicly described columns and made-up files in `samples/etsy/`; row types or titles Etsy words differently will show up as "Other Etsy activity" on the import screen.

- Test the Amazon importer with a real settlement report (flat file V2). Phase 7 was built from Amazon's documented layout and the made-up file in `samples/amazon/`.

## Feature ideas

## UI tweaks
