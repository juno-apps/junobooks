// 3c: categorization rules made from imported lines, applied to matching lines, managed in a list.
import { join } from 'path'
import { launch, createCompany, shot, check, done, pickAccount, ROOT } from '../lib.mjs'

const sample = (n) => join(ROOT, 'samples', 'bank', n)
const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
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

// Make a rule from the first Etsy payout line.
const etsy = page.locator('.review-row').filter({ hasText: 'ETSY INC PAYOUT 260303' })
await etsy.getByRole('button', { name: 'Make a rule…' }).click()
const form = page.locator('.rule-form')
check((await form.getByLabel('When the bank description contains').inputValue()) === 'ETSY INC PAYOUT', 'rule text suggested without the number')
await form.getByRole('combobox', { name: 'Rule account' }).click()
await form.getByRole('combobox', { name: 'Rule account' }).fill('sales')
await page.getByRole('option').first().click()
await form.getByLabel('and this memo (optional)').fill('Etsy payout')
await page.getByRole('button', { name: 'Save rule and fill in matching lines' }).click()
await page.getByText('Rule saved').waitFor()
const etsyRows = page.locator('.review-row').filter({ hasText: 'ETSY INC PAYOUT' })
check((await etsyRows.count()) === 2, 'two Etsy lines')
for (let i = 0; i < 2; i++) {
  const row = etsyRows.nth(i)
  check((await row.getByRole('combobox').inputValue()).includes('Sales'), `Etsy line ${i + 1} filled with Sales`)
  check((await row.innerText()).includes('From rule'), `Etsy line ${i + 1} says it came from a rule`)
  check((await row.locator('input[aria-label$="memo"]').inputValue()) === 'Etsy payout', `Etsy line ${i + 1} memo filled`)
}
await shot(page, 'rules-filled')

// Post both Etsy lines via select + post.
await etsyRows.nth(0).getByRole('checkbox').check()
await etsyRows.nth(1).getByRole('checkbox').check()
await page.getByRole('button', { name: 'Post 2 selected' }).click()
await page.getByText('2 posted.').waitFor()

// Manage: rule listed; turn it off.
await page.getByRole('button', { name: 'Categorization rules' }).click()
const table = page.locator('.rules-table')
check((await table.innerText()).includes('ETSY INC PAYOUT') && (await table.innerText()).includes('Checking account'), 'rule listed, limited to Checking')
await table.getByRole('button', { name: 'Turn off' }).click()
check((await table.locator('tr.inactive').count()) === 1, 'rule turned off')
await shot(page, 'rules-manager')
await table.getByRole('button', { name: 'Turn on' }).click()
await page.getByRole('button', { name: 'Close' }).click()

// A later import picks up the rule automatically.
await importFile('checking', sample('checking-march-april-2026.csv'))
const april = page.locator('.review-row').filter({ hasText: 'ETSY INC PAYOUT 260407' })
check((await april.getByRole('combobox').inputValue()).includes('Sales'), 'new import gets the rule')
// The rule only applies to checking: a card line with the same words wouldn't match (covered by tests).
await page.getByRole('button', { name: 'Categorization rules' }).click()
await page.locator('.rules-table').getByRole('button', { name: 'Delete' }).click()
check((await page.getByText('No rules yet').count()) === 1, 'rule deleted')
await app.close()
done(errors)
