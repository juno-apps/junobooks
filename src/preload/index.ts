import { contextBridge, ipcRenderer } from 'electron'
import type { JunoApi } from './types'

const api: JunoApi = {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  listCompanies: () => ipcRenderer.invoke('companies:list'),
  getCurrentCompany: () => ipcRenderer.invoke('companies:current'),
  openCompany: (folder) => ipcRenderer.invoke('companies:open', folder),
  createCompany: (input) => ipcRenderer.invoke('companies:create', input)
}

contextBridge.exposeInMainWorld('juno', api)
