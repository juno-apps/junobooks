/** Year-end accountant package: notes for the accountant and the build result. */

export interface AccountantNote {
  area: string
  /** 'note' = information for the accountant; 'check' = something to review or fix before sending. */
  kind: 'note' | 'check'
  text: string
}

export interface PackageResult {
  /** Full path of the ZIP. */
  zipPath: string
  files: string[]
  receipts: number
  notes: number
}
