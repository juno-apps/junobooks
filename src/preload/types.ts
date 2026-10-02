import type { AccountInput } from '../shared/accounts'
import type { EntryListItem, ManualEntryInput } from '../shared/journal'
import type { ChartAccount, ChartView } from '../shared/chart'
import type { RegisterQuery, RegisterRow, RegisterView } from '../shared/register'
import type { Attachment, AttachResult } from '../shared/attachments'
import type { OpeningBalanceInput, OpeningBalancesView } from '../shared/opening'
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
  Attachment,
  AttachResult,
  ChartAccount,
  ChartView,
  CompanyHistory,
  CompanyProfile,
  CompanySummary,
  EntityChangeInput,
  EntityChangeResult,
  HistoryRow,
  EntryListItem,
  HomeStateChangeInput,
  ManualEntryInput,
  NewCompanyInput,
  OpeningBalanceInput,
  OpeningBalancesView,
  RegisterQuery,
  RegisterRow,
  RegisterView,
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
  listEntries: () => Promise<EntryListItem[]>
  getOpeningBalances: () => Promise<Result<OpeningBalancesView>>
  saveOpeningBalances: (input: OpeningBalanceInput[]) => Promise<Result<number | null>>
  listAttachments: (entryId: number) => Promise<Result<Attachment[]>>
  addAttachments: (entryId: number, paths: string[]) => Promise<Result<AttachResult>>
  /** Opens the file picker, then attaches what was chosen (nothing if cancelled). */
  pickAttachments: (entryId: number) => Promise<Result<AttachResult>>
  openAttachment: (id: number) => Promise<Result<null>>
  showAttachment: (id: number) => Promise<Result<null>>
  removeAttachment: (id: number, reason: string) => Promise<Result<void>>
  /** The disk path of a file dropped on the window. */
  pathForFile: (file: File) => string
  getRegister: (q: RegisterQuery) => Promise<Result<RegisterView>>
  voidEntry: (id: number, reason: string) => Promise<Result<EntryListItem[]>>
  reverseEntry: (id: number, date: string, memo?: string) => Promise<Result<EntryListItem[]>>
}
