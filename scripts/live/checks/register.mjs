// 2d: account register from the chart of accounts.
import { launch, createCompany, shot, check, done, post } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
await post(page, '2026-01-10', 'Etsy payout', [['1000', 50000], ['4000', -50000]])
await post(page, '2026-02-03', 'Rio Grande', [['5000', 12000], ['1000', -12000]])
await post(page, '2026-03-15', 'Mixed shop run', [['1000', -4500], ['6650', 3000], ['6000', 1500]])
const mistake = await post(page, '2026-03-20', 'Typo', [['6650', 999], ['1000', -999]])
await page.evaluate((id) => window.juno.voidEntry(id, 'typo'), mistake)
await page.reload()
await page.waitForSelector('.app-main h1')

await page.getByRole('button', { name: 'Chart of accounts' }).click()
await page.getByRole('button', { name: 'Checking account', exact: true }).click()
await page.getByRole('heading', { name: '1000 Checking account' }).waitFor()
const rows = page.locator('.register-table tbody tr')
check((await rows.count()) === 3, 'three posted rows (voided hidden)')
check((await page.locator('.register-table tfoot').innerText()).includes('335.00'), 'ending balance 335.00')
check((await rows.nth(2).innerText()).includes('Split (2 accounts)'), 'split shows as Split (2 accounts)')
check((await page.locator('.register-table thead').innerText()).includes('Money in'), 'bank columns say Money in / out')
await shot(page, 'register-all')

await page.getByLabel('Show voided entries').check()
check((await rows.count()) === 4, 'voided row appears when asked')
check((await rows.nth(3).innerText()).includes('Voided'), 'voided row is labelled')

await page.getByLabel('From').fill('2026-03-01')
await page.getByRole('cell', { name: 'Balance forward' }).waitFor()
check((await rows.first().innerText()).includes('380.00'), 'balance forward 380.00 on 2026-03-01')
await shot(page, 'register-range')

await page.getByLabel('To').fill('2026-02-01')
check((await page.locator('.error').innerText()).includes('after'), 'from-after-to refused in plain English')

await page.getByRole('button', { name: 'Back to chart of accounts' }).click()
await page.getByRole('button', { name: 'Credit card' }).click()
check((await page.locator('.register-table thead').innerText()).includes('Charges'), 'credit card columns say Charges / Payments')
check((await page.getByText('Nothing posted to this account yet').count()) === 1, 'empty register message')
await app.close()
done(errors)
