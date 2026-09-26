import type { AccountInput } from '../shared/accounts'
import type { ManualEntryInput } from '../shared/journal'
import type { ChartAccount, ChartView } from '../shared/chart'
import type {
  CompanyHistory,
  CompanyProfile,
  CompanySummary,
  EntityChangeInput,
  EntityChangeResult,
  HistoryRow,
  HomeStateChangeInput,
  NewCompanyInput,
  Result
} from '../shared/company'

export type {
  AccountInput,
  ChartAccount,
  ChartView,
  CompanyHistory,
  CompanyProfile,
  CompanySummary,
  EntityChangeInput,
  EntityChangeResult,
  HistoryRow,
  HomeStateChangeInput,
  ManualEntryInput,
  NewCompanyInput,
  Result
}

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
  getHistory: () => Promise<CompanyHistory | null>
  changeEntityType: (input: EntityChangeInput) => Promise<Result<EntityChangeResult>>
  correctStartingEntityType: (entityType: string) => Promise<Result<EntityChangeResult>>
  removeEntityTypeChange: (effectiveDate: string) => Promise<Result<CompanyProfile>>
  changeHomeState: (input: HomeStateChangeInput) => Promise<Result<CompanyProfile>>
  correctStartingHomeState: (stateCode: string) => Promise<Result<CompanyProfile>>
  removeHomeStateChange: (effectiveDate: string) => Promise<Result<CompanyProfile>>
  restoreAccounts: (numbers: string[]) => Promise<Result<ChartView>>
  getChart: () => Promise<ChartView | null>
  setupChart: (template: string) => Promise<Result<CompanyProfile>>
  addAccount: (input: AccountInput) => Promise<Result<ChartView>>
  updateAccount: (id: number, input: AccountInput) => Promise<Result<ChartView>>
  setAccountActive: (id: number, active: boolean) => Promise<Result<ChartView>>
  deleteAccount: (id: number) => Promise<Result<ChartView>>
  postManualEntry: (input: ManualEntryInput) => Promise<Result<number>>
}
