import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo, JunoApi, TestCompanyStatus } from './types'

const api: JunoApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo'),
  getTestCompanyStatus: (): Promise<TestCompanyStatus> => ipcRenderer.invoke('testCompany:status')
}

contextBridge.exposeInMainWorld('juno', api)
