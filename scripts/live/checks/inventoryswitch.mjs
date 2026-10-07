// Switching the filed inventory method: FIFO -> periodic count -> FIFO, books follow each time.
import { launch, createCompany, shot, check, done } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
await page.getByRole('button', { name: 'Inventory' }).click()
await page.getByRole('heading', { name: 'Inventory', level: 2 }).waitFor()

for (const [name, unit] of [['Sterling silver sheet', 'g'], ['Moonstone cabochons', 'each']]) {
  await page.getByLabel('Item', { exact: true }).fill(name)
  await page.getByLabel('Unit').fill(unit)
  await page.getByRole('button', { name: 'Add item' }).click()
  await page.getByRole('cell', { name }).waitFor()
}
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

await page.getByRole('button', { name: 'Counts', exact: true }).click()
await page.getByLabel('Count date').fill('2026-12-31')
await page.getByLabel('Counted Sterling silver sheet').waitFor()
await page.getByLabel('Counted Sterling silver sheet').fill('80')
await page.getByLabel('Counted Moonstone cabochons').fill('5')
await page.getByRole('button', { name: 'Save count' }).click()
await page.getByText('Count for 2026-12-31 saved.').waitFor()

await page.getByRole('button', { name: 'Methods and year end' }).click()
await page.locator('.methods-table').waitFor()
const books = async () => (await page.locator('.inventory').innerText())

// 1. File FIFO and post.
await page.locator('.inventory select').nth(1).selectOption('fifo')
await page.getByRole('button', { name: 'Save filed method' }).click()
await page.getByText('Filed method for 2026 saved.').waitFor()
await page.getByRole('button', { name: 'Post year-end inventory entry' }).click()
await page.getByText('Year-end inventory entry for 2026 posted.').waitFor()
check((await books()).includes('on that date: $330.00'), 'FIFO: books inventory 330.00')
await shot(page, 'switch-1-fifo')

// 2. Accountant wants periodic count: change (reason required), post again.
await page.locator('.inventory select').nth(1).selectOption('periodic')
await page.getByRole('button', { name: 'Save filed method' }).click()
check((await page.locator('.inventory .error').innerText()).includes('needs a reason'), 'switch refused without a reason')
await page.getByLabel('Reason for the change').fill('Accountant prefers periodic count')
await page.getByRole('button', { name: 'Save filed method' }).click()
await page.getByText('Filed method for 2026 saved.').waitFor()
await page.getByRole('button', { name: 'Post it again (replace)' }).click()
await page.getByText('Year-end inventory entry for 2026 posted.').waitFor()
check((await books()).includes('on that date: $360.00'), 'periodic: books inventory 360.00')
await shot(page, 'switch-2-periodic')

// 3. Back to FIFO.
await page.locator('.inventory select').nth(1).selectOption('fifo')
await page.getByLabel('Reason for the change').fill('Changed my mind before filing')
await page.getByRole('button', { name: 'Save filed method' }).click()
await page.getByText('Filed method for 2026 saved.').waitFor()
await page.getByRole('button', { name: 'Post it again (replace)' }).click()
await page.getByText('Year-end inventory entry for 2026 posted.').waitFor()
check((await books()).includes('on that date: $330.00'), 'back to FIFO: books inventory 330.00')

await shot(page, 'switch-3-fifo-again')
await app.close()
done(errors)
