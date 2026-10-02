import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { RECEIPT_EXTENSIONS } from '../shared/attachments'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import type { AccountInput } from '../shared/accounts'
import type { ManualEntryInput } from '../shared/journal'
import type { RegisterQuery } from '../shared/register'
import type { OpeningBalanceInput } from '../shared/opening'
import type { CompanyProfile, EntityChangeInput, HomeStateChangeInput, NewCompanyInput, Result } from '../shared/company'
import { readAppSettings, writeAppSettings } from './appSettings'
import { createCompany, listCompanies, openCompany, type CompanyBooks } from './companyStore'
import { checkDataFolder, countCompanies, writeDataLocation } from './dataLocation'
import { dataLocationFile, defaultDataRoot, devDataRoot, getCompaniesDir, getDataRoot, isDev as isDevCopy, oldTestDataRoot } from './paths'
import type { SettingsView } from '../shared/settings'
import { readImportFile } from './bankImport'
import type { PostBankLineInput, StageImportInput } from '../shared/bankImport'
import type { RuleInput } from '../shared/rules'
import type { EtsyFilesInput, EtsyImportInput } from '../shared/etsyImport'
import { BACKUPS_TO_KEEP } from './companyStore'

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

function settingsView(): SettingsView {
  const dataRoot = getDataRoot()
  const old = oldTestDataRoot()
  const oldCount = old ? countCompanies(old) : 0
  return {
    dataRoot,
    defaultRoot: defaultDataRoot(),
    isDefault: dataRoot === defaultDataRoot(),
    isDev: isDevCopy(),
    companyCount: countCompanies(dataRoot),
    oldTestData: old && oldCount > 0 && old !== dataRoot ? { path: old, companyCount: oldCount } : null,
    backupsKept: BACKUPS_TO_KEEP
  }
}

/** Points JunoBooks at another data folder (nothing is moved or copied). Closes the open company first. */
function useDataFolder(dir: string | null): SettingsView {
  if (dir !== null) {
    const problem = checkDataFolder(dir, isDevCopy() ? devDataRoot() : undefined)
    if (problem) throw new Error(problem)
  }
  closeCurrent()
  writeDataLocation(dataLocationFile(), dir === null || dir === defaultDataRoot() ? null : dir)
  return settingsView()
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

  ipcMain.handle('settings:get', () => settingsView())
  ipcMain.handle('settings:chooseFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose the JunoBooks data folder',
      defaultPath: getDataRoot(),
      properties: ['openDirectory', 'createDirectory']
    }
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return { ok: true, value: null }
    return wrap(() => useDataFolder(picked.filePaths[0]))
  })
  ipcMain.handle('settings:useFolder', (_e, dir: string | null) => wrap(() => useDataFolder(dir)))
  ipcMain.handle('settings:openFolder', async () => {
    const problem = await shell.openPath(getDataRoot())
    return problem ? { ok: false, error: problem } : { ok: true, value: null }
  })
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
  ipcMain.handle('opening:get', () => wrap(() => requireCompany().openingBalances()))
  ipcMain.handle('opening:save', (_e, input: OpeningBalanceInput[]) => wrap(() => requireCompany().saveOpeningBalances(input)))
  ipcMain.handle('attachments:list', (_e, entryId: number) => wrap(() => requireCompany().attachments(entryId)))
  ipcMain.handle('attachments:add', (_e, entryId: number, paths: string[]) => wrap(() => requireCompany().attach(entryId, paths)))
  ipcMain.handle('attachments:pick', async (e, entryId: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Attach receipts',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Receipts', extensions: RECEIPT_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return { ok: true, value: { added: [], skipped: [] } }
    return wrap(() => requireCompany().attach(entryId, picked.filePaths))
  })
  ipcMain.handle('attachments:open', async (_e, id: number) => {
    const file = wrap(() => requireCompany().attachmentFile(id))
    if (!file.ok) return file
    const problem = await shell.openPath(file.value)
    return problem ? { ok: false, error: `Windows couldn't open it: ${problem}` } : { ok: true, value: null }
  })
  ipcMain.handle('attachments:show', (_e, id: number) =>
    wrap(() => {
      shell.showItemInFolder(requireCompany().attachmentFile(id))
      return null
    })
  )
  ipcMain.handle('attachments:remove', (_e, id: number, reason: string) =>
    wrap(() => requireCompany().removeAttachment(id, reason))
  )
  ipcMain.handle('imports:pickFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a bank or card download',
      properties: ['openFile'],
      filters: [
        { name: 'Bank downloads (CSV)', extensions: ['csv', 'txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return { ok: true, value: null }
    return wrap(() => readImportFile(picked.filePaths[0]))
  })
  ipcMain.handle('imports:readFile', (_e, path: string) => wrap(() => readImportFile(path)))
  ipcMain.handle('imports:savedMapping', (_e, accountId: number, text: string, hasHeader: boolean) =>
    wrap(() => requireCompany().savedMapping(accountId, text, hasHeader))
  )
  ipcMain.handle('imports:stage', (_e, input: StageImportInput) => wrap(() => requireCompany().stageImport(input)))
  ipcMain.handle('imports:review', (_e, accountId?: number) => wrap(() => requireCompany().linesToReview(accountId)))
  ipcMain.handle('imports:ignored', (_e, accountId: number) => wrap(() => requireCompany().ignoredLines(accountId)))
  ipcMain.handle('imports:counts', () => (current ? current.reviewCounts() : []))
  ipcMain.handle('imports:post', (_e, items: PostBankLineInput[]) => wrap(() => requireCompany().postBankLines(items)))
  ipcMain.handle('imports:match', (_e, lineId: number, entryId: number) =>
    wrap(() => requireCompany().matchBankLine(lineId, entryId))
  )
  ipcMain.handle('imports:ignore', (_e, ids: number[]) => wrap(() => requireCompany().ignoreBankLines(ids)))
  ipcMain.handle('imports:restore', (_e, id: number) => wrap(() => requireCompany().restoreBankLine(id)))
  ipcMain.handle('imports:history', () => wrap(() => requireCompany().importHistory()))
  ipcMain.handle('rules:list', () => wrap(() => requireCompany().rules()))
  ipcMain.handle('rules:add', (_e, input: RuleInput) => wrap(() => requireCompany().addRule(input)))
  ipcMain.handle('rules:update', (_e, id: number, input: RuleInput & { isActive: boolean }) =>
    wrap(() => requireCompany().updateRule(id, input))
  )
  ipcMain.handle('rules:delete', (_e, id: number) => wrap(() => requireCompany().deleteRule(id)))
  ipcMain.handle('etsy:accounts', () => wrap(() => requireCompany().etsyAccounts()))
  ipcMain.handle('etsy:addAccounts', () => wrap(() => requireCompany().addEtsyAccounts()))
  ipcMain.handle('etsy:preview', (_e, input: EtsyFilesInput) => wrap(() => requireCompany().previewEtsy(input)))
  ipcMain.handle('etsy:import', (_e, input: EtsyImportInput) => wrap(() => requireCompany().importEtsy(input)))
  ipcMain.handle('etsy:payouts', () => wrap(() => requireCompany().etsyPayouts()))
  ipcMain.handle('reconcile:get', (_e, accountId: number) => wrap(() => requireCompany().reconcileView(accountId)))
  ipcMain.handle('reconcile:statement', (_e, accountId: number, date: string, cents: number) =>
    wrap(() => requireCompany().setStatement(accountId, date, cents))
  )
  ipcMain.handle('reconcile:clear', (_e, accountId: number, lineIds: number[], cleared: boolean) =>
    wrap(() => requireCompany().setCleared(accountId, lineIds, cleared))
  )
  ipcMain.handle('reconcile:finish', (_e, accountId: number) => wrap(() => requireCompany().finishReconciliation(accountId)))
  ipcMain.handle('reconcile:cancel', (_e, accountId: number) => wrap(() => requireCompany().cancelReconciliation(accountId)))
  ipcMain.handle('reconcile:undo', (_e, accountId: number, reason: string) =>
    wrap(() => requireCompany().undoLastReconciliation(accountId, reason))
  )
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
