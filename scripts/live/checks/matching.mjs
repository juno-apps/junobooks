// 3d: an imported line offers to match an entry typed in by hand, and a card payment already posted from checking.
import { join } from 'path'
import { launch, createCompany, shot, check, done, pickAccount, post, ROOT } from '../lib.mjs'

const sample = (n) => join(ROOT, 'samples', 'bank', n)
const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
const typed = await post(page, '2026-02-28', 'Rio Grande order (typed by hand)', [['5000', 24510], ['1000', -24510]])
await page.reload()
await page.waitForSelector('.app-main h1')

const importFile = async (account, file) => {
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, file)
  await page.getByRole('button', { name: 'Import bank file' }).click()
  await pickAccount(page, 'Import into', account)
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: /^Import \d+ lines?$/ }).click()
  await page.getByRole('button', { name: 'Review them now' }).click()
  await page.getByRole('heading', { name: 'Review imported lines' }).waitFor()
}

await importFile('checking', sample('checking-march-2026.csv'))
const rio = page.locator('.review-row').filter({ hasText: 'RIO GRANDE' })
check((await rio.locator('.match-box').innerText()).includes(`Match #${typed}`), 'Rio Grande line offers the typed entry')
await shot(page, 'matching-offer')
await rio.getByRole('button', { name: new RegExp(`Match #${typed}`) }).click()
await page.getByText(`Matched with entry #${typed}`).waitFor()
check((await page.locator('.review-row').filter({ hasText: 'RIO GRANDE' }).count()) === 0, 'matched line leaves the review list')

// Pay the card from checking, then import the card file: the payment line matches that entry.
const pay = page.locator('.review-row').filter({ hasText: 'AMEX EPAYMENT' })
await pay.getByRole('combobox').click()
await pay.getByRole('combobox').fill('credit card')
await page.getByRole('option').first().click()
await pay.getByRole('button', { name: 'Post' }).click()
await page.getByText('1 posted.').waitFor()
await page.getByRole('button', { name: 'Close' }).click()

await importFile('credit card', sample('card-amex-style-march-2026.csv'))
const cardPay = page.locator('.review-row').filter({ hasText: 'AUTOPAY PAYMENT' })
check((await cardPay.locator('.match-box').count()) === 1, 'card payment line offers the checking-side entry')
await cardPay.locator('.match-button').first().click()
await page.getByText(/Matched with entry/).waitFor()
await page.getByRole('button', { name: 'Close' }).click()

await page.getByRole('button', { name: 'Chart of accounts' }).click()
const chart = await page.locator('.chart-table').innerText()
check(chart.includes('$245.10'), 'materials counted once (245.10)')
check(chart.includes('-$530.40'), 'card shows the single 530.40 payment')
await app.close()
done(errors)
