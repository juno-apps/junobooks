import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import type { AccountInput } from '../shared/accounts'
import type { ManualEntryInput } from '../shared/journal'
import type { RegisterQuery } from '../shared/register'
import type { CompanyProfile, EntityChangeInput, HomeStateChangeInput, NewCompanyInput, Result } from '../shared/company'
import { readAppSettings, writeAppSettings } from './appSettings'
import { createCompany, listCompanies, openCompany, type CompanyBooks } from './companyStore'
import { getCompaniesDir, getDataRoot } from './paths'

const isDev = !app.isPackaged

let current: CompanyBooks | null = null

/** Opens a company (closing and backing up the previous one) and remembers it. */
function switchTo(folder: string): CompanyProfile {
  if (current?.folder === folder) return current.profile()
  const next = openCompany(getCompaniesDir(), folder)
  current?.close()
  current = next
  writeAppSettings(getDataRoot(), { ...readAppSettings(getDataRoot()), lastCompany: folder })
  return current.profile()
}

function closeCurrent(): void {
  current?.close()
  current = null
}

function requireCompany(): CompanyBooks {
  if (!current) throw new Error('No company is open.')
  return current
}

/** Turns thrown errors into a plain message the screen can show. */
function wrap<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, value: fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    title: 'JunoBooks',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const last = readAppSettings(getDataRoot()).lastCompany
  if (last) {
    try {
      switchTo(last)
    } catch {
      // Last company is gone or unreadable; start on the company list instead.
    }
  }

  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    buildDate: __BUILD_DATE__
  }))

  ipcMain.handle('companies:list', () => listCompanies(getCompaniesDir()))
  ipcMain.handle('companies:current', () => current?.profile() ?? null)
  ipcMain.handle('companies:open', (_e, folder: string) => wrap(() => switchTo(folder)))
  ipcMain.handle('company:history', () => current?.history() ?? null)
  ipcMain.handle('company:changeEntityType', (_e, input: EntityChangeInput) =>
    wrap(() => requireCompany().changeEntityType(input))
  )
  ipcMain.handle('company:correctStartingEntityType', (_e, entityType: string) =>
    wrap(() => requireCompany().correctStartingEntityType(entityType))
  )
  ipcMain.handle('company:removeEntityTypeChange', (_e, effectiveDate: string) =>
    wrap(() => requireCompany().removeEntityTypeChange(effectiveDate))
  )
  ipcMain.handle('company:changeHomeState', (_e, input: HomeStateChangeInput) =>
    wrap(() => requireCompany().changeHomeState(input))
  )
  ipcMain.handle('company:correctStartingHomeState', (_e, stateCode: string) =>
    wrap(() => requireCompany().correctStartingHomeState(stateCode))
  )
  ipcMain.handle('company:removeHomeStateChange', (_e, effectiveDate: string) =>
    wrap(() => requireCompany().removeHomeStateChange(effectiveDate))
  )
  ipcMain.handle('accounts:restore', (_e, numbers: string[]) => wrap(() => requireCompany().restoreAccounts(numbers)))
  ipcMain.handle('chart:get', () =>current?.chart() ?? null)
  ipcMain.handle('chart:setup', (_e, template: string) =>
    wrap(() => {
      if (!current) throw new Error('No company is open.')
      return current.setupChart(template)
    })
  )
  ipcMain.handle('accounts:add', (_e, input: AccountInput) => wrap(() => requireCompany().addAccount(input)))
  ipcMain.handle('accounts:update', (_e, id: number, input: AccountInput) =>
    wrap(() => requireCompany().updateAccount(id, input))
  )
  ipcMain.handle('accounts:setActive', (_e, id: number, active: boolean) =>
    wrap(() => requireCompany().setAccountActive(id, active))
  )
  ipcMain.handle('accounts:delete', (_e, id: number) => wrap(() => requireCompany().deleteAccount(id)))
  ipcMain.handle('entries:postManual', (_e, input: ManualEntryInput) =>
    wrap(() => requireCompany().postManualEntry(input))
  )
  ipcMain.handle('entries:list', () => current?.entries() ?? [])
  ipcMain.handle('accounts:register', (_e, q: RegisterQuery) => wrap(() => requireCompany().register(q)))
  ipcMain.handle('entries:void', (_e, id: number, reason: string) => wrap(() => requireCompany().voidEntry(id, reason)))
  ipcMain.handle('entries:reverse', (_e, id: number, date: string, memo?: string) =>
    wrap(() => requireCompany().reverseEntry(id, date, memo))
  )
  ipcMain.handle('companies:create', (_e, input: NewCompanyInput) =>
    wrap(() => switchTo(createCompany(getCompaniesDir(), input)))
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Checks GitHub Releases for a newer version and, if found, downloads it
  // and prompts to restart and install. No-ops harmlessly when running
  // unpackaged (npm start).
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify()
  }
})

app.on('window-all-closed', () => {
  closeCurrent()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeCurrent()
})
