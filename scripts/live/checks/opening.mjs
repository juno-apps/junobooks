// 2e: opening balances screen.
import { launch, createCompany, shot, check, done, errorText } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
await page.getByRole('button', { name: 'Opening balances' }).click()
await page.getByRole('heading', { name: 'Opening balances' }).waitFor()
check((await page.locator('.opening').innerText()).includes('2026-01-01'), 'shows the books start date')
check((await page.getByLabel('Sales opening balance').count()) === 0, 'income accounts not offered')

await page.getByLabel('Checking account opening balance').fill('5,000')
await page.getByLabel('Credit card opening balance').fill('1200')
await page.getByLabel('Inventory: raw materials opening balance').fill('800.50')
check((await page.locator('.opening-difference').innerText()).includes('$4,600.50'), 'live difference $4,600.50')
await page.getByLabel('Savings account opening balance').fill('12x')
await page.getByRole('button', { name: 'Save opening balances' }).click()
check(((await errorText(page)) ?? '').includes("isn't an amount"), 'bad amount refused')
await page.getByLabel('Savings account opening balance').fill('')
await page.getByRole('button', { name: 'Save opening balances' }).click()
await page.locator('.success').waitFor()
check((await page.locator('.success').innerText()).includes('entry #1'), 'saved as entry #1')
await shot(page, 'opening-saved')

// Change one amount: old entry voided, new one posted.
await page.getByLabel('Checking account opening balance').fill('5100')
await page.getByRole('button', { name: 'Save opening balances' }).click()
await page.locator('.success').filter({ hasText: 'entry #2' }).waitFor()
await page.getByRole('button', { name: 'Close' }).click()
const list = await page.locator('.entry-list').innerText()
check(list.includes('Voided') && list.includes('Opening balances'), 'old entry voided, new one listed')

await page.getByRole('button', { name: 'Chart of accounts' }).click()
const chart = await page.locator('.chart-table').innerText()
check(chart.includes('$5,100.00') && chart.includes('$4,700.50'), 'chart shows checking 5,100 and opening equity 4,700.50')
await shot(page, 'opening-chart')
await app.close()
done(errors)
