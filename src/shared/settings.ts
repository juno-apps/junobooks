/** What the Settings screen shows. */
export interface SettingsView {
  /** The folder JunoBooks keeps its companies in now. */
  dataRoot: string
  /** Documents\JunoBooks for the installed app; the project's test-data for a development copy. */
  defaultRoot: string
  isDefault: boolean
  /** A development copy (npm start), which only uses folders inside the project's test data. */
  isDev: boolean
  companyCount: number
  /** Practice companies left by earlier installed test versions, if any. */
  oldTestData: { path: string; companyCount: number } | null
  backupsKept: number
}
