import type { AccountInput } from '../shared/accounts'
import type { EntryListItem, ManualEntryInput } from '../shared/journal'
import type { ChartAccount, ChartView } from '../shared/chart'
import type { RegisterQuery, RegisterRow, RegisterView } from '../shared/register'
import type { Attachment, AttachResult } from '../shared/attachments'
import type { SettingsView } from '../shared/settings'
import type {
  BankLine,
  ImportBatchSummary,
  ImportFile,
  PostBankLineInput,
  PostBankLinesResult,
  StageImportInput,
  StageImportResult
} from '../shared/bankImport'
import type { ColumnMapping } from '../shared/csvImport'
import type { CategorizationRule, RuleInput } from '../shared/rules'
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
  CategorizationRule,
  RuleInput,
  BankLine,
  ColumnMapping,
  ImportBatchSummary,
  ImportFile,
  PostBankLineInput,
  PostBankLinesResult,
  StageImportInput,
  StageImportResult,
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
  Result,
  SettingsView
}

export interface AppInfo {
  version: string
  buildDate: string
}

export interface JunoApi {
  getAppInfo: () => Promise<AppInfo>
  getSettings: () => Promise<SettingsView>
  /** Opens a folder picker; null value = cancelled. */
  chooseDataFolder: () => Promise<Result<SettingsView | null>>
  /** null = back to the default folder. */
  useDataFolder: (dir: string | null) => Promise<Result<SettingsView>>
  openDataFolder: () => Promise<Result<null>>
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
  /** File picker for a CSV; null value = cancelled. */
  pickImportFile: () => Promise<Result<ImportFile | null>>
  readImportFile: (path: string) => Promise<Result<ImportFile>>
  savedMapping: (accountId: number, text: string, hasHeader: boolean) => Promise<Result<ColumnMapping | null>>
  stageImport: (input: StageImportInput) => Promise<Result<StageImportResult>>
  linesToReview: (accountId?: number) => Promise<Result<BankLine[]>>
  ignoredLines: (accountId: number) => Promise<Result<BankLine[]>>
  reviewCounts: () => Promise<{ accountId: number; count: number }[]>
  postBankLines: (items: PostBankLineInput[]) => Promise<Result<PostBankLinesResult>>
  matchBankLine: (lineId: number, entryId: number) => Promise<Result<void>>
  ignoreBankLines: (ids: number[]) => Promise<Result<void>>
  restoreBankLine: (id: number) => Promise<Result<void>>
  importHistory: () => Promise<Result<ImportBatchSummary[]>>
  listRules: () => Promise<Result<CategorizationRule[]>>
  addRule: (input: RuleInput) => Promise<Result<CategorizationRule[]>>
  updateRule: (id: number, input: RuleInput & { isActive: boolean }) => Promise<Result<CategorizationRule[]>>
  deleteRule: (id: number) => Promise<Result<CategorizationRule[]>>
  getRegister: (q: RegisterQuery) => Promise<Result<RegisterView>>
  voidEntry: (id: number, reason: string) => Promise<Result<EntryListItem[]>>
  reverseEntry: (id: number, date: string, memo?: string) => Promise<Result<EntryListItem[]>>
}
