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
import type { ReconcileView } from '../shared/reconcile'
import type { AmazonImportInput, AmazonImportResult, AmazonMapping, AmazonPreview } from '../shared/amazonImport'
import type { TieOutRow } from '../shared/form1099k'
import type { BalanceSheet, GeneralLedger, ProfitAndLoss, TrialBalance } from '../shared/reports'
import type { ChannelSales, CogsSchedule, TaxLineSummary } from '../shared/reportsExtra'
import type { RateInput, SalesTaxPaymentInput, SalesTaxRate, SalesTaxReport } from '../shared/salesTax'
import type {
  AgingRow,
  BusinessDetails,
  CertificateInput,
  Customer,
  CustomerInput,
  Invoice,
  InvoiceInput,
  Payment,
  PaymentInput,
  ResaleCertificate
} from '../shared/sales'
import type { InventoryItem, InventoryMethod, InventoryPurchase, MethodSummary } from '../shared/inventory'
import type { CountSheet, InventoryOverview, InventoryYearReport, ItemInput, PurchaseInput } from '../shared/inventoryView'
import type {
  EtsyAccountStatus,
  EtsyFilesInput,
  EtsyImportInput,
  EtsyImportResult,
  EtsyMapping,
  EtsyPayout,
  EtsyPreview
} from '../shared/etsyImport'
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
  ChannelSales,
  CogsSchedule,
  TaxLineSummary,
  BalanceSheet,
  GeneralLedger,
  ProfitAndLoss,
  TrialBalance,
  RateInput,
  SalesTaxPaymentInput,
  SalesTaxRate,
  SalesTaxReport,
  AmazonImportInput,
  AmazonImportResult,
  AmazonMapping,
  AmazonPreview,
  TieOutRow,
  AgingRow,
  BusinessDetails,
  CertificateInput,
  Customer,
  CustomerInput,
  Invoice,
  InvoiceInput,
  Payment,
  PaymentInput,
  ResaleCertificate,
  CountSheet,
  InventoryItem,
  InventoryMethod,
  InventoryOverview,
  InventoryPurchase,
  InventoryYearReport,
  ItemInput,
  MethodSummary,
  PurchaseInput,
  EtsyAccountStatus,
  EtsyFilesInput,
  EtsyImportInput,
  EtsyImportResult,
  EtsyMapping,
  EtsyPayout,
  EtsyPreview,
  ReconcileView,
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
  businessDetails: () => Promise<Result<BusinessDetails>>
  setBusinessDetails: (d: Omit<BusinessDetails, 'name'>) => Promise<Result<BusinessDetails>>
  customers: () => Promise<Result<Customer[]>>
  addCustomer: (input: CustomerInput) => Promise<Result<Customer[]>>
  updateCustomer: (id: number, input: CustomerInput & { isActive: boolean }) => Promise<Result<Customer[]>>
  certificates: (customerId: number) => Promise<Result<ResaleCertificate[]>>
  /** File picker; null value = cancelled. */
  pickCertificateFile: () => Promise<Result<string | null>>
  addCertificate: (input: CertificateInput) => Promise<Result<ResaleCertificate[]>>
  removeCertificate: (id: number, customerId: number) => Promise<Result<ResaleCertificate[]>>
  openCertificate: (id: number) => Promise<Result<null>>
  validCertificate: (customerId: number, date: string) => Promise<Result<ResaleCertificate | null>>
  invoices: () => Promise<Result<Invoice[]>>
  nextInvoiceNumber: () => Promise<Result<string>>
  saveInvoiceDraft: (id: number | null, input: InvoiceInput) => Promise<Result<Invoice>>
  deleteInvoiceDraft: (id: number) => Promise<Result<void>>
  finalizeInvoice: (id: number) => Promise<Result<Invoice>>
  voidInvoice: (id: number, reason: string) => Promise<Result<Invoice>>
  /** Saves the PDF in exports\invoices and returns its path. */
  saveInvoicePdf: (id: number) => Promise<Result<string>>
  openInvoicePdf: (id: number) => Promise<Result<string>>
  recordPayment: (input: PaymentInput) => Promise<Result<Payment[]>>
  voidPayment: (id: number, reason: string) => Promise<Result<Payment[]>>
  payments: () => Promise<Result<Payment[]>>
  aging: (asOf: string) => Promise<Result<AgingRow[]>>
  inventoryOverview: () => Promise<Result<InventoryOverview>>
  addInventoryItem: (input: ItemInput) => Promise<Result<InventoryOverview>>
  updateInventoryItem: (id: number, input: ItemInput & { isActive: boolean }) => Promise<Result<InventoryOverview>>
  addInventoryPurchase: (input: PurchaseInput) => Promise<Result<InventoryOverview>>
  updateInventoryPurchase: (id: number, input: PurchaseInput) => Promise<Result<InventoryOverview>>
  removeInventoryPurchase: (id: number) => Promise<Result<InventoryOverview>>
  countSheet: (date: string) => Promise<Result<CountSheet>>
  saveCount: (date: string, rows: { itemId: number; quantityMilli: number | null }[]) => Promise<Result<CountSheet>>
  inventoryYear: (year: number) => Promise<Result<InventoryYearReport>>
  setFiledMethod: (year: number, method: InventoryMethod | null, reason: string) => Promise<Result<InventoryYearReport>>
  inventoryAdjustmentAccounts: () => Promise<Result<{ inventoryAccountId: number | null; cogsAccountId: number | null }>>
  postInventoryAdjustment: (year: number, inventoryAccountId: number, cogsAccountId: number) => Promise<Result<InventoryYearReport>>
  amazonAccounts: () => Promise<Result<EtsyAccountStatus[]>>
  addAmazonAccounts: () => Promise<Result<EtsyAccountStatus[]>>
  previewAmazon: (text: string) => Promise<Result<AmazonPreview>>
  importAmazon: (input: AmazonImportInput) => Promise<Result<AmazonImportResult>>
  amazonPayouts: () => Promise<Result<EtsyPayout[]>>
  profitAndLoss: (from: string, to: string, byMonth: boolean) => Promise<Result<ProfitAndLoss>>
  salesByChannel: (from: string, to: string) => Promise<Result<ChannelSales>>
  taxLineSummary: (year: number) => Promise<Result<TaxLineSummary>>
  cogsSchedule: (year: number) => Promise<Result<CogsSchedule>>
  balanceSheet: (asOf: string) => Promise<Result<BalanceSheet>>
  trialBalance: (asOf: string) => Promise<Result<TrialBalance>>
  generalLedger: (from: string, to: string) => Promise<Result<GeneralLedger>>
  /** Saves CSV text in exports\reports (name without extension) and returns the path; open = also open it. */
  saveCsv: (name: string, csv: string, open: boolean) => Promise<Result<string>>
  salesTaxRates: () => Promise<Result<SalesTaxRate[]>>
  addSalesTaxRate: (input: RateInput) => Promise<Result<SalesTaxRate[]>>
  removeSalesTaxRate: (id: number) => Promise<Result<SalesTaxRate[]>>
  homeRateOn: (date: string) => Promise<Result<SalesTaxRate | null>>
  salesTaxReport: (from: string, to: string) => Promise<Result<SalesTaxReport>>
  recordSalesTaxPayment: (input: SalesTaxPaymentInput) => Promise<Result<number>>
  tieOut1099k: (year: number) => Promise<Result<TieOutRow[]>>
  /** null clears the amount. */
  set1099k: (year: number, platform: string, grossCents: number | null, notes: string) => Promise<Result<TieOutRow[]>>
  etsyAccounts: () => Promise<Result<EtsyAccountStatus[]>>
  addEtsyAccounts: () => Promise<Result<EtsyAccountStatus[]>>
  previewEtsy: (input: EtsyFilesInput) => Promise<Result<EtsyPreview>>
  importEtsy: (input: EtsyImportInput) => Promise<Result<EtsyImportResult>>
  etsyPayouts: () => Promise<Result<EtsyPayout[]>>
  getReconcile: (accountId: number) => Promise<Result<ReconcileView>>
  /** Statement end date and ending balance (normal side, in cents). */
  setStatement: (accountId: number, date: string, cents: number) => Promise<Result<ReconcileView>>
  setCleared: (accountId: number, lineIds: number[], cleared: boolean) => Promise<Result<ReconcileView>>
  finishReconciliation: (accountId: number) => Promise<Result<ReconcileView>>
  cancelReconciliation: (accountId: number) => Promise<Result<ReconcileView>>
  undoReconciliation: (accountId: number, reason: string) => Promise<Result<ReconcileView>>
  getRegister: (q: RegisterQuery) => Promise<Result<RegisterView>>
  voidEntry: (id: number, reason: string) => Promise<Result<EntryListItem[]>>
  reverseEntry: (id: number, date: string, memo?: string) => Promise<Result<EntryListItem[]>>
}
