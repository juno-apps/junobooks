import { contextBridge, ipcRenderer } from 'electron'
import type { JunoApi } from './types'

const api: JunoApi = {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  listCompanies: () => ipcRenderer.invoke('companies:list'),
  getCurrentCompany: () => ipcRenderer.invoke('companies:current'),
  openCompany: (folder) => ipcRenderer.invoke('companies:open', folder),
  createCompany: (input) => ipcRenderer.invoke('companies:create', input),
  getChart: () => ipcRenderer.invoke('chart:get'),
  setupChart: (template) => ipcRenderer.invoke('chart:setup', template),
  addAccount: (input) => ipcRenderer.invoke('accounts:add', input),
  updateAccount: (id, input) => ipcRenderer.invoke('accounts:update', id, input),
  setAccountActive: (id, active) => ipcRenderer.invoke('accounts:setActive', id, active),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id)
}

contextBridge.exposeInMainWorld('juno', api)
