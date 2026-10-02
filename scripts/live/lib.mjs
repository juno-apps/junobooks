// Live-check helpers: launch the built JunoBooks app under Playwright, with
// its data folder pointed at test-data/live (never the owner's books).
// Dev-only tool; nothing here ships in the installer.
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DATA_ROOT = join(ROOT, 'test-data', 'live')
export const SHOTS = join(ROOT, 'test-data', 'live-shots')

/** Starts the app. `fresh: true` wipes test-data/live first. */
export async function launch({ fresh = false } = {}) {
  if (fresh) rmSync(DATA_ROOT, { recursive: true, force: true })
  mkdirSync(DATA_ROOT, { recursive: true })
  mkdirSync(SHOTS, { recursive: true })
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT],
    cwd: ROOT,
    env: { ...process.env, JUNOBOOKS_DATA_ROOT: DATA_ROOT, ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {})
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.waitForSelector('.app-main')
  return { app, page, errors }
}

export async function shot(page, name) {
  const file = join(SHOTS, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

/** Creates the "Live check" company through the New company form. */
export async function createCompany(page, { name = 'Live check', entity = 'smllc', template = 'product', start = '2026-01-01' } = {}) {
  const newBtn = page.getByRole('button', { name: /new company/i })
  if (await newBtn.count()) await newBtn.first().click()
  await page.getByLabel(/company name/i).fill(name)
  await page.getByLabel(/entity type/i).selectOption(entity)
  await page.getByLabel(/books start date/i).fill(start)
  await page.getByLabel(/starting chart of accounts/i).selectOption(template)
  await page.getByRole('button', { name: /create company/i }).click()
  await page.getByRole('heading', { name, level: 1 }).waitFor()
}

let failures = 0
export function check(cond, label) {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}`)
  }
}
export function done(errors = []) {
  if (errors.length) {
    console.log('Page errors:\n  ' + errors.join('\n  '))
    failures += errors.length
  }
  console.log(failures ? `${failures} live-check failure(s)` : 'Live check passed')
  process.exitCode = failures ? 1 : 0
}

/** Chooses an account in an AccountCombobox: click, type, click the first matching option. */
export async function pickAccount(page, label, text) {
  const box = page.getByRole('combobox', { name: label })
  await box.click()
  await box.fill(text)
  await page.locator('.combobox-list [role=option]').first().click()
}

/** Text of the red error message on screen, or null. */
export async function errorText(page) {
  const e = page.locator('.error')
  return (await e.count()) ? (await e.first().innerText()).trim() : null
}

/** Posts a manual entry through the app's own API (for setting up data). Lines are [accountNumber, cents]. */
export async function post(page, date, memo, lines) {
  return page.evaluate(
    async ({ date, memo, lines }) => {
      const chart = await window.juno.getChart()
      const id = (n) => chart.accounts.find((a) => a.number === n).id
      const r = await window.juno.postManualEntry({ date, memo, lines: lines.map(([n, c]) => ({ accountId: id(n), amountCents: c, memo: '' })) })
      if (!r.ok) throw new Error(r.error)
      return r.value
    },
    { date, memo, lines }
  )
}
