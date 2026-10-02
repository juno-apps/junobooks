// 2f: receipts attached to entries (file picker stubbed; opening files stubbed).
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { launch, createCompany, shot, check, done, pickAccount, DATA_ROOT } from '../lib.mjs'

const samples = join(DATA_ROOT, '..', 'live-samples')
mkdirSync(samples, { recursive: true })
const pdf = join(samples, 'rio-invoice.pdf')
const png = join(samples, 'photo.png')
const exe = join(samples, 'tool.exe')
writeFileSync(pdf, '%PDF-1.4 sample receipt')
writeFileSync(png, 'not really a png but fine for a copy test')
writeFileSync(exe, 'nope')

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
await app.evaluate(({ dialog, shell }, files) => {
  globalThis.__opened = []
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
  shell.openPath = async (p) => {
    globalThis.__opened.push(p)
    return ''
  }
  shell.showItemInFolder = (p) => globalThis.__opened.push(`show:${p}`)
}, [pdf, exe])

// Post an expense, then attach straight from the success line.
await page.getByRole('button', { name: 'New expense' }).click()
await page.getByLabel('Paid to').fill('Rio Grande')
await pickAccount(page, 'How did you pay?', 'checking')
await pickAccount(page, 'Line 1 category', 'materials')
await page.getByLabel('Line 1 amount').fill('42.10')
await page.getByRole('button', { name: 'Post expense' }).click()
await page.locator('.success').waitFor()
await page.getByRole('button', { name: 'Attach receipt…' }).click()
const msg = await page.locator('.receipts-compact').innerText()
check(msg.includes('1 receipt attached') && msg.includes("tool.exe .exe files aren't accepted"), `attach after posting: ${msg}`)
await shot(page, 'receipts-after-post')
await page.getByRole('button', { name: 'Close' }).click()

// Transaction list shows the paperclip; detail lists the file.
const row = page.locator('.entry-row').first()
check((await row.innerText()).includes('📎'), 'paperclip on the list row')
await row.click()
const stored = '2026-10-02_Rio-Grande_42.10.pdf'
await page.getByRole('button', { name: /Rio-Grande_42\.10\.pdf/ }).waitFor()
check(existsSync(join(DATA_ROOT, 'Companies', 'Live check', 'receipts', '2026')), 'receipts\\2026 folder created')
const files = readdirSync(join(DATA_ROOT, 'Companies', 'Live check', 'receipts', '2026'))
check(files.length === 1 && files[0].endsWith('_Rio-Grande_42.10.pdf'), `file named date_vendor_amount: ${files[0]}`)

await page.getByRole('button', { name: /Rio-Grande_42\.10\.pdf/ }).click()
await page.getByRole('button', { name: 'Show in folder' }).click()
const opened = await app.evaluate(() => globalThis.__opened)
check(opened.length === 2 && opened[0].endsWith('.pdf') && opened[1].startsWith('show:'), 'open and show-in-folder go to Windows')

// Attach a second via picker in the detail; duplicate PDF is skipped.
await app.evaluate(({ dialog }, files) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
}, [png, pdf])
await page.locator('.receipts').getByRole('button', { name: 'Attach receipt…' }).click()
const detailMsg = await page.locator('.receipts .success, .receipts .error').innerText()
check(detailMsg.includes('1 receipt attached') && detailMsg.includes('already attached'), `second attach: ${detailMsg}`)
check((await page.locator('.receipt-list li').count()) === 2, 'two receipts listed')
await shot(page, 'receipts-detail')

// Remove one with a reason.
await page.getByRole('button', { name: 'Remove…' }).first().click()
await page.getByPlaceholder(/Reason/).fill('wrong file')
await page.getByRole('button', { name: 'Remove', exact: true }).click()
await page.getByText('Receipt removed').waitFor()
check((await page.locator('.receipt-list li').count()) === 1, 'one receipt left after removing')
check(readdirSync(join(DATA_ROOT, 'Companies', 'Live check', 'receipts', '_removed')).length === 1, 'removed file kept in receipts\\_removed')

// Cancelled picker does nothing.
await app.evaluate(({ dialog }) => {
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
})
await page.locator('.receipts').getByRole('button', { name: 'Attach receipt…' }).click()
check((await page.locator('.receipt-list li').count()) === 1, 'cancelled picker changes nothing')
void stored
await app.close()
done(errors)
