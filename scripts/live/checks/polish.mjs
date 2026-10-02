// Round-22 polish: red error clears once fixed, wider account lists, empty Transactions text.
import { launch, createCompany, shot, check, done, pickAccount, errorText } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
check((await page.locator('.muted').filter({ hasText: 'No transactions yet' }).innerText()).includes('New expense'), 'empty list mentions New expense')

await page.getByRole('button', { name: 'New expense' }).click()
await page.getByRole('button', { name: 'Post expense' }).click()
const first = await errorText(page)
check(first !== null, `error shown on empty post: ${first}`)
await pickAccount(page, 'How did you pay?', 'checking')
const second = await errorText(page)
check(second !== first, `error moves on after fixing one thing: ${second}`)
await pickAccount(page, 'Line 1 category', 'supplies')
await page.getByLabel('Line 1 amount').fill('12.50')
check((await errorText(page)) === null, 'error cleared once everything is filled in')

// Wide list: open the category box and measure the group headings.
const box = page.getByRole('combobox', { name: 'Line 2 category' })
await box.click()
const wraps = await page.locator('.combobox-group').evaluateAll((els) => els.filter((e) => e.scrollHeight > 30).length)
check(wraps === 0, 'group headings fit on one line')
await shot(page, 'polish-list-open')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: 'Post expense' }).click()
check(await page.locator('.success').isVisible(), 'expense posts')

// Save-side error (date before books start) clears when the date changes.
await page.locator('input[type=date]').first().fill('2025-12-31')
await pickAccount(page, 'How did you pay?', 'checking')
await pickAccount(page, 'Line 1 category', 'supplies')
await page.getByLabel('Line 1 amount').fill('5')
await page.getByRole('button', { name: 'Post expense' }).click()
check(((await errorText(page)) ?? '').includes('books start'), 'books-start refusal shown')
await page.locator('input[type=date]').first().fill('2026-02-01')
check((await errorText(page)) === null, 'books-start refusal clears after changing the date')
await shot(page, 'polish-after')
await app.close()
done(errors)
