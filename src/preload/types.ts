export interface AppInfo {
  version: string
  buildDate: string
}

export interface JunoApi {
  getAppInfo: () => Promise<AppInfo>
}
