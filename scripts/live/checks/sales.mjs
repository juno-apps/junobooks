// Phase 6: customers, resale certificate, invoices (draft, finalize, PDF, void), payments, who owes you.
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { launch, createCompany, shot, check, done, pickAccount, DATA_ROOT } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
await app.evaluate(({ shell }) => {
  globalThis.__opened = []
  shell.openPath = async (p) => {
    globalThis.__opened.push(p)
    return ''
  }
})
await page.getByRole('button', { name: 'Invoices', exact: true }).click()
await page.getByRole('heading', { name: 'Sales and invoices' }).waitFor()

// Business details + customers
await page.getByRole('button', { name: 'Add your address and email' }).click()
await page.getByLabel('Business address').fill('9 Studio Way\nSan Diego CA 92101')
await page.getByLabel('Business email').fill('hello@livecheck.example')
await page.getByRole('button', { name: 'Save business details' }).click()
await page.getByRole('button', { name: /^Customers/ }).click()
const addCustomer = async (name, wholesale) => {
  await page.getByLabel('Customer name').fill(name)
  await page.getByLabel('Customer email').fill(`${name.split(' ')[0].toLowerCase()}@example.com`)
  if (wholesale) await page.getByLabel(/Wholesale buyer \(buys to resell/).check()
  await page.getByRole('button', { name: 'Add customer' }).click()
  await page.getByRole('cell', { name: new RegExp(name) }).waitFor()
}
await addCustomer('Bloom Boutique', true)
await addCustomer('Pat Retail', false)
await page.getByLabel('Customer email').fill('broken')
await page.getByLabel('Customer name').fill('Bad Email')
await page.getByRole('button', { name: 'Add customer' }).click()
check((await page.locator('.sales .error').first().innerText()).includes('email'), 'bad email refused')

// Resale certificate for Bloom
await page.getByRole('cell', { name: /Bloom Boutique/ }).click()
const certFile = join(DATA_ROOT, '..', 'live-samples', 'cert.pdf')
mkdirSync(join(DATA_ROOT, '..', 'live-samples'), { recursive: true })
writeFileSync(certFile, '%PDF-1.4 sample certificate')
await app.evaluate(({ dialog }, f) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
}, certFile)
await page.getByLabel('Certificate number').fill('SR AB 123-456789')
await page.getByLabel('Certificate issued').fill('2026-01-15')
await page.getByRole('button', { name: 'Attach a copy…' }).click()
await page.getByRole('button', { name: 'Add certificate' }).click()
await page.getByText('Certificate saved.').waitFor()
check((await page.locator('.cert-list').innerText()).includes('valid today'), 'certificate valid today')
check(existsSync(join(DATA_ROOT, 'Companies', 'Live check', 'resale-certificates', 'Bloom-Boutique_SR-AB-123-456789.pdf')), 'certificate copy stored')

// Wholesale invoice: exempt automatically
await page.locator('.sales .tabs').getByRole('button', { name: 'Invoices', exact: true }).click()
await page.getByRole('button', { name: 'New invoice' }).click()
await page.getByLabel('Invoice customer').selectOption({ label: 'Bloom Boutique' })
await page.getByLabel('Invoice date').fill('2026-03-02')
await page.getByLabel('Due date').fill('2026-04-01')
await page.getByLabel('Line 1 description').fill('Silver stacking rings')
await page.getByLabel('Line 1 quantity').fill('12')
await page.getByLabel('Line 1 price').fill('28')
await page.getByText(/Resale certificate SR AB 123-456789/).first().waitFor({ state: 'attached' }).catch(() => {})
check(await page.getByLabel(/^No sales tax/).isChecked(), 'wholesale with certificate: no sales tax by default')
check((await page.locator('.invoice-totals').innerText()).includes('Total $336.00'), 'total $336.00')
await page.getByRole('button', { name: 'Finalize invoice' }).click()
await page.locator('.invoice-list').waitFor()
await page.getByRole('button', { name: 'Open PDF' }).click()
await page.getByText(/Saved as .*Invoice-1001\.pdf/).waitFor()
check(existsSync(join(DATA_ROOT, 'Companies', 'Live check', 'exports', 'invoices', 'Invoice-1001.pdf')), 'PDF saved in exports\\invoices')
check((await app.evaluate(() => globalThis.__opened)).some((p) => p.endsWith('Invoice-1001.pdf')), 'PDF opened in Windows')
await shot(page, 'sales-invoice')

// Retail invoice with tax, saved as draft first
await page.getByRole('button', { name: 'New invoice' }).click()
await page.getByLabel('Invoice customer').selectOption({ label: 'Pat Retail' })
await page.getByLabel('Invoice date').fill('2026-01-10')
await page.getByLabel('Due date').fill('2026-01-25')
await page.getByLabel('Line 1 description').fill('Custom pendant')
await page.getByLabel('Line 1 price').fill('200')
await page.getByLabel('Line 2 description').fill('Shipping')
await page.getByLabel('Line 2 price').fill('12')
await page.getByLabel('Line 2 taxable').uncheck()
await pickAccount(page, 'Line 2 income account', 'shipping')
await page.getByLabel('Sales tax rate').fill('7.75')
check((await page.locator('.invoice-totals').innerText()).includes('Sales tax $15.50') , 'tax 7.75% of 200 = 15.50')
await page.getByRole('button', { name: 'Save draft' }).click()
await page.getByRole('button', { name: 'Edit draft' }).click()
await page.getByRole('button', { name: 'Finalize invoice' }).click()
await page.locator('.invoice-list').waitFor()

// Payment for 1002 from its row (it opens after finalizing)
await page.getByRole('button', { name: 'Record payment' }).click()
check((await page.getByLabel('Payment amount').inputValue()) === '227.50', 'payment prefilled with the open amount')
await page.getByLabel('Payment method').fill('Check')
await page.getByLabel('Payment reference').fill('#1123')
await page.getByRole('button', { name: 'Record payment' }).click()
await page.getByText('Payment recorded.').waitFor()

// Who owes you: Bloom 336 not due yet on 2026-03-15
await page.getByRole('button', { name: 'Who owes you' }).click()
await page.getByLabel('Aging as of').fill('2026-04-20')
await page.locator('.aging').waitFor()
const aging = await page.locator('.aging').innerText()
check(aging.includes('Bloom Boutique') && aging.includes('$336.00') && !aging.includes('Pat Retail'), 'aging shows Bloom 336.00 late, Pat paid')
await shot(page, 'sales-aging')
await page.getByRole('button', { name: 'Close' }).click()

await page.getByRole('button', { name: 'Chart of accounts' }).click()
const chart = await page.locator('.chart-table').innerText()
check(/Accounts receivable[\s\S]*?\$336\.00/.test(chart), 'receivable 336.00')
check(/Sales tax payable[\s\S]*?\$15\.50/.test(chart), 'sales tax payable 15.50')
check(/Checking account[\s\S]*?\$227\.50/.test(chart), 'checking 227.50')
await app.close()
done(errors)
