import type { AccountInput } from '../shared/accounts'
import type { ChartAccount, ChartView } from '../shared/chart'
import type { CompanyProfile, CompanySummary, NewCompanyInput, Result } from '../shared/company'

export type { AccountInput, ChartAccount, ChartView, CompanyProfile, CompanySummary, NewCompanyInput, Result }

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
  getChart: () => Promise<ChartView | null>
  setupChart: (template: string) => Promise<Result<CompanyProfile>>
  addAccount: (input: AccountInput) => Promise<Result<ChartView>>
  updateAccount: (id: number, input: AccountInput) => Promise<Result<ChartView>>
  setAccountActive: (id: number, active: boolean) => Promise<Result<ChartView>>
  deleteAccount: (id: number) => Promise<Result<ChartView>>
}
