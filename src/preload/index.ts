import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo, JunoApi } from './types'

const api: JunoApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo')
}

contextBridge.exposeInMainWorld('juno', api)
