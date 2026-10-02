/** Receipt files attached to entries, stored in the company's receipts\<year>\ folder. */

export interface Attachment {
  id: number
  entryId: number
  /** Relative to the company folder, e.g. receipts/2026/2026-01-05_Rio-Grande_12.50.pdf */
  storedPath: string
  /** The file's name when it was attached. */
  originalName: string
  sizeBytes: number
  addedAt: string
}

export interface AttachResult {
  added: Attachment[]
  skipped: { name: string; reason: string }[]
}

/** File types accepted as receipts (lower case, no dot). */
export const RECEIPT_EXTENSIONS = [
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'tif', 'tiff', 'bmp',
  'txt', 'eml', 'msg', 'html', 'htm', 'doc', 'docx', 'xls', 'xlsx', 'csv'
]

export const MAX_RECEIPT_BYTES = 50 * 1024 * 1024

/** "Rio Grande, Inc." → "Rio-Grande-Inc" (safe in a Windows file name, at most 40 characters). */
export function safeNamePart(text: string): string {
  return text
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/[.,;'`!#%&{}$@+=^~[\]]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '')
}

/** date_vendor_amount.ext, the receipt naming rule. */
export function receiptFileName(date: string, vendor: string, amountCents: number, ext: string, entryId: number): string {
  const who = safeNamePart(vendor) || `entry-${entryId}`
  const amount = `${Math.floor(Math.abs(amountCents) / 100)}.${String(Math.abs(amountCents) % 100).padStart(2, '0')}`
  return `${date}_${who}_${amount}${ext ? `.${ext.toLowerCase()}` : ''}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
