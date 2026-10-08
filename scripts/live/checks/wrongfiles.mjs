// Wrong-file uploads: Etsy and Amazon imports refuse files of the wrong kind, never keep them in the slot, and leave the books untouched.
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { launch, createCompany, shot, check, done, ROOT, DATA_ROOT } from '../lib.mjs'

const etsy = (n) => join(ROOT, 'samples', 'etsy', n)
const amz = join(ROOT, 'samples', 'amazon', 'settlement-24000000001.txt')
const dir = join(DATA_ROOT, '..', 'live-samples')
mkdirSync(dir, { recursive: true })
const bank = join(dir, 'wrong-bank.csv')
writeFileSync(bank, 'Date,Description,Amount\r\n03/16/2026,ETSY INC PAYOUT 260316,110.65\r\n')
const empty = join(dir, 'wrong-empty.csv')
writeFileSync(empty, '')
const notes = join(dir, 'wrong-notes.txt')
writeFileSync(notes, 'Remember to buy shipping labels.\nCall the accountant.\n')

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
const willPick = (f) =>
  app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, f)
const errText = async () => {
  await page.locator('p.error').first().waitFor()
  return (await page.locator('p.error').first().innerText()).trim()
}

// ---- Etsy ----
await page.getByRole('button', { name: 'Import from Etsy' }).click()
await page.getByRole('heading', { name: 'Import from Etsy' }).waitFor()
await page.getByRole('button', { name: 'Add these accounts' }).click()
await page.locator('.etsy-setup').waitFor({ state: 'detached' })

const statementTries = [
  ['Sold Orders file in the statement slot', etsy('EtsySoldOrders2026-3.csv')],
  ['bank file in the statement slot', bank],
  ['Amazon settlement in the statement slot', amz],
  ['empty file in the statement slot', empty],
  ['plain notes file in the statement slot', notes]
]
for (const [label, file] of statementTries) {
  await willPick(file)
  await page.getByRole('button', { name: /^(Choose statement…|Change…)$/ }).first().click()
  const msg = await errText()
  console.log(`  [${label}] -> ${msg}`)
  check(msg.includes('was not used') && (await page.getByRole('heading', { name: 'What this statement holds' }).count()) === 0, `Etsy refuses: ${label}`)
  check((await page.getByText('not chosen').count()) >= 1 && (await page.getByRole('button', { name: 'Choose statement…' }).count()) === 1, `statement slot stays empty after: ${label}`)
}
await shot(page, 'wrong-etsy-statement')

// Right statement, then wrong file in the orders slot.
await willPick(etsy('etsy_statement_2026_3.csv'))
await page.getByRole('button', { name: /^(Choose statement…|Change…)$/ }).first().click()
await page.getByRole('heading', { name: 'What this statement holds' }).waitFor()
for (const [label, file] of [
  ['statement in the orders slot', etsy('etsy_statement_2026_3.csv')],
  ['bank file in the orders slot', bank],
  ['notes file in the orders slot', notes]
]) {
  await willPick(file)
  await page.getByRole('button', { name: /^(Choose orders file…|Change…)$/ }).last().click()
  const msg = await errText()
  console.log(`  [${label}] -> ${msg}`)
  check(msg.includes('was not used'), `Etsy refuses: ${label}`)
  check((await page.getByRole('button', { name: /^Import \d+ Etsy rows?$/ }).count()) === 1, `good preview and Import button stay after: ${label}`)
  check((await page.getByRole('button', { name: 'Choose orders file…' }).count()) === 1, `orders slot stays empty after: ${label}`)
}
await shot(page, 'wrong-etsy-orders')
await page.getByRole('button', { name: 'Close' }).click()

// ---- Amazon ----
await page.getByRole('button', { name: 'Import from Amazon' }).click()
await page.getByRole('heading', { name: 'Import from Amazon' }).waitFor()
await page.getByRole('button', { name: 'Add these accounts' }).click()
await page.locator('.etsy-setup').waitFor({ state: 'detached' })
for (const [label, file] of [
  ['Etsy statement in the Amazon slot', etsy('etsy_statement_2026_3.csv')],
  ['Etsy Sold Orders in the Amazon slot', etsy('EtsySoldOrders2026-3.csv')],
  ['bank file in the Amazon slot', bank],
  ['empty file in the Amazon slot', empty],
  ['plain notes file in the Amazon slot', notes]
]) {
  await willPick(file)
  await page.getByRole('button', { name: /^(Choose settlement report…|Change…)$/ }).first().click()
  const msg = await errText()
  console.log(`  [${label}] -> ${msg}`)
  check(msg.includes('was not used') && (await page.getByRole('heading', { name: /Settlement / }).count()) === 0, `Amazon refuses: ${label}`)
  check((await page.getByRole('button', { name: 'Choose settlement report…' }).count()) === 1, `Amazon slot stays empty after: ${label}`)
}
await shot(page, 'wrong-amazon')
// The right file still works afterwards.
await willPick(amz)
await page.getByRole('button', { name: /^(Choose settlement report…|Change…)$/ }).first().click()
await page.getByRole('heading', { name: /Settlement 24000000001/ }).waitFor()
check(true, 'right Amazon file still loads after the wrong ones')
await page.getByRole('button', { name: 'Close' }).click()

// Nothing was posted by any wrong file.
await page.getByRole('button', { name: 'Chart of accounts' }).click()
const chart = await page.locator('.chart-table').innerText()
check(!chart.includes('$110.65') && !chart.includes('$59.39'), 'no money landed in the books from wrong files')
await app.close()
done(errors)
