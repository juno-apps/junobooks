export interface AppInfo {
  version: string
  buildDate: string
}

export interface SmokeTestRow {
  id: number
  created_at: string
  note: string
}

export interface TestCompanyStatus {
  companyDir: string
  dbPath: string
  rows: SmokeTestRow[]
}

export interface JunoApi {
  getAppInfo: () => Promise<AppInfo>
  getTestCompanyStatus: () => Promise<TestCompanyStatus>
}
