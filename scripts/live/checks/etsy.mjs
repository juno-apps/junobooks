// Phase 4: Etsy import (accounts setup, statement + orders, account choices, post, re-import, payouts tie-out).
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { launch, createCompany, shot, check, done, pickAccount, ROOT, DATA_ROOT } from '../lib.mjs'

const etsy = (n) => join(ROOT, 'samples', 'etsy', n)
const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
const willPick = (f) =>
  app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, f)

await page.getByRole('button', { name: 'Import from Etsy' }).click()
await page.getByRole('heading', { name: 'Import from Etsy' }).waitFor()
check((await page.locator('.etsy-setup').innerText()).includes('1210 Etsy payment account'), 'offers to add the Etsy accounts')
await page.getByRole('button', { name: 'Add these accounts' }).click()
await page.locator('.etsy-setup').waitFor({ state: 'detached' })

await willPick(etsy('etsy_statement_2026_3.csv'))
await page.getByRole('button', { name: 'Choose statement…' }).click()
await page.getByRole('heading', { name: 'What this statement holds' }).waitFor()
check((await page.locator('.etsy-import').innerText()).includes('Shipping is split out of 0 of 2 sales'), 'without orders, shipping not split yet')
await willPick(etsy('EtsySoldOrders2026-3.csv'))
await page.getByRole('button', { name: 'Choose orders file…' }).click()
await page.getByText('Shipping is split out of every sale').waitFor()
const map = await page.locator('.etsy-map').innerText()
check(map.includes('Sales (items)') && map.includes('$166.00 in'), 'sales $166.00 in')
check(map.includes('Shipping charged to buyers') && map.includes('$18.00 in'), 'shipping $18.00 in')
check(map.includes('2026-03-15 $110.65'), 'deposit listed')
check((await page.getByRole('combobox', { name: 'Account for Etsy Ads' }).inputValue()).includes('Etsy Ads'), 'Etsy Ads account chosen by default')
// Owner changes shipping labels to Packaging, just to show choices stick.
await pickAccount(page, 'Account for Shipping labels bought on Etsy', 'packaging')
await shot(page, 'etsy-preview')
await page.getByRole('button', { name: 'Import 14 Etsy rows' }).click()
await page.getByText('Imported 14 rows: 8 daily entries and 1 deposit.').waitFor()
check((await page.locator('.payouts').innerText()).includes('Not in an imported bank file yet'), 'deposit not in bank yet')

// Same statement again: nothing new.
await willPick(etsy('etsy_statement_2026_3.csv'))
await page.getByRole('button', { name: 'Change…' }).first().click()
await page.getByText(/14 rows: 0 new, 14 already imported/).waitFor()
check(true, 're-import skips everything')
await page.getByRole('button', { name: 'Close' }).click()

// Bank file with the Etsy payout: offered as a match, then the payout shows as found.
mkdirSync(join(DATA_ROOT, '..', 'live-samples'), { recursive: true })
const bank = join(DATA_ROOT, '..', 'live-samples', 'bank-with-etsy.csv')
writeFileSync(bank, 'Date,Description,Amount\r\n03/16/2026,ETSY INC PAYOUT 260316,110.65\r\n')
await willPick(bank)
await page.getByRole('button', { name: 'Import bank file' }).click()
await pickAccount(page, 'Import into', 'checking')
await page.getByRole('button', { name: 'Choose file…' }).click()
await page.getByRole('button', { name: 'Import 1 line' }).click()
await page.getByRole('button', { name: 'Review them now' }).click()
const row = page.locator('.review-row').first()
check((await row.locator('.match-box').innerText()).includes('Etsy deposit to bank'), 'bank payout offers the Etsy deposit')
await row.locator('.match-button').first().click()
await page.getByText(/Matched with entry/).waitFor()
await page.getByRole('button', { name: 'Close' }).click()
await page.getByRole('button', { name: 'Import from Etsy' }).click()
check((await page.locator('.payouts').innerText()).includes('Found in the bank (2026-03-16)'), 'payout found in the bank')
await shot(page, 'etsy-payouts')
await page.getByRole('button', { name: 'Close' }).click()

await page.getByRole('button', { name: 'Chart of accounts' }).click()
const chart = await page.locator('.chart-table').innerText()
check(chart.includes('Etsy payment account') && chart.includes('-$10.13'), 'Etsy payment account -10.13 (fees after the deposit)')
check(chart.includes('$110.65'), 'checking 110.65')
await app.close()
done(errors)
