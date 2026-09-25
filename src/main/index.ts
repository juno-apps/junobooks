import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { closeTestCompany, getTestCompanyStatus, openTestCompany } from './testCompany'

const isDev = !app.isPackaged

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
  openTestCompany()

  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    buildDate: __BUILD_DATE__
  }))

  ipcMain.handle('testCompany:status', () => getTestCompanyStatus())

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
  closeTestCompany()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeTestCompany()
})
