import { app } from 'electron'
import { join } from 'path'
import { readDataLocation } from './dataLocation'

/**
 * Root data folder (holds Companies\ and app-settings.json).
 *
 * - Installed app: Documents\JunoBooks, or the folder chosen in Settings.
 * - Development copy (npm start): <project>\test-data, or a folder inside it
 *   chosen in Settings. Never the owner's real books. Live checks replace
 *   <project>\test-data with JUNOBOOKS_DATA_ROOT (development copy only).
 *
 * The Settings choice lives in a pointer file outside the data root
 * (installed: <userData>\data-location.json; development: test-data\data-location.json).
 */
export function isDev(): boolean {
  return !app.isPackaged
}

/** The project's test data folder (development copy only). */
export function devDataRoot(): string {
  return process.env['JUNOBOOKS_DATA_ROOT'] || join(app.getAppPath(), 'test-data')
}

export function defaultDataRoot(): string {
  return isDev() ? devDataRoot() : join(app.getPath('documents'), 'JunoBooks')
}

export function dataLocationFile(): string {
  return isDev() ? join(devDataRoot(), 'data-location.json') : join(app.getPath('userData'), 'data-location.json')
}

export function getDataRoot(): string {
  return readDataLocation(dataLocationFile()) ?? defaultDataRoot()
}

/** Where installed test versions (before Documents\JunoBooks) kept their practice companies. */
export function oldTestDataRoot(): string | null {
  return isDev() ? null : join(app.getPath('userData'), 'test-data')
}

export function getCompaniesDir(): string {
  return join(getDataRoot(), 'Companies')
}
