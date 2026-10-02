import { contextBridge, ipcRenderer } from 'electron'
import type { JunoApi } from './types'

const api: JunoApi = {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  listCompanies: () => ipcRenderer.invoke('companies:list'),
  getCurrentCompany: () => ipcRenderer.invoke('companies:current'),
  openCompany: (folder) => ipcRenderer.invoke('companies:open', folder),
  createCompany: (input) => ipcRenderer.invoke('companies:create', input),
  getHistory: () => ipcRenderer.invoke('company:history'),
  changeEntityType: (input) => ipcRenderer.invoke('company:changeEntityType', input),
  correctStartingEntityType: (entityType) => ipcRenderer.invoke('company:correctStartingEntityType', entityType),
  removeEntityTypeChange: (effectiveDate) => ipcRenderer.invoke('company:removeEntityTypeChange', effectiveDate),
  changeHomeState: (input) => ipcRenderer.invoke('company:changeHomeState', input),
  correctStartingHomeState: (stateCode) => ipcRenderer.invoke('company:correctStartingHomeState', stateCode),
  removeHomeStateChange: (effectiveDate) => ipcRenderer.invoke('company:removeHomeStateChange', effectiveDate),
  restoreAccounts: (numbers) => ipcRenderer.invoke('accounts:restore', numbers),
  getChart: () =>ipcRenderer.invoke('chart:get'),
  setupChart: (template) => ipcRenderer.invoke('chart:setup', template),
  addAccount: (input) => ipcRenderer.invoke('accounts:add', input),
  updateAccount: (id, input) => ipcRenderer.invoke('accounts:update', id, input),
  setAccountActive: (id, active) => ipcRenderer.invoke('accounts:setActive', id, active),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),
  postManualEntry: (input) => ipcRenderer.invoke('entries:postManual', input),
  listEntries: () => ipcRenderer.invoke('entries:list'),
  getOpeningBalances: () => ipcRenderer.invoke('opening:get'),
  saveOpeningBalances: (input) => ipcRenderer.invoke('opening:save', input),
  getRegister: (q) => ipcRenderer.invoke('accounts:register', q),
  voidEntry: (id, reason) => ipcRenderer.invoke('entries:void', id, reason),
  reverseEntry: (id, date, memo) => ipcRenderer.invoke('entries:reverse', id, date, memo)
}

contextBridge.exposeInMainWorld('juno', api)
