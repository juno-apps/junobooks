// 11a/11b: close books through a date, reopen with a reason, close a finished year into equity.
import { launch, createCompany, shot, check, done, post } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page, { start: '2025-01-01' })
await post(page, '2025-03-01', 'Sale', [['1000', 50000], ['4000', -50000]])
await post(page, '2025-04-01', 'Materials', [['5000', 12000], ['1000', -12000]])
await page.reload()
await page.waitForSelector('.app-main h1')

await page.getByRole('button', { name: 'Close books' }).click()
await page.getByRole('heading', { name: 'Close books' }).waitFor()
check((await page.locator('.lock-status').innerText()).includes('Nothing is closed yet'), 'starts open')

// Close a year
await page.getByLabel('Year to close').selectOption('2025')
await page.getByText(/Net income for 2025: \$380\.00/).waitFor()
check((await page.getByRole('combobox', { name: 'Close into' }).inputValue()).includes("Owner's capital"), "defaults to Owner's capital")
await page.getByRole('button', { name: 'Close 2025' }).click()
await page.getByText('2025 closed.').waitFor()
check((await page.locator('.lock-status').innerText()).includes('2025-12-31'), 'books closed through 2025-12-31')
check((await page.locator('.close-books').innerText()).includes("2025: $380.00 into Owner's capital"), 'closing listed')
await shot(page, 'closing-done')

// Reopen needs a reason
await page.getByLabel('Close through').fill('2025-06-30')
await page.getByRole('button', { name: 'Reopen back to 2025-06-30' }).click()
check((await page.locator('.close-books .error').innerText()).includes('reason'), 'reopening needs a reason')
await page.getByLabel('Reason for reopening').fill('Late receipt')
await page.getByRole('button', { name: 'Reopen back to 2025-06-30' }).click()
await page.getByText('Books closed through 2025-06-30.').waitFor()
check((await page.locator('.lock-history').innerText()).includes('reason: Late receipt'), 'reason kept in history')
await page.getByRole('button', { name: 'Close' }).first().click()

// Year reports still show the activity after closing
await page.getByRole('button', { name: 'Reports', exact: true }).click()
await page.getByLabel('Report from').fill('2025-01-01')
await page.getByLabel('Report to').fill('2025-12-31')
await page.locator('.report-table').waitFor()
check(/Net income\s*\$380\.00/.test(await page.locator('.report-table').innerText()), '2025 P&L still shows 380.00')
await page.locator('.report-tabs').getByRole('button', { name: 'Balance sheet' }).click()
await page.getByText(/Balanced: assets/).waitFor()
check(/Owner's capital\s*\$380\.00/.test(await page.locator('.report-table').innerText()), "Owner's capital holds 380.00")
await app.close()
done(errors)
