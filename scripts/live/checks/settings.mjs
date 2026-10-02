// 2g: Settings screen and choosing the data folder (development copy: only inside test-data\live).
import { existsSync } from 'fs'
import { join } from 'path'
import { launch, createCompany, shot, check, done, DATA_ROOT } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
await page.getByRole('button', { name: 'Settings' }).click()
await page.getByRole('heading', { name: 'Settings' }).waitFor()
const text = await page.locator('.settings').innerText()
check(text.includes(DATA_ROOT) && text.includes('1 company here'), 'shows the folder and 1 company')
check(text.includes('development copy'), 'explains the development-copy limit')
await shot(page, 'settings')

// A folder outside the allowed area is refused in plain English.
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, 'C:\\Windows\\Temp\\JunoBooks-elsewhere')
await page.getByRole('button', { name: 'Use a different folder…' }).click()
check(((await page.locator('.settings .error').innerText()) ?? '').includes('only uses folders inside'), 'outside folder refused')

// A company folder is refused.
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, join(DATA_ROOT, 'Companies', 'Live check'))
await page.getByRole('button', { name: 'Use a different folder…' }).click()
check((await page.locator('.settings .error').innerText()).includes("single company's folder"), 'company folder refused')

// A new folder inside: switch, empty list, create a company there.
const second = join(DATA_ROOT, 'Second books')
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, second)
await page.getByRole('button', { name: 'Use a different folder…' }).click()
check((await page.locator('.settings .success').innerText()).includes('no companies there yet'), 'switched to the empty folder')
check(existsSync(join(DATA_ROOT, 'data-location.json')), 'choice saved in the pointer file')
await page.getByRole('button', { name: 'Close' }).click()
await page.getByRole('heading', { name: 'Welcome to JunoBooks' }).waitFor()
check(true, 'empty folder shows the first-company form')
await createCompany(page, { name: 'Second Co' })
check(existsSync(join(second, 'Companies', 'Second Co', 'books.sqlite')), 'new company created in the chosen folder')

// Restart: the choice sticks.
await app.close()
const r2 = await launch()
await r2.page.getByRole('heading', { name: 'Second Co', level: 1 }).waitFor()
check(true, 'after restart the chosen folder (and its last company) opens')

// Back to the standard folder: the first company is there again.
await r2.page.getByRole('button', { name: 'Settings' }).click()
await r2.page.getByRole('button', { name: 'Use the standard folder' }).click()
check((await r2.page.locator('.settings .success').innerText()).includes('1 company'), 'standard folder has its company back')
await r2.page.getByRole('button', { name: 'Close' }).click()
await r2.page.getByRole('button', { name: /Live check/ }).first().click()
await r2.page.getByRole('heading', { name: 'Live check', level: 1 }).waitFor()
check(true, 'Live check company opens from the list')
await r2.app.close()
done([...errors, ...r2.errors])
