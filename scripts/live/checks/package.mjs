// Phase 10: notes for the accountant and the one-click package (ZIP with workbook, PDF, CSVs, receipts).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'
import { launch, createCompany, shot, check, done, post, DATA_ROOT } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
await app.evaluate(({ shell }) => {
  globalThis.__shown = []
  shell.showItemInFolder = (p) => globalThis.__shown.push(p)
})
await post(page, '2026-02-01', 'Craft fair', [['1000', 30000], ['4000', -30000]])
const e = await post(page, '2026-02-03', 'Rio Grande', [['5000', 8000], ['1000', -8000]])
mkdirSync(join(DATA_ROOT, '..', 'live-samples'), { recursive: true })
const receipt = join(DATA_ROOT, '..', 'live-samples', 'rio.pdf')
writeFileSync(receipt, '%PDF-1.4 receipt')
await page.evaluate(async ([id, f]) => window.juno.addAttachments(id, [f]), [e, receipt])
await page.reload()
await page.waitForSelector('.app-main h1')

await page.getByRole('button', { name: 'Accountant package' }).click()
await page.getByRole('heading', { name: 'Accountant package' }).waitFor()
await page.getByLabel('Package year').selectOption('2026')
await page.locator('.note-list').first().waitFor()
const text = await page.locator('.package').innerText()
check(/To check before sending \(\d+\)/.test(text) && text.includes('been reconciled yet'), 'checks listed (e.g. reconciliation)')
check(text.includes('5000 Materials:'), 'account notes listed')
await shot(page, 'package-notes')
await page.getByRole('button', { name: 'Build 2026 package' }).click()
await page.getByText(/Saved .*Accountant package 2026\.zip/).waitFor({ timeout: 60000 })
const zipPath = join(DATA_ROOT, 'Companies', 'Live check', 'exports', 'Accountant package 2026.zip')
check(existsSync(zipPath), 'ZIP saved in exports')
const zip = await JSZip.loadAsync(readFileSync(zipPath))
const names = Object.keys(zip.files)
check(names.includes('Live check 2026 accountant workbook.xlsx'), 'workbook inside')
check(names.includes('Live check 2026 summary.pdf'), 'PDF summary inside')
check(names.includes('receipts/2026-02-03_Rio-Grande_80.00.pdf'), 'receipt inside')
const pdf = await zip.file('Live check 2026 summary.pdf').async('nodebuffer')
check(pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 5000, 'PDF is a real PDF')
writeFileSync(join(DATA_ROOT, '..', 'live-shots', 'package-summary.pdf'), pdf)
await page.getByRole('button', { name: 'Show in folder' }).click()
check((await app.evaluate(() => globalThis.__shown)).some((p) => p.endsWith('Accountant package 2026.zip')), 'show in folder')
await shot(page, 'package-built')
await app.close()
done(errors)
