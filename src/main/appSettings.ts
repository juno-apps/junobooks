import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Per-PC app preferences (not company data), stored as app-settings.json in the data root. */
export interface AppSettings {
  lastCompany?: string
}

const FILE = 'app-settings.json'

export function readAppSettings(dataRoot: string): AppSettings {
  try {
    return JSON.parse(readFileSync(join(dataRoot, FILE), 'utf8')) as AppSettings
  } catch {
    return {}
  }
}

export function writeAppSettings(dataRoot: string, settings: AppSettings): void {
  mkdirSync(dataRoot, { recursive: true })
  writeFileSync(join(dataRoot, FILE), JSON.stringify(settings, null, 2))
}
