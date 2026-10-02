// Phase 5: items, purchases, year-end count, four methods, filed method, year-end entry.
import { launch, createCompany, shot, check, done, pickAccount } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
await page.getByRole('button', { name: 'Inventory' }).click()
await page.getByRole('heading', { name: 'Inventory', level: 2 }).waitFor()

// Items
for (const [name, unit] of [['Sterling silver sheet', 'g'], ['Moonstone cabochons', 'each']]) {
  await page.getByLabel('Item', { exact: true }).fill(name)
  await page.getByLabel('Unit').fill(unit)
  await page.getByRole('button', { name: 'Add item' }).click()
  await page.getByRole('cell', { name }).waitFor()
}
await page.getByLabel('Item', { exact: true }).fill('sterling silver SHEET')
await page.getByRole('button', { name: 'Add item' }).click()
check((await page.locator('.inventory .error').innerText()).includes('already an item'), 'duplicate item refused')

// Purchases
await page.getByRole('button', { name: /^Purchases/ }).click()
const add = async (date, item, qty, cost, opening = false) => {
  await page.getByLabel('Date', { exact: true }).fill(date)
  await page.locator('.inventory-form select').selectOption({ label: item })
  await page.getByLabel(/^Quantity/).fill(qty)
  await page.getByLabel('Total cost').fill(cost)
  if (opening) await page.getByLabel(/opening stock/).check()
  await page.getByRole('button', { name: 'Add purchase' }).click()
  await page.locator('.inventory table tbody tr').filter({ hasText: date }).first().waitFor()
}
await add('2026-01-01', 'Sterling silver sheet (g)', '100', '200', true)
await add('2026-03-01', 'Sterling silver sheet (g)', '50', '150')
await add('2026-06-01', 'Sterling silver sheet (g)', '50', '200')
await add('2026-04-10', 'Moonstone cabochons (each)', '12', '96')
const purchases = await page.locator('.inventory table').innerText()
check(purchases.includes('Opening stock') && purchases.includes('$4.00'), 'purchases listed with per-unit cost')
await page.getByLabel(/^Quantity/).fill('abc')
await page.getByLabel('Total cost').fill('5')
await page.getByRole('button', { name: 'Add purchase' }).click()
check((await page.locator('.inventory .error').innerText()).includes('how much you bought'), 'bad quantity refused')

// Year-end count
await page.getByRole('button', { name: 'Counts', exact: true }).click()
await page.getByLabel('Count date').fill('2026-12-31')
await page.getByLabel('Counted Sterling silver sheet').waitFor()
check((await page.locator('.count-sheet').innerText()).includes('200 g'), 'expected 200 g before counting')
await page.getByLabel('Counted Sterling silver sheet').fill('80')
await page.getByLabel('Counted Moonstone cabochons').fill('5')
await page.getByRole('button', { name: 'Save count' }).click()
await page.getByText('Count for 2026-12-31 saved.').waitFor()
await shot(page, 'inventory-count')

// Methods
await page.getByRole('button', { name: 'Methods and year end' }).click()
await page.locator('.methods-table').waitFor()
const table = await page.locator('.methods-table').innerText()
// Silver: FIFO 290, periodic 320, average 220; moonstones 5 × $8 = 40 under all three.
check(/FIFO[\s\S]*\$330\.00/.test(table), 'FIFO ending 330.00')
check(/Periodic[\s\S]*\$360\.00/.test(table), 'periodic ending 360.00')
check(/Weighted average[\s\S]*\$260\.00/.test(table), 'average ending 260.00')
check(/Expense as purchased[\s\S]*\$446\.00/.test(table), 'expensed COGS 446.00')
check((await page.getByText('Once a filed method is chosen').count()) === 1, 'nothing posted until a method is filed')
await page.locator('.inventory select').nth(1).selectOption('fifo')
await page.getByRole('button', { name: 'Save filed method' }).click()
await page.getByText('Filed method for 2026 saved.').waitFor()
await page.getByRole('button', { name: 'Post year-end inventory entry' }).click()
await page.getByText('Year-end inventory entry for 2026 posted.').waitFor()
check((await page.locator('.inventory').innerText()).includes('Inventory accounts in the books on that date: $330.00'), 'books inventory now 330.00')
// Change method needs a reason.
await page.locator('.inventory select').nth(1).selectOption('average')
await page.getByRole('button', { name: 'Save filed method' }).click()
check((await page.locator('.inventory .error').innerText()).includes('needs a reason'), 'changing the method needs a reason')
await page.getByLabel('Reason for the change').fill('Accountant filed Form 3115')
await page.getByRole('button', { name: 'Save filed method' }).click()
await page.getByText('Filed method for 2026 saved.').waitFor()
await page.getByRole('button', { name: 'Post it again (replace)' }).click()
await page.getByText('Year-end inventory entry for 2026 posted.').waitFor()
check((await page.locator('.inventory').innerText()).includes('on that date: $260.00'), 'replaced: books inventory 260.00')
await shot(page, 'inventory-methods')
await app.close()
done(errors)
