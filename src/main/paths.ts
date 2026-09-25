import { app } from 'electron'
import { join } from 'path'

/**
 * Root folder for sample/test companies used during development and Phase 0
 * checkpoints. Never points at the owner's real Documents\JunoBooks\ folder.
 *
 * In dev (npm start) this is <project root>/test-data, which is git-ignored.
 * In a packaged build it falls back to a folder under Electron's userData
 * directory, since the project's source folder isn't shipped with the app.
 */
export function getTestDataRoot(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'test-data')
  }
  return join(app.getAppPath(), 'test-data')
}

export function getSampleCompanyDir(): string {
  return join(getTestDataRoot(), 'Companies', 'Sample Company')
}
