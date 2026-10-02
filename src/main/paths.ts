import { app } from 'electron'
import { join } from 'path'

/**
 * Root data folder (holds Companies\ and app-settings.json).
 *
 * In dev (npm start) this is <project root>/test-data, which is git-ignored.
 * Dev runs can point somewhere else with JUNOBOOKS_DATA_ROOT (used by the
 * Playwright live checks, which run in test-data/live). Packaged builds also
 * use a test folder (under Electron's userData) until the ledger is finished;
 * only then will they switch to Documents\JunoBooks. Neither ever points at
 * the owner's real books.
 */
export function getDataRoot(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'test-data')
  }
  return process.env['JUNOBOOKS_DATA_ROOT'] || join(app.getAppPath(), 'test-data')
}

export function getCompaniesDir(): string {
  return join(getDataRoot(), 'Companies')
}
