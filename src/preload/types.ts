import type { CompanyProfile, CompanySummary, NewCompanyInput, Result } from '../shared/company'

export type { CompanyProfile, CompanySummary, NewCompanyInput, Result }

export interface AppInfo {
  version: string
  buildDate: string
}

export interface JunoApi {
  getAppInfo: () => Promise<AppInfo>
  listCompanies: () => Promise<CompanySummary[]>
  getCurrentCompany: () => Promise<CompanyProfile | null>
  openCompany: (folder: string) => Promise<Result<CompanyProfile>>
  createCompany: (input: NewCompanyInput) => Promise<Result<CompanyProfile>>
}
