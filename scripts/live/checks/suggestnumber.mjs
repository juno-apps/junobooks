// Suggest a free account number (top level and under a parent) and the Settings note on tax forms.
import { launch, createCompany, shot, check, done } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
await page.getByRole('button', { name: 'Chart of accounts' }).click()
await page.getByRole('button', { name: 'Add account' }).click()

// Top level: expense range, first unused multiple of 10
await page.getByRole('button', { name: 'Suggest a free number' }).click()
const first = await page.getByLabel('Number').inputValue()
check(/^6\d{2}0$/.test(first), `top-level suggestion is a free 6xx0 number (${first})`)

// Under a parent: 6100 ends in 0, so 6101 or the next free one
await page.getByLabel('Sub-account of').selectOption({ label: '6100 Marketplace and payment fees' })
await page.getByRole('button', { name: 'Suggest a free number' }).click()
const sub = await page.getByLabel('Number').inputValue()
check(/^610[1-9]$/.test(sub), `sub-account suggestion sits under 6100 (${sub})`)
await shot(page, 'suggest-number')

// Save it and ask again: the next one must be different
await page.getByLabel('Name').fill('Show booth fees')
await page.getByLabel('Tax category').selectOption('commissions_fees')
await page.getByRole('button', { name: 'Add account' }).last().click()
await page.locator('tr.sub-account').filter({ hasText: 'Show booth fees' }).waitFor()
await page.getByRole('button', { name: 'Add account' }).click()
await page.getByLabel('Sub-account of').selectOption({ label: '6100 Marketplace and payment fees' })
await page.getByRole('button', { name: 'Suggest a free number' }).click()
const next = await page.getByLabel('Number').inputValue()
check(next !== sub && /^610[1-9]$/.test(next), `next suggestion differs (${next})`)

// Settings explanation
await page.getByRole('button', { name: 'Settings' }).first().click()
await page.getByRole('heading', { name: 'Tax forms and future years' }).waitFor()
check((await page.locator('.settings').innerText()).includes('does not download tax forms'), 'Settings explains tax forms')
await shot(page, 'settings-tax-forms')

await app.close()
done(errors)
