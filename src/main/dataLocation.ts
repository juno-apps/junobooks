import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, relative, resolve } from 'path'

/**
 * Where the books live (the data root: Companies\ and app-settings.json).
 * The choice is kept in a small pointer file outside the data root, so the
 * data root itself can move. Nothing here imports Electron, so it can be tested.
 */

export function readDataLocation(pointerFile: string): string | null {
  try {
    const v = JSON.parse(readFileSync(pointerFile, 'utf8')) as { dataRoot?: unknown }
    return typeof v.dataRoot === 'string' && v.dataRoot ? v.dataRoot : null
  } catch {
    return null
  }
}

export function writeDataLocation(pointerFile: string, dataRoot: string | null): void {
  if (dataRoot === null) {
    rmSync(pointerFile, { force: true })
    return
  }
  mkdirSync(join(pointerFile, '..'), { recursive: true })
  writeFileSync(pointerFile, JSON.stringify({ dataRoot }, null, 2))
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !/^[a-zA-Z]:/.test(rel))
}

/** Checks a folder chosen as the data root. `allowedRoot` (dev builds) keeps the choice inside the project's test data.
 * Returns a plain-English problem, or null if it can be used (creating it if needed). */
export function checkDataFolder(dir: string, allowedRoot?: string): string | null {
  if (!dir.trim()) return 'Choose a folder.'
  const full = resolve(dir)
  if (allowedRoot && !isInside(full, allowedRoot)) {
    return `This is a development copy of JunoBooks, so it only uses folders inside ${allowedRoot}.`
  }
  if (existsSync(join(full, 'books.sqlite'))) {
    return 'That is a single company\'s folder. Choose the folder that holds the "Companies" folder instead.'
  }
  if (/[\\/]Companies[\\/]?$/i.test(full) && !existsSync(join(full, 'Companies'))) {
    return 'That looks like the "Companies" folder itself. Choose the folder one level up.'
  }
  try {
    if (existsSync(full) && !statSync(full).isDirectory()) return 'That is a file, not a folder.'
    mkdirSync(full, { recursive: true })
    const probe = join(full, `.junobooks-write-test-${process.pid}`)
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
  } catch {
    return "JunoBooks can't save files in that folder. Choose another one."
  }
  return null
}

/** How many company folders a data root holds (folders with a books.sqlite). */
export function countCompanies(dataRoot: string): number {
  const dir = join(dataRoot, 'Companies')
  if (!existsSync(dir)) return 0
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && existsSync(join(dir, e.name, 'books.sqlite'))
    ).length
  } catch {
    return 0
  }
}
