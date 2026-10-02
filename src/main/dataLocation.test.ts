import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkDataFolder, countCompanies, readDataLocation, writeDataLocation } from './dataLocation'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-location-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('data location pointer', () => {
  it('reads back what was written, and clearing returns to the default', () => {
    const file = join(root, 'settings', 'data-location.json')
    expect(readDataLocation(file)).toBeNull()
    writeDataLocation(file, 'D:\\Books')
    expect(readDataLocation(file)).toBe('D:\\Books')
    writeDataLocation(file, null)
    expect(readDataLocation(file)).toBeNull()
  })

  it('ignores a damaged pointer file', () => {
    const file = join(root, 'data-location.json')
    writeFileSync(file, '{not json')
    expect(readDataLocation(file)).toBeNull()
  })
})

describe('checkDataFolder', () => {
  it('accepts a new folder (creating it) and an existing data root', () => {
    expect(checkDataFolder(join(root, 'New Books'))).toBeNull()
    expect(checkDataFolder(root)).toBeNull()
  })

  it('refuses a company folder, the Companies folder itself, a file, and blank', () => {
    mkdirSync(join(root, 'Companies', 'Acme'), { recursive: true })
    writeFileSync(join(root, 'Companies', 'Acme', 'books.sqlite'), '')
    expect(checkDataFolder(join(root, 'Companies', 'Acme'))).toMatch(/single company/)
    expect(checkDataFolder(join(root, 'Companies'))).toMatch(/one level up/)
    writeFileSync(join(root, 'file.txt'), '')
    expect(checkDataFolder(join(root, 'file.txt'))).toMatch(/file, not a folder/)
    expect(checkDataFolder('  ')).toMatch(/Choose a folder/)
  })

  it('keeps a development copy inside its test data', () => {
    const allowed = join(root, 'test-data')
    expect(checkDataFolder(join(allowed, 'other'), allowed)).toBeNull()
    expect(checkDataFolder(join(root, 'elsewhere'), allowed)).toMatch(/development copy/)
  })

  it('counts company folders', () => {
    expect(countCompanies(root)).toBe(0)
    mkdirSync(join(root, 'Companies', 'A'), { recursive: true })
    writeFileSync(join(root, 'Companies', 'A', 'books.sqlite'), '')
    mkdirSync(join(root, 'Companies', 'not a company'), { recursive: true })
    expect(countCompanies(root)).toBe(1)
  })
})
