import { isValidDate } from './dates'
import { MAX_CENTS } from './money'

/**
 * Bank and card CSV files: reading them, guessing which column is which,
 * and turning rows into imported lines. Pure code (no files, no database),
 * shared by the import screen's preview and the main process.
 *
 * Sign rule for imported lines: amountCents is the change on the imported
 * account's debit side. For a bank account, money in is positive. For a
 * credit card, a payment (or refund) is positive and a charge is negative.
 */

/** Reads CSV text (comma, semicolon or tab separated; quoted fields; Windows or Unix line ends; a leading BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string): number => firstLine.split(ch).length - 1
  const delimiter = [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',')

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''))
}

export type DateFormat = 'MDY' | 'DMY' | 'YMD'

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  MDY: 'Month/Day/Year (US, e.g. 03/15/2026)',
  DMY: 'Day/Month/Year (e.g. 15/03/2026)',
  YMD: 'Year-Month-Day (e.g. 2026-03-15)'
}

/** "3/15/26", "03-15-2026", "2026-03-15", "2026/3/15 10:22" → "2026-03-15" (or null). */
export function parseDateCell(text: string, format: DateFormat): string | null {
  const t = text.trim().replace(/[T\s].*$/, '')
  const m = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/.exec(t)
  if (!m) {
    // 20260315
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(t)
    if (compact && format === 'YMD') {
      const iso = `${compact[1]}-${compact[2]}-${compact[3]}`
      return isValidDate(iso) ? iso : null
    }
    return null
  }
  const [a, b, c] = [m[1], m[2], m[3]]
  let y: string, mo: string, d: string
  if (format === 'YMD') {
    if (a.length !== 4) return null
    ;[y, mo, d] = [a, b, c]
  } else {
    if (a.length > 2 || b.length > 2) return null
    ;[mo, d] = format === 'MDY' ? [a, b] : [b, a]
    y = c
    if (y.length === 2) y = `20${y}`
    else if (y.length !== 4) return null
  }
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  return isValidDate(iso) ? iso : null
}

/** "$1,234.56", "-12.00", "(45.10)", "45.10-", "USD 3.00", "+5" → cents (or null). Blank → null. */
export function parseAmountCell(text: string): number | null {
  let t = text.trim().replace(/^(USD|US\$)\s*/i, '').replace(/\s*(USD)$/i, '')
  if (!t) return null
  let negative = false
  if (/^\(.*\)$/.test(t)) {
    negative = true
    t = t.slice(1, -1)
  }
  if (t.endsWith('-')) {
    negative = !negative
    t = t.slice(0, -1)
  }
  if (t.startsWith('-')) {
    negative = !negative
    t = t.slice(1)
  } else if (t.startsWith('+')) t = t.slice(1)
  t = t.replace(/^\$/, '').replace(/,/g, '').trim()
  const m = /^(\d*)(?:\.(\d{1,2}))?$/.exec(t)
  if (!m || (m[1] === '' && m[2] === undefined)) return null
  const cents = Number(m[1] || '0') * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null
  return negative && cents !== 0 ? -cents : cents
}

export interface ColumnMapping {
  hasHeader: boolean
  dateCol: number
  descCol: number
  /** An extra column added to the description (e.g. check number or memo), or -1. */
  extraCol: number
  amountMode: 'single' | 'split'
  /** single: one signed column. */
  amountCol: number
  /** split: separate columns for money out (debits/withdrawals/charges) and money in (credits/deposits/payments). */
  outCol: number
  inCol: number
  /** single: the file shows spending as positive (most card statements, e.g. American Express). */
  flipSign: boolean
  dateFormat: DateFormat
}

export interface ImportedLine {
  /** 1-based row number in the file, for messages. */
  row: number
  date: string
  description: string
  /** Debit-side change on the imported account (see the file comment). */
  amountCents: number
}

export interface MappedFile {
  lines: ImportedLine[]
  problems: { row: number; reason: string }[]
  /** Rows with a zero amount (skipped quietly, e.g. balance or info lines). */
  zeroRows: number
}

/** Turns rows into imported lines using a mapping. Rows that can't be read are listed as problems. */
export function applyMapping(rows: string[][], m: ColumnMapping): MappedFile {
  const out: MappedFile = { lines: [], problems: [], zeroRows: 0 }
  const start = m.hasHeader ? 1 : 0
  for (let i = start; i < rows.length; i++) {
    const r = rows[i]
    const rowNo = i + 1
    const date = parseDateCell(r[m.dateCol] ?? '', m.dateFormat)
    if (!date) {
      out.problems.push({ row: rowNo, reason: `the date "${r[m.dateCol] ?? ''}" can't be read` })
      continue
    }
    let cents: number | null
    if (m.amountMode === 'single') {
      cents = parseAmountCell(r[m.amountCol] ?? '')
      if (cents !== null && m.flipSign) cents = -cents
    } else {
      const outText = r[m.outCol] ?? ''
      const inText = r[m.inCol] ?? ''
      const o = outText.trim() ? parseAmountCell(outText) : 0
      const n = inText.trim() ? parseAmountCell(inText) : 0
      cents = o === null || n === null ? null : Math.abs(n) - Math.abs(o)
    }
    if (cents === null) {
      out.problems.push({ row: rowNo, reason: 'the amount can\'t be read' })
      continue
    }
    if (cents === 0) {
      out.zeroRows++
      continue
    }
    const base = (r[m.descCol] ?? '').replace(/\s+/g, ' ').trim()
    const extra = m.extraCol >= 0 ? (r[m.extraCol] ?? '').replace(/\s+/g, ' ').trim() : ''
    const description = (extra && !base.includes(extra) ? `${base} · ${extra}` : base) || extra || '(no description)'
    out.lines.push({ row: rowNo, date, description, amountCents: cents })
  }
  return out
}

const looksLikeAmount = (s: string): boolean => s.trim() !== '' && parseAmountCell(s) !== null
const looksLikeDate = (s: string): boolean => (['MDY', 'YMD', 'DMY'] as DateFormat[]).some((f) => parseDateCell(s, f) !== null)

/** Picks the date format that reads every date in the column; prefers US month/day when both work. */
export function detectDateFormat(rows: string[][], col: number, hasHeader: boolean): DateFormat {
  const cells = rows.slice(hasHeader ? 1 : 0).map((r) => r[col] ?? '').filter((c) => c.trim())
  const order: DateFormat[] = ['YMD', 'MDY', 'DMY']
  for (const f of order) if (cells.length > 0 && cells.every((c) => parseDateCell(c, f) !== null)) return f
  return 'MDY'
}

/** Whether both month/day orders read every date (the screen asks the owner to confirm). */
export function dateOrderAmbiguous(rows: string[][], col: number, hasHeader: boolean): boolean {
  const cells = rows.slice(hasHeader ? 1 : 0).map((r) => r[col] ?? '').filter((c) => c.trim())
  return cells.length > 0 && cells.every((c) => parseDateCell(c, 'MDY') !== null && parseDateCell(c, 'DMY') !== null) &&
    cells.some((c) => parseDateCell(c, 'MDY') !== parseDateCell(c, 'DMY'))
}

/** Best guess at the mapping from the header names and the data. `isCard` sets the usual sign for card files. */
export function guessMapping(rows: string[][], isCard = false): ColumnMapping {
  const first = rows[0] ?? []
  const hasHeader = first.length > 0 && !first.some(looksLikeDate) && !first.some((c) => /^-?\$?[\d,]+\.\d\d$/.test(c.trim()))
  const head = hasHeader ? first.map((h) => h.toLowerCase()) : []
  const width = Math.max(...rows.map((r) => r.length), 0)
  const sample = rows.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 20)
  const colAll = (test: (s: string) => boolean): number[] =>
    [...Array(width).keys()].filter((c) => sample.length > 0 && sample.every((r) => (r[c] ?? '') === '' || test(r[c] ?? '')) && sample.some((r) => (r[c] ?? '') !== ''))
  const find = (...words: RegExp[]): number => {
    for (const w of words) {
      const i = head.findIndex((h) => w.test(h))
      if (i >= 0) return i
    }
    return -1
  }

  let dateCol = find(/^(transaction|trans\.?)\s*date/, /^date$/, /posting date|posted date|post date/, /date/)
  if (dateCol < 0) dateCol = colAll(looksLikeDate)[0] ?? 0

  let descCol = find(/^description$/, /description/, /payee|merchant|name/, /details|memo|narrative/)
  if (descCol < 0 || descCol === dateCol) {
    // the widest text column
    const textCols = [...Array(width).keys()].filter((c) => c !== dateCol && !colAll(looksLikeAmount).includes(c))
    descCol = textCols.sort((a, b) => avgLen(sample, b) - avgLen(sample, a))[0] ?? 1
  }

  const outCol = find(/^debit/, /withdrawal|money out|paid out|charges?$/)
  const inCol = find(/^credit/, /deposit|money in|paid in|payments?$/)
  let amountCol = find(/^amount$/, /amount/)
  const amountMode: 'single' | 'split' = amountCol < 0 && outCol >= 0 && inCol >= 0 ? 'split' : 'single'
  if (amountMode === 'single' && amountCol < 0) {
    const nums = colAll(looksLikeAmount).filter((c) => c !== dateCol)
    amountCol = nums[0] ?? 0
  }

  let extraCol = find(/check|cheque|slip/)
  if (extraCol === descCol || extraCol === amountCol) extraCol = -1

  // Card files: payments must come out positive (they lower what is owed). A payment line shows which
  // way the file's signs go; without one, mostly-positive amounts mean charges are shown as positive.
  let flipSign = false
  if (isCard && amountMode === 'single') {
    const rowsWithValues = sample
      .map((r) => ({ v: parseAmountCell(r[amountCol] ?? ''), d: (r[descCol] ?? '').toLowerCase() }))
      .filter((x): x is { v: number; d: string } => x.v !== null && x.v !== 0)
    const payment = rowsWithValues.find((x) => /payment|thank you|autopay/.test(x.d))
    if (payment) flipSign = payment.v < 0
    else flipSign = rowsWithValues.length > 0 && rowsWithValues.filter((x) => x.v > 0).length > rowsWithValues.length / 2
  }

  return {
    hasHeader,
    dateCol,
    descCol,
    extraCol,
    amountMode,
    amountCol: amountMode === 'single' ? amountCol : -1,
    outCol: amountMode === 'split' ? outCol : -1,
    inCol: amountMode === 'split' ? inCol : -1,
    flipSign,
    dateFormat: detectDateFormat(rows, dateCol, hasHeader)
  }
}

function avgLen(rows: string[][], c: number): number {
  return rows.length ? rows.reduce((s, r) => s + (r[c] ?? '').length, 0) / rows.length : 0
}

/** A short key for a file's layout, so a saved mapping is reused only for files that look the same. */
export function layoutKey(rows: string[][], hasHeader: boolean): string {
  const width = Math.max(...rows.map((r) => r.length), 0)
  return hasHeader ? `h:${(rows[0] ?? []).map((h) => h.toLowerCase()).join('|')}` : `w:${width}`
}

/** Identifies a line for duplicate checks: date, amount and the description's letters and digits. */
export function lineFingerprint(l: { date: string; amountCents: number; description: string }): string {
  return `${l.date}|${l.amountCents}|${l.description.toLowerCase().replace(/[^a-z0-9]/g, '')}`
}

/** Adds "#2", "#3" to fingerprints repeated within one file, so two genuine identical charges both import. */
export function numberedFingerprints(lines: { date: string; amountCents: number; description: string }[]): string[] {
  const seen = new Map<string, number>()
  return lines.map((l) => {
    const fp = lineFingerprint(l)
    const n = (seen.get(fp) ?? 0) + 1
    seen.set(fp, n)
    return `${fp}#${n}`
  })
}
