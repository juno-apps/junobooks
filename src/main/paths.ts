import { app } from 'electron'
import { join } from 'path'

/**
 * Root data folder (holds Companies\ and app-settings.json).
 *
 * In dev (npm start) this is <project root>/test-data, which is git-ignored.
 * Packaged builds also use a test folder (under Electron's userData) until
 * the ledger is finished; only then will they switch to Documents\JunoBooks.
 * Neither ever points at the owner's real books.
 */
export function getDataRoot(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'test-data')
  }
  return join(app.getAppPath(), 'test-data')
}

export function getCompaniesDir(): string {
  return join(getDataRoot(), 'Companies')
}
