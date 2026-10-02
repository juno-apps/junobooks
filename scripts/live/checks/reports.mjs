// 9a: profit & loss, balance sheet, trial balance, general ledger, CSV export.
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { launch, createCompany, shot, check, done, post, DATA_ROOT } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
await app.evaluate(({ shell }) => {
  shell.openPath = async () => ''
})
await post(page, '2026-01-10', 'Sale', [['1000', 30000], ['4000', -30000]])
await post(page, '2026-02-03', 'Materials', [['5000', 8000], ['2100', -8000]])
await post(page, '2026-03-01', 'Ads', [['6000', 1200], ['1000', -1200]])
await page.reload()
await page.waitForSelector('.app-main h1')

await page.getByRole('button', { name: 'Reports', exact: true }).click()
await page.getByRole('heading', { name: 'Reports', level: 2 }).waitFor()
await page.getByLabel('Report from').fill('2026-01-01')
await page.getByLabel('Report to').fill('2026-03-31')
await page.locator('.report-table').waitFor()
const pl = await page.locator('.report-table').innerText()
check(/Net income\s*\$208\.00/.test(pl), 'net income 208.00')
check(/Gross profit\s*\$220\.00/.test(pl), 'gross profit 220.00')
await page.getByLabel('Show each month').check()
await page.waitForFunction(() => document.querySelector('.report-table thead')?.textContent?.includes('2026-02'))
check((await page.locator('.report-table thead').innerText()).includes('2026-03'), 'month columns')
await shot(page, 'reports-pl')
await page.getByRole('button', { name: 'Save as CSV' }).click()
await page.getByText(/Saved .*Profit-and-loss-2026-01-01-to-2026-03-31\.csv/).waitFor()
const csvFile = join(DATA_ROOT, 'Companies', 'Live check', 'exports', 'reports', 'Profit-and-loss-2026-01-01-to-2026-03-31.csv')
check(existsSync(csvFile) && readFileSync(csvFile, 'utf8').includes('Net income,300.00,-80.00,-12.00,208.00'), 'CSV saved with month columns')

await page.locator('.report-tabs').getByRole('button', { name: 'Balance sheet' }).click()
await page.getByText(/Balanced: assets/).waitFor()
const bs = await page.locator('.report-table').innerText()
check(/Total assets\s*\$288\.00/.test(bs) && /Total liabilities and equity\s*\$288\.00/.test(bs), 'balance sheet balances at 288.00')

await page.locator('.report-tabs').getByRole('button', { name: 'Trial balance' }).click()
await page.waitForFunction(() => document.querySelector('.report-table')?.textContent?.includes('Debit'))
check(/Total\s*\$380\.00\s*\$380\.00/.test(await page.locator('.report-table').innerText()), 'trial balance totals equal (380.00)')

await page.locator('.report-tabs').getByRole('button', { name: 'General ledger' }).click()
await page.locator('.gl-account').first().waitFor()
const gl = await page.locator('.report-body').innerText()
check(gl.includes('1000 Checking account') && gl.includes('Closing balance'), 'general ledger per account')
await shot(page, 'reports-gl')
await app.close()
done(errors)
