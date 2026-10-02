import type Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import JSZip from 'jszip'
import { basename, join } from 'path'
import { getEntityType, TAX_FORM_LABELS, type EntityTypeId } from '../shared/entities'
import { formatQuantity, methodLabel, scaleCents } from '../shared/inventory'
import type { AccountantNote, PackageResult } from '../shared/pkg'
import { formatMiles } from '../shared/records'
import { plainCents, toCsv, type ReportSection } from '../shared/reports'
import { quarters } from '../shared/salesTax'
import { accountantNotes } from './accountantNotes'
import { tieOut } from './form1099k'
import { itemFacts, listItems } from './inventory'
import { inventoryYear } from './inventoryReport'
import { fixedAssetReport, getHomeOffice, mileageReport, necReport } from './records'
import { balanceSheet, generalLedger, profitAndLoss, trialBalance } from './reports'
import { cogsSchedule, salesByChannel, taxLineSummary } from './reportsExtra'
import { salesTaxReport } from './salesTax'

/** Builds the year-end accountant package: one ZIP with an Excel workbook, CSVs, the receipts and the notes.
 * Nothing here imports Electron; the PDF summary is made by the caller and passed in. */

type Cell = string | number | null | { money: number } | { bold: string }
const m = (cents: number): Cell => ({ money: cents })

function addSheet(wb: ExcelJS.Workbook, name: string, rows: Cell[][], widths: number[] = []): void {
  const ws = wb.addWorksheet(name.slice(0, 31))
  for (const r of rows) {
    const row = ws.addRow(
      r.map((c) => (c === null ? '' : typeof c === 'object' ? ('money' in c ? c.money / 100 : c.bold) : c))
    )
    r.forEach((c, i) => {
      if (c && typeof c === 'object') {
        const cell = row.getCell(i + 1)
        if ('money' in c) cell.numFmt = '#,##0.00;[Red]-#,##0.00'
        else cell.font = { bold: true }
      }
    })
  }
  if (rows.length) ws.getRow(1).font = { bold: true }
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
}

const sectionRows = (s: ReportSection): Cell[][] => [
  [{ bold: s.title }],
  ...s.rows.map((r) => [r.subtotal ? r.name : `${'   '.repeat(r.depth)}${r.number} ${r.name}`, ...r.values.map(m)]),
  [{ bold: `Total ${s.title.toLowerCase()}` }, ...s.total.map(m)]
]

export interface TransactionLine {
  date: string
  entryId: number
  status: string
  source: string
  memo: string
  account: string
  debit: number
  credit: number
  lineMemo: string
}

export function transactionLines(db: Database.Database, from: string, to: string): TransactionLine[] {
  return (
    db
      .prepare(
        `SELECT e.entry_date AS date, e.id AS entryId, e.status, e.source, e.memo, a.number || ' ' || a.name AS account,
           l.amount_cents AS c, l.memo AS lineMemo
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
         WHERE e.status IN ('posted', 'void') AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date, e.id, l.line_no`
      )
      .all(from, to) as (Omit<TransactionLine, 'debit' | 'credit'> & { c: number })[]
  ).map((r) => ({ ...r, debit: r.c > 0 ? r.c : 0, credit: r.c < 0 ? -r.c : 0 }))
}

export interface PackageInput {
  db: Database.Database
  companyDir: string
  companyName: string
  booksStart: string
  year: number
  /** PDF summary bytes, made by the main process (optional). */
  pdf?: Buffer
  now?: Date
}

/** The safe name of the ZIP for a year. */
export const packageFileName = (year: number): string => `Accountant package ${year}.zip`

export async function buildPackage(p: PackageInput): Promise<PackageResult> {
  const { db, year } = p
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const now = p.now ?? new Date()
  const entityRow = (db
    .prepare(
      'SELECT entity_type AS e FROM entity_type_history WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1'
    )
    .get(to) ??
    db.prepare('SELECT entity_type AS e FROM entity_type_history ORDER BY effective_date LIMIT 1').get()) as {
    e: EntityTypeId
  }
  const entity = getEntityType(entityRow.e)

  const pl = profitAndLoss(db, from, to, true)
  const plTotal = pl.columns.length - 1
  const bs = balanceSheet(db, to)
  const tb = trialBalance(db, to)
  const gl = generalLedger(db, from, to)
  const tx = transactionLines(db, from, to)
  const channels = salesByChannel(db, from, to)
  const lines = taxLineSummary(db, year)
  const cogs = cogsSchedule(db, year)
  const inv = inventoryYear(db, year, p.booksStart)
  const nec = necReport(db, year)
  const k1099 = tieOut(db, year)
  const fa = fixedAssetReport(db, year)
  const miles = mileageReport(db, year)
  const office = getHomeOffice(db, year)
  const notes: AccountantNote[] = accountantNotes(db, year, p.booksStart)

  // ---- Workbook ----
  const wb = new ExcelJS.Workbook()
  wb.creator = 'JunoBooks'
  wb.created = now
  addSheet(
    wb,
    'Summary',
    [
      [`${p.companyName}: accountant package for ${year}`],
      ['Entity type', entity.label],
      ['Federal return', TAX_FORM_LABELS[entity.taxForm]],
      ['Books start', p.booksStart],
      ['Prepared', now.toISOString().slice(0, 10)],
      [],
      [{ bold: 'Profit and loss' }],
      ['Income', m(pl.income.total[plTotal])],
      ['Cost of goods sold', m(pl.cogs.total[plTotal])],
      ['Gross profit', m(pl.grossProfit[plTotal])],
      ['Expenses', m(pl.expenses.total[plTotal])],
      [{ bold: 'Net income' }, m(pl.netIncome[plTotal])],
      [],
      [{ bold: `Balance sheet at ${to}` }],
      ['Assets', m(bs.assets.total[0])],
      ['Liabilities', m(bs.liabilities.total[0])],
      ['Equity', m(bs.equity.total[0])],
      ['Profit not yet closed into equity', m(bs.currentYearProfit + bs.priorYearsProfit)],
      ['Balanced', bs.balanced ? 'yes' : 'NO'],
      [],
      [{ bold: 'Sales by channel' }],
      ...channels.channels.map((c) => [c.name, m(c.netCents)]),
      [],
      ['Notes for the accountant', `${notes.length} (see the Notes tab)`],
      ['Things to check', String(notes.filter((n) => n.kind === 'check').length)]
    ],
    [42, 22]
  )
  addSheet(
    wb,
    'Profit and loss',
    [
      ['Account', ...pl.columns],
      ...sectionRows(pl.income),
      ...sectionRows(pl.cogs),
      [{ bold: 'Gross profit' }, ...pl.grossProfit.map(m)],
      ...sectionRows(pl.expenses),
      [{ bold: 'Net income' }, ...pl.netIncome.map(m)]
    ],
    [40, ...pl.columns.map(() => 13)]
  )
  addSheet(
    wb,
    'Balance sheet',
    [
      [`Balance sheet at ${to}`, 'Amount'],
      ...sectionRows(bs.assets),
      ...sectionRows(bs.liabilities),
      ...sectionRows(bs.equity),
      ['Profit this year (not yet closed)', m(bs.currentYearProfit)],
      ['Profit from earlier years (not yet closed)', m(bs.priorYearsProfit)],
      [{ bold: 'Total liabilities and equity' }, m(bs.totalLiabilitiesAndEquity)]
    ],
    [44, 15]
  )
  addSheet(
    wb,
    'Trial balance',
    [
      ['Number', 'Account', 'Debit', 'Credit'],
      ...tb.rows.map((r) => [r.number, r.name, m(r.debit), m(r.credit)]),
      ['', { bold: 'Total' }, m(tb.totalDebit), m(tb.totalCredit)]
    ],
    [10, 36, 14, 14]
  )
  const glRows: Cell[][] = [['Account', 'Date', 'Entry', 'Description', 'Other side', 'Debit', 'Credit', 'Balance']]
  for (const a of gl.accounts) {
    glRows.push([`${a.number} ${a.name}`, from, null, 'Opening balance', null, null, null, m(a.opening)])
    for (const l of a.lines)
      glRows.push([
        `${a.number} ${a.name}`,
        l.date,
        l.entryId,
        l.memo,
        l.otherSide,
        l.debit ? m(l.debit) : null,
        l.credit ? m(l.credit) : null,
        m(l.balance)
      ])
    glRows.push([`${a.number} ${a.name}`, to, null, 'Closing balance', null, null, null, m(a.closing)])
  }
  addSheet(wb, 'General ledger', glRows, [30, 11, 7, 40, 24, 13, 13, 13])
  addSheet(
    wb,
    'Transactions',
    [
      ['Date', 'Entry', 'Status', 'Source', 'Memo', 'Account', 'Debit', 'Credit', 'Line memo'],
      ...tx.map((t) => [
        t.date,
        t.entryId,
        t.status,
        t.source,
        t.memo,
        t.account,
        t.debit ? m(t.debit) : null,
        t.credit ? m(t.credit) : null,
        t.lineMemo
      ])
    ],
    [11, 7, 8, 10, 36, 30, 13, 13, 30]
  )
  addSheet(
    wb,
    'Sales by channel',
    [
      ['Channel', 'Sales', 'Refunds', 'Net'],
      ...channels.channels.map((c) => [c.name, m(c.salesCents), m(c.refundsCents), m(c.netCents)]),
      [{ bold: 'Total' }, m(channels.totalSalesCents), m(channels.totalRefundsCents), m(channels.totalNetCents)]
    ],
    [36, 14, 14, 14]
  )
  addSheet(
    wb,
    'Tax lines',
    [
      [`${lines.formLabel} (lines from the ${lines.tableYear} forms)`, 'Description', 'Account', 'Amount', 'Note'],
      ...lines.lines.flatMap((l) => [
        [
          { bold: l.ref ?? 'Not on this form' },
          l.label,
          null,
          m(l.cents),
          l.part === 'balance' ? 'Balance at year end' : null
        ] as Cell[],
        ...l.accounts.map((a) => [null, null, `${a.number} ${a.name}`, m(a.cents), a.note] as Cell[])
      ]),
      ...lines.unmapped.map(
        (u) => ['NOT MAPPED', null, `${u.number} ${u.name}`, m(u.cents), 'Choose a tax category'] as Cell[]
      )
    ],
    [26, 34, 32, 14, 60]
  )
  addSheet(
    wb,
    'Cost of goods sold',
    [
      ['Cost of goods sold', String(year)],
      ['Inventory at beginning of year', m(cogs.beginningCents)],
      ['Purchases', m(cogs.purchasesCents)],
      ['Cost of labor', m(cogs.laborCents)],
      ['Materials and supplies', m(cogs.materialsCents)],
      ['Other costs', m(cogs.otherCents)],
      ['Subtotal', m(cogs.subtotalCents)],
      ['Inventory at end of year', m(cogs.endingCents)],
      [{ bold: 'Cost of goods sold' }, m(cogs.cogsCents)],
      [],
      ['Filed inventory method', cogs.filedMethod ?? 'not chosen'],
      ['Year-end inventory entry posted', cogs.yearEndEntryPosted ? 'yes' : 'no']
    ],
    [36, 16]
  )
  addSheet(
    wb,
    'Inventory methods',
    [
      ['Method', 'Beginning', 'Purchases', 'Ending', 'Cost of goods sold', 'Filed'],
      ...inv.methods.map((x) => [
        methodLabel(x.method),
        m(x.beginCents),
        m(x.purchasesCents),
        m(x.endCents),
        m(x.cogsCents),
        x.method === inv.filed ? 'filed' : ''
      ])
    ],
    [32, 14, 14, 14, 18, 8]
  )
  // Count sheet: each item's year-end quantity and value under the filed method (FIFO when none is filed).
  const facts = itemFacts(db)
  const items = listItems(db)
  const valuation = inv.filed ?? 'fifo'
  const byItem = new Map(inv.methods.find((x) => x.method === valuation)!.items.map((i) => [i.itemId, i]))
  const countRows: Cell[][] = [
    ['Item', 'Unit', `Quantity on ${to}`, 'Counted on that day', `Value (${methodLabel(valuation)})`, 'Value per unit']
  ]
  for (const it of items) {
    const f = byItem.get(it.id)
    if (!f || (!f.endQuantityMilli && !(facts.get(it.id)?.purchases.length ?? 0))) continue
    countRows.push([
      it.name,
      it.unit,
      formatQuantity(f.endQuantityMilli),
      f.notCounted ? 'no' : 'yes',
      m(f.endCents),
      f.endQuantityMilli ? m(scaleCents(f.endCents, 1000, f.endQuantityMilli)) : null
    ])
  }
  addSheet(wb, 'Inventory count', countRows, [32, 8, 16, 18, 20, 14])
  addSheet(
    wb,
    'Fixed assets',
    [
      ['Asset', 'Account', 'In service', 'Cost', 'Sold or scrapped', 'Notes'],
      ...fa.assets.map((a) => [
        a.name,
        a.accountName ?? '',
        a.inServiceDate,
        m(a.costCents),
        a.disposedDate ?? '',
        a.notes
      ]),
      [],
      ['Fixed-asset accounts in the books at year end', null, null, m(fa.booksCents)]
    ],
    [30, 26, 12, 14, 16, 30]
  )
  addSheet(
    wb,
    '1099-NEC',
    [
      [
        `1099-NEC threshold ${plainCents(nec.thresholdCents)}`,
        'W-9 on file',
        'Tax ID last 4',
        'Paid by bank/cash/check',
        'Paid by card',
        'Needs a 1099-NEC'
      ],
      ...nec.rows.map((r) => [
        r.name,
        r.w9OnFile ? 'yes' : 'no',
        r.tinLast4,
        m(r.paidCents),
        m(r.paidByCardCents),
        r.overThreshold ? 'yes' : 'no'
      ]),
      ...nec.unmatched.map((u) => [`Not matched: ${u.memo}`, null, null, m(u.cents), u.date, null] as Cell[])
    ],
    [36, 12, 12, 22, 14, 16]
  )
  addSheet(
    wb,
    '1099-K',
    [
      [
        'Platform',
        'Imported gross',
        '1099-K box 1a',
        'Difference',
        'Notes',
        ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      ],
      ...k1099.map((r) => [
        r.platform,
        r.imported ? m(r.importedCents) : 'not imported',
        r.formCents === null ? null : m(r.formCents),
        r.differenceCents === null ? null : m(r.differenceCents),
        r.notes,
        ...r.monthlyCents.map(m)
      ])
    ],
    [18, 16, 16, 14, 30]
  )
  const stRows: Cell[][] = [
    [
      'Period',
      'Total sales',
      'Marketplace sales',
      'Sales for resale',
      'Other exempt',
      'Refunds',
      'Taxable sales',
      'Tax at rates',
      'Tax charged',
      'Payable at end'
    ]
  ]
  for (const q of quarters(year)) {
    const r = salesTaxReport(db, q.from, q.to)
    stRows.push([
      q.label,
      m(r.grossSalesCents),
      m(r.marketplaceCents),
      m(r.resaleCents),
      m(r.otherExemptCents),
      m(r.refundsCents),
      m(r.taxableCents),
      m(r.computedTaxCents),
      m(r.chargedCents),
      m(r.owedAtEndCents)
    ])
  }
  addSheet(wb, 'Sales tax', stRows, [10, 14, 16, 14, 13, 12, 14, 13, 13, 14])
  addSheet(
    wb,
    'Mileage',
    [
      ['Date', 'Miles', 'Purpose', 'From', 'To'],
      ...miles.trips.map((t) => [t.date, formatMiles(t.milesTenths), t.purpose, t.fromPlace, t.toPlace]),
      [],
      ['Total miles', formatMiles(miles.totalTenths)],
      ['Rate (cents per mile)', miles.rateTenthCents === null ? 'not entered' : (miles.rateTenthCents / 10).toFixed(1)],
      ['Amount at the rate', miles.amountCents === null ? null : m(miles.amountCents)]
    ],
    [12, 10, 40, 20, 20]
  )
  const h = office.details
  addSheet(
    wb,
    'Home office',
    h
      ? [
          ['Home office', String(year)],
          ['Office square feet', h.officeSqft],
          ['Home square feet', h.homeSqft],
          ['Office share', `${(office.percentBp / 100).toFixed(2)}%`],
          ['Rent', m(h.rentCents)],
          ['Mortgage interest', m(h.mortgageInterestCents)],
          ['Property tax', m(h.propertyTaxCents)],
          ['Utilities', m(h.utilitiesCents)],
          ['Insurance', m(h.insuranceCents)],
          ['Repairs', m(h.repairsCents)],
          ['Other', m(h.otherCents)],
          ['Simplified method', m(office.simplifiedCents)],
          ['Regular method (share of expenses)', m(office.regularCents)],
          ['Notes', h.notes]
        ]
      : [['No home office details entered for this year.']],
    [36, 16]
  )
  addSheet(
    wb,
    'Notes for accountant',
    [['Area', 'Type', 'Note'], ...notes.map((n) => [n.area, n.kind === 'check' ? 'Check' : 'Note', n.text])],
    [16, 8, 120]
  )
  const workbook = Buffer.from(await wb.xlsx.writeBuffer())

  // ---- ZIP ----
  const zip = new JSZip()
  const safeCompany = p.companyName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
  zip.file(`${safeCompany} ${year} accountant workbook.xlsx`, workbook)
  zip.file(
    'general-ledger.csv',
    '﻿' +
      toCsv([
        ['Account', 'Date', 'Entry', 'Description', 'Other side', 'Debit', 'Credit', 'Balance'],
        ...gl.accounts.flatMap((a) => [
          [`${a.number} ${a.name}`, from, '', 'Opening balance', '', '', '', plainCents(a.opening)],
          ...a.lines.map((l) => [
            `${a.number} ${a.name}`,
            l.date,
            l.entryId,
            l.memo,
            l.otherSide,
            l.debit ? plainCents(l.debit) : '',
            l.credit ? plainCents(l.credit) : '',
            plainCents(l.balance)
          ]),
          [`${a.number} ${a.name}`, to, '', 'Closing balance', '', '', '', plainCents(a.closing)]
        ])
      ])
  )
  zip.file(
    'transactions.csv',
    '﻿' +
      toCsv([
        ['Date', 'Entry', 'Status', 'Source', 'Memo', 'Account', 'Debit', 'Credit', 'Line memo'],
        ...tx.map((t) => [
          t.date,
          t.entryId,
          t.status,
          t.source,
          t.memo,
          t.account,
          t.debit ? plainCents(t.debit) : '',
          t.credit ? plainCents(t.credit) : '',
          t.lineMemo
        ])
      ])
  )
  zip.file(
    'inventory-count-sheet.csv',
    '﻿' +
      toCsv(
        countRows.map((r) =>
          r.map((c) => (c === null ? '' : typeof c === 'object' ? ('money' in c ? plainCents(c.money) : c.bold) : c))
        )
      )
  )
  zip.file(
    'fixed-assets.csv',
    '﻿' +
      toCsv([
        ['Asset', 'Account', 'In service', 'Cost', 'Sold or scrapped', 'Notes'],
        ...fa.assets.map((a) => [
          a.name,
          a.accountName ?? '',
          a.inServiceDate,
          plainCents(a.costCents),
          a.disposedDate ?? '',
          a.notes
        ])
      ])
  )
  zip.file(
    'notes-for-accountant.txt',
    [
      `${p.companyName}: notes for the accountant, ${year}`,
      '',
      ...notes.map((n) => `[${n.kind === 'check' ? 'CHECK' : 'note'}] ${n.area}: ${n.text}`)
    ].join('\r\n') + '\r\n'
  )
  if (p.pdf) zip.file(`${safeCompany} ${year} summary.pdf`, p.pdf)

  // Receipts attached to the year's entries, and resale certificates on file.
  const receipts = db
    .prepare(
      `SELECT t.stored_path AS path, t.original_name AS original, e.id AS entryId, e.entry_date AS date, e.memo
       FROM attachments t JOIN journal_entries e ON e.id = t.entry_id
       WHERE t.removed_at IS NULL AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date, e.id`
    )
    .all(from, to) as { path: string; original: string; entryId: number; date: string; memo: string }[]
  const receiptIndex: (string | number)[][] = [['File', 'Entry', 'Date', 'Memo', 'Original name']]
  let receiptCount = 0
  for (const r of receipts) {
    const full = join(p.companyDir, r.path)
    if (!existsSync(full)) continue
    zip.file(`receipts/${basename(r.path)}`, readFileSync(full))
    receiptIndex.push([basename(r.path), r.entryId, r.date, r.memo, r.original])
    receiptCount++
  }
  if (receiptCount) zip.file('receipts/index.csv', '﻿' + toCsv(receiptIndex))
  const certs = db
    .prepare('SELECT stored_path AS path FROM resale_certificates WHERE removed_at IS NULL AND stored_path IS NOT NULL')
    .all() as { path: string }[]
  for (const c of certs) {
    const full = join(p.companyDir, c.path)
    if (existsSync(full)) zip.file(`resale-certificates/${basename(c.path)}`, readFileSync(full))
  }

  const outDir = join(p.companyDir, 'exports')
  mkdirSync(outDir, { recursive: true })
  const zipPath = join(outDir, packageFileName(year))
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  writeFileSync(zipPath, buf)
  return {
    zipPath,
    files: Object.keys(zip.files).filter((f) => !zip.files[f].dir),
    receipts: receiptCount,
    notes: notes.length
  }
}
