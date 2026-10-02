import type Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { safeNamePart } from '../shared/attachments'
import { isValidDate } from '../shared/dates'
import { formatCents } from '../shared/money'
import {
  agingBucket,
  certificateValid,
  invoiceTotals,
  type AgingRow,
  type BusinessDetails,
  type CertificateInput,
  type Customer,
  type CustomerInput,
  type Invoice,
  type InvoiceInput,
  type Payment,
  type PaymentInput,
  type ResaleCertificate
} from '../shared/sales'
import { LedgerError, postEntry, voidEntry } from './ledger'

/** Direct sales: customers, resale certificates, invoices (draft → open → void) and payments received. */

export const INVOICE_SOURCE = 'invoice'
export const PAYMENT_SOURCE = 'payment'

// ---- Business details -------------------------------------------------------------------------------

export function businessDetails(db: Database.Database): BusinessDetails {
  return db.prepare('SELECT name, address, email, phone FROM company_profile WHERE id = 1').get() as BusinessDetails
}

export function setBusinessDetails(db: Database.Database, d: Omit<BusinessDetails, 'name'>): void {
  db.prepare('UPDATE company_profile SET address = ?, email = ?, phone = ? WHERE id = 1').run(
    d.address.trim(),
    d.email.trim(),
    d.phone.trim()
  )
}

// ---- Customers ----------------------------------------------------------------------------------------

/** Open (unpaid) amount of each finalized invoice. */
const OPEN_BY_INVOICE = `SELECT i.id, i.customer_id, i.due_date, i.total_cents - COALESCE((
    SELECT SUM(a.amount_cents) FROM payment_applications a JOIN payments p ON p.id = a.payment_id
    WHERE a.invoice_id = i.id AND p.status = 'posted'), 0) AS open_cents
  FROM invoices i WHERE i.status = 'open'`

export function listCustomers(db: Database.Database): Customer[] {
  return (
    db
      .prepare(
        `SELECT c.id, c.name, c.email, c.phone, c.address, c.notes, c.is_wholesale AS isWholesale, c.is_active AS isActive,
           COALESCE((SELECT SUM(o.open_cents) FROM (${OPEN_BY_INVOICE}) o WHERE o.customer_id = c.id), 0) AS openCents
         FROM customers c ORDER BY lower(c.name)`
      )
      .all() as (Omit<Customer, 'isWholesale' | 'isActive'> & { isWholesale: number; isActive: number })[]
  ).map((c) => ({ ...c, isWholesale: !!c.isWholesale, isActive: !!c.isActive }))
}

function checkCustomer(input: CustomerInput): void {
  if (!input.name.trim()) throw new LedgerError('Enter the customer’s name.')
  if (input.name.trim().length > 120) throw new LedgerError('That name is too long.')
  if (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))
    throw new LedgerError('That email address doesn’t look right.')
}

export function addCustomer(db: Database.Database, input: CustomerInput, now: Date = new Date()): number {
  checkCustomer(input)
  const stamp = now.toISOString()
  return Number(
    db
      .prepare(
        `INSERT INTO customers (name, email, phone, address, notes, is_wholesale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name.trim(),
        input.email.trim(),
        input.phone.trim(),
        input.address.trim(),
        input.notes.trim(),
        input.isWholesale ? 1 : 0,
        stamp,
        stamp
      ).lastInsertRowid
  )
}

export function updateCustomer(
  db: Database.Database,
  id: number,
  input: CustomerInput & { isActive: boolean },
  now: Date = new Date()
): void {
  checkCustomer(input)
  const r = db
    .prepare(
      `UPDATE customers SET name = ?, email = ?, phone = ?, address = ?, notes = ?, is_wholesale = ?, is_active = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      input.name.trim(),
      input.email.trim(),
      input.phone.trim(),
      input.address.trim(),
      input.notes.trim(),
      input.isWholesale ? 1 : 0,
      input.isActive ? 1 : 0,
      now.toISOString(),
      id
    )
  if (r.changes === 0) throw new LedgerError('That customer no longer exists.')
}

function customerRow(
  db: Database.Database,
  id: number | null
): { id: number; name: string; is_active: number; is_wholesale: number } {
  const c =
    id === null
      ? undefined
      : (db.prepare('SELECT id, name, is_active, is_wholesale FROM customers WHERE id = ?').get(id) as
          { id: number; name: string; is_active: number; is_wholesale: number } | undefined)
  if (!c) throw new LedgerError('Choose a customer.')
  return c
}

// ---- Resale certificates -------------------------------------------------------------------------------

const CERT = `SELECT id, customer_id AS customerId, cert_number AS certNumber, state_code AS stateCode, issued_date AS issuedDate,
  expires_date AS expiresDate, stored_path AS storedPath, original_name AS originalName, notes FROM resale_certificates
  WHERE removed_at IS NULL`

export function listCertificates(db: Database.Database, customerId?: number): ResaleCertificate[] {
  return customerId === undefined
    ? (db.prepare(`${CERT} ORDER BY customer_id, id`).all() as ResaleCertificate[])
    : (db.prepare(`${CERT} AND customer_id = ? ORDER BY id`).all(customerId) as ResaleCertificate[])
}

export function addCertificate(
  db: Database.Database,
  companyDir: string,
  input: CertificateInput,
  now: Date = new Date()
): number {
  const c = customerRow(db, input.customerId)
  if (!input.certNumber.trim()) throw new LedgerError('Enter the certificate or permit number.')
  if (!/^[A-Z]{2}$/.test(input.stateCode)) throw new LedgerError('Choose the state the certificate is for.')
  for (const d of [input.issuedDate, input.expiresDate])
    if (d && !isValidDate(d)) throw new LedgerError('Enter a valid date.')
  if (input.issuedDate && input.expiresDate && input.expiresDate < input.issuedDate)
    throw new LedgerError('The certificate expires before it was issued.')
  let storedPath: string | null = null
  let originalName: string | null = null
  if (input.filePath) {
    let ok = false
    try {
      ok = statSync(input.filePath).isFile()
    } catch {
      ok = false
    }
    if (!ok) throw new LedgerError('That certificate file can’t be read.')
    const dir = join(companyDir, 'resale-certificates')
    mkdirSync(dir, { recursive: true })
    const ext = extname(input.filePath).toLowerCase()
    const stem = `${safeNamePart(c.name) || `customer-${c.id}`}_${safeNamePart(input.certNumber) || 'certificate'}`
    let name = `${stem}${ext}`
    for (let n = 2; existsSync(join(dir, name)); n++) name = `${stem}-${n}${ext}`
    copyFileSync(input.filePath, join(dir, name))
    storedPath = `resale-certificates/${name}`
    originalName = basename(input.filePath)
  }
  const stamp = now.toISOString()
  return Number(
    db
      .prepare(
        `INSERT INTO resale_certificates (customer_id, cert_number, state_code, issued_date, expires_date, stored_path, original_name,
           notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        c.id,
        input.certNumber.trim(),
        input.stateCode,
        input.issuedDate,
        input.expiresDate,
        storedPath,
        originalName,
        input.notes.trim(),
        stamp,
        stamp
      ).lastInsertRowid
  )
}

export function removeCertificate(db: Database.Database, id: number, now: Date = new Date()): void {
  db.prepare('UPDATE resale_certificates SET removed_at = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL').run(
    now.toISOString(),
    now.toISOString(),
    id
  )
}

export function certificateFile(db: Database.Database, companyDir: string, id: number): string {
  const c = db.prepare(`${CERT} AND id = ?`).get(id) as ResaleCertificate | undefined
  if (!c?.storedPath) throw new LedgerError('No file is attached to that certificate.')
  const full = join(companyDir, c.storedPath)
  if (!existsSync(full)) throw new LedgerError(`The certificate file is missing from ${c.storedPath}.`)
  return full
}

/** A certificate of this customer that is valid on the date, if any. */
export function validCertificate(db: Database.Database, customerId: number, date: string): ResaleCertificate | null {
  return listCertificates(db, customerId).find((c) => certificateValid(c, date)) ?? null
}

// ---- Invoices -----------------------------------------------------------------------------------------

export function nextInvoiceNumber(db: Database.Database): string {
  const rows = db.prepare('SELECT number FROM invoices').all() as { number: string }[]
  const max = rows.reduce((m, r) => (/^\d+$/.test(r.number) ? Math.max(m, Number(r.number)) : m), 1000)
  return String(max + 1)
}

interface InvoiceRow {
  id: number
  number: string
  customerId: number
  customerName: string
  issueDate: string
  dueDate: string
  status: 'draft' | 'open' | 'void'
  memo: string
  taxRateMilli: number
  taxExempt: number
  exemptReason: string
  subtotalCents: number
  taxCents: number
  totalCents: number
  entryId: number | null
  voidReason: string | null
  paidCents: number
}

const INVOICE = `SELECT i.id, i.number, i.customer_id AS customerId, c.name AS customerName, i.issue_date AS issueDate,
  i.due_date AS dueDate, i.status, i.memo, i.tax_rate_milli AS taxRateMilli, i.tax_exempt AS taxExempt,
  i.exempt_reason AS exemptReason, i.subtotal_cents AS subtotalCents, i.tax_cents AS taxCents, i.total_cents AS totalCents,
  i.entry_id AS entryId, i.void_reason AS voidReason,
  COALESCE((SELECT SUM(a.amount_cents) FROM payment_applications a JOIN payments p ON p.id = a.payment_id
            WHERE a.invoice_id = i.id AND p.status = 'posted'), 0) AS paidCents
  FROM invoices i JOIN customers c ON c.id = i.customer_id`

function toInvoice(db: Database.Database, r: InvoiceRow): Invoice {
  const lines = (
    db
      .prepare(
        `SELECT description, quantity_milli AS quantityMilli, unit_price_cents AS unitPriceCents, amount_cents AS amountCents,
           account_id AS accountId, taxable FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no`
      )
      .all(r.id) as (Omit<Invoice['lines'][number], 'taxable'> & { taxable: number })[]
  ).map((l) => ({ ...l, taxable: !!l.taxable }))
  const open = r.status === 'open' ? r.totalCents - r.paidCents : 0
  return {
    ...r,
    taxExempt: !!r.taxExempt,
    status: r.status === 'open' && open === 0 ? 'paid' : r.status,
    lines,
    openCents: open
  }
}

export function listInvoices(db: Database.Database, customerId?: number): Invoice[] {
  const rows = (
    customerId === undefined
      ? db.prepare(`${INVOICE} ORDER BY i.issue_date DESC, i.id DESC`).all()
      : db.prepare(`${INVOICE} WHERE i.customer_id = ? ORDER BY i.issue_date DESC, i.id DESC`).all(customerId)
  ) as InvoiceRow[]
  return rows.map((r) => toInvoice(db, r))
}

export function getInvoice(db: Database.Database, id: number): Invoice {
  const r = db.prepare(`${INVOICE} WHERE i.id = ?`).get(id) as InvoiceRow | undefined
  if (!r) throw new LedgerError('That invoice no longer exists.')
  return toInvoice(db, r)
}

function checkInvoice(db: Database.Database, input: InvoiceInput, id: number | null): void {
  customerRow(db, input.customerId)
  if (!input.number.trim()) throw new LedgerError('Enter an invoice number.')
  const clash = db.prepare('SELECT id FROM invoices WHERE number = ?').get(input.number.trim()) as
    { id: number } | undefined
  if (clash && clash.id !== id) throw new LedgerError(`Invoice number ${input.number.trim()} is already used.`)
  if (!isValidDate(input.issueDate)) throw new LedgerError('Enter the invoice date.')
  if (!isValidDate(input.dueDate)) throw new LedgerError('Enter the due date.')
  if (input.dueDate < input.issueDate) throw new LedgerError('The due date is before the invoice date.')
  if (!Number.isSafeInteger(input.taxRateMilli) || input.taxRateMilli < 0 || input.taxRateMilli > 100000) {
    throw new LedgerError('Enter a sales tax rate between 0% and 100%.')
  }
  if (input.lines.length === 0) throw new LedgerError('Add at least one line.')
  const acct = db.prepare('SELECT type, is_active FROM accounts WHERE id = ?')
  input.lines.forEach((l, i) => {
    if (!l.description.trim()) throw new LedgerError(`Line ${i + 1}: describe what you sold.`)
    if (!Number.isSafeInteger(l.quantityMilli) || l.quantityMilli <= 0)
      throw new LedgerError(`Line ${i + 1}: enter a quantity.`)
    if (!Number.isSafeInteger(l.unitPriceCents)) throw new LedgerError(`Line ${i + 1}: enter a price.`)
    const a =
      l.accountId === null ? undefined : (acct.get(l.accountId) as { type: string; is_active: number } | undefined)
    if (!a || a.type !== 'income' || !a.is_active) throw new LedgerError(`Line ${i + 1}: choose an income account.`)
  })
  if (invoiceTotals(input).totalCents <= 0) throw new LedgerError('The invoice total must be more than zero.')
}

/** Creates or updates a draft invoice. Returns its id. */
export function saveDraft(
  db: Database.Database,
  id: number | null,
  input: InvoiceInput,
  now: Date = new Date()
): number {
  checkInvoice(db, input, id)
  const t = invoiceTotals(input)
  const stamp = now.toISOString()
  return db.transaction(() => {
    let invoiceId = id
    const values = [
      input.number.trim(),
      input.customerId,
      input.issueDate,
      input.dueDate,
      input.memo.trim(),
      input.taxRateMilli,
      input.taxExempt ? 1 : 0,
      input.taxExempt ? input.exemptReason.trim() : '',
      t.subtotalCents,
      t.taxCents,
      t.totalCents
    ]
    if (invoiceId === null) {
      invoiceId = Number(
        db
          .prepare(
            `INSERT INTO invoices (number, customer_id, issue_date, due_date, memo, tax_rate_milli, tax_exempt, exempt_reason,
               subtotal_cents, tax_cents, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(...values, stamp, stamp).lastInsertRowid
      )
    } else {
      const cur = db.prepare('SELECT status FROM invoices WHERE id = ?').get(invoiceId) as
        { status: string } | undefined
      if (!cur) throw new LedgerError('That invoice no longer exists.')
      if (cur.status !== 'draft')
        throw new LedgerError('A finalized invoice can’t be changed. Void it and make a new one.')
      db.prepare(
        `UPDATE invoices SET number = ?, customer_id = ?, issue_date = ?, due_date = ?, memo = ?, tax_rate_milli = ?, tax_exempt = ?,
           exempt_reason = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?, updated_at = ? WHERE id = ?`
      ).run(...values, stamp, invoiceId)
      db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(invoiceId)
    }
    const add = db.prepare(
      `INSERT INTO invoice_lines (invoice_id, line_no, description, quantity_milli, unit_price_cents, amount_cents, account_id, taxable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    input.lines.forEach((l, i) =>
      add.run(
        invoiceId,
        i + 1,
        l.description.trim(),
        l.quantityMilli,
        l.unitPriceCents,
        t.lineCents[i],
        l.accountId,
        l.taxable ? 1 : 0
      )
    )
    return invoiceId
  })()
}

export function deleteDraft(db: Database.Database, id: number): void {
  const cur = db.prepare('SELECT status FROM invoices WHERE id = ?').get(id) as { status: string } | undefined
  if (!cur) return
  if (cur.status !== 'draft')
    throw new LedgerError('Only a draft invoice can be deleted. Void a finalized one instead.')
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id)
}

function receivableAccount(db: Database.Database): number {
  const a = db
    .prepare(
      "SELECT id FROM accounts WHERE tax_category = 'accounts_receivable' AND is_active = 1 ORDER BY number LIMIT 1"
    )
    .get() as { id: number } | undefined
  if (!a) throw new LedgerError('Invoices need an active Accounts receivable account. Add it on the chart of accounts.')
  return a.id
}

function salesTaxAccount(db: Database.Database): number {
  const a = db
    .prepare("SELECT id FROM accounts WHERE subtype = 'sales_tax' AND is_active = 1 ORDER BY number LIMIT 1")
    .get() as { id: number } | undefined
  if (!a) throw new LedgerError('This invoice charges sales tax, which needs an active Sales tax payable account.')
  return a.id
}

/** Finalizes a draft: posts it to accounts receivable (income per line, sales tax owed) and makes it open for payment. */
export function finalizeInvoice(db: Database.Database, id: number, booksStart: string, now: Date = new Date()): void {
  const inv = getInvoice(db, id)
  if (inv.status !== 'draft') throw new LedgerError('This invoice is already finalized.')
  if (inv.issueDate < booksStart)
    throw new LedgerError(`Your books start on ${booksStart}, so the invoice can’t be dated earlier.`)
  const c = customerRow(db, inv.customerId)
  if (!c.is_active) throw new LedgerError(`${c.name} is turned off. Turn the customer back on first.`)
  const ar = receivableAccount(db)
  const byAccount = new Map<number, number>()
  for (const l of inv.lines) byAccount.set(l.accountId, (byAccount.get(l.accountId) ?? 0) + l.amountCents)
  const lines = [{ accountId: ar, amountCents: inv.totalCents, memo: `Invoice ${inv.number}` }]
  for (const [accountId, cents] of byAccount) if (cents) lines.push({ accountId, amountCents: -cents, memo: '' })
  if (inv.taxCents)
    lines.push({ accountId: salesTaxAccount(db), amountCents: -inv.taxCents, memo: 'Sales tax charged' })
  db.transaction(() => {
    const entryId = postEntry(db, {
      date: inv.issueDate,
      memo: `Invoice ${inv.number}: ${inv.customerName}`,
      source: INVOICE_SOURCE,
      lines
    })
    db.prepare("UPDATE invoices SET status = 'open', entry_id = ?, finalized_at = ?, updated_at = ? WHERE id = ?").run(
      entryId,
      now.toISOString(),
      now.toISOString(),
      id
    )
  })()
}

export function voidInvoice(db: Database.Database, id: number, reason: string, now: Date = new Date()): void {
  if (!reason.trim()) throw new LedgerError('Give a reason for voiding the invoice.')
  const inv = getInvoice(db, id)
  if (inv.status === 'draft') throw new LedgerError('A draft can simply be deleted.')
  if (inv.status === 'void') return
  if (inv.paidCents > 0) throw new LedgerError('Payments are applied to this invoice. Void those payments first.')
  db.transaction(() => {
    if (inv.entryId) voidEntry(db, inv.entryId, `Invoice ${inv.number} voided: ${reason.trim()}`)
    db.prepare("UPDATE invoices SET status = 'void', voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?").run(
      now.toISOString(),
      reason.trim(),
      now.toISOString(),
      id
    )
  })()
}

// ---- Payments -----------------------------------------------------------------------------------------

export function recordPayment(
  db: Database.Database,
  input: PaymentInput,
  booksStart: string,
  now: Date = new Date()
): number {
  const c = customerRow(db, input.customerId)
  if (!isValidDate(input.date)) throw new LedgerError('Enter the date you were paid.')
  if (input.date < booksStart)
    throw new LedgerError(`Your books start on ${booksStart}, so a payment can’t be dated earlier.`)
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0)
    throw new LedgerError('Enter the amount received.')
  const dep =
    input.depositAccountId === null
      ? undefined
      : (db.prepare('SELECT type, is_active FROM accounts WHERE id = ?').get(input.depositAccountId) as
          { type: string; is_active: number } | undefined)
  if (!dep || dep.type !== 'asset' || !dep.is_active) throw new LedgerError('Choose the account the money went into.')
  const apps = input.applications.filter((a) => a.amountCents !== 0)
  if (apps.length === 0) throw new LedgerError('Choose which invoice(s) this pays.')
  const applied = apps.reduce((s, a) => s + a.amountCents, 0)
  if (applied !== input.amountCents) {
    throw new LedgerError(
      `The amounts applied to invoices (${formatCents(applied)}) must add up to the payment (${formatCents(input.amountCents)}).`
    )
  }
  for (const a of apps) {
    const inv = getInvoice(db, a.invoiceId)
    if (inv.customerId !== c.id) throw new LedgerError(`Invoice ${inv.number} is for another customer.`)
    if (inv.status !== 'open') throw new LedgerError(`Invoice ${inv.number} isn’t open for payment.`)
    if (!Number.isSafeInteger(a.amountCents) || a.amountCents < 0)
      throw new LedgerError('Applied amounts must be positive.')
    if (a.amountCents > inv.openCents)
      throw new LedgerError(`That is more than is still owed on invoice ${inv.number} (${formatCents(inv.openCents)}).`)
  }
  const ar = receivableAccount(db)
  const numbers = apps.map((a) => getInvoice(db, a.invoiceId).number)
  return db.transaction(() => {
    const entryId = postEntry(db, {
      date: input.date,
      memo: `Payment from ${c.name} (invoice ${numbers.join(', ')})`,
      source: PAYMENT_SOURCE,
      lines: [
        { accountId: input.depositAccountId!, amountCents: input.amountCents, memo: input.reference.trim() },
        { accountId: ar, amountCents: -input.amountCents, memo: '' }
      ]
    })
    const id = Number(
      db
        .prepare(
          `INSERT INTO payments (customer_id, payment_date, amount_cents, deposit_account_id, method, reference, entry_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          c.id,
          input.date,
          input.amountCents,
          input.depositAccountId,
          input.method.trim(),
          input.reference.trim(),
          entryId,
          now.toISOString()
        ).lastInsertRowid
    )
    const add = db.prepare('INSERT INTO payment_applications (payment_id, invoice_id, amount_cents) VALUES (?, ?, ?)')
    for (const a of apps) add.run(id, a.invoiceId, a.amountCents)
    return id
  })()
}

export function voidPayment(db: Database.Database, id: number, reason: string, now: Date = new Date()): void {
  if (!reason.trim()) throw new LedgerError('Give a reason for voiding the payment.')
  const p = db.prepare('SELECT status, entry_id AS entryId FROM payments WHERE id = ?').get(id) as
    { status: string; entryId: number | null } | undefined
  if (!p) throw new LedgerError('That payment no longer exists.')
  if (p.status === 'void') return
  db.transaction(() => {
    if (p.entryId) voidEntry(db, p.entryId, `Payment voided: ${reason.trim()}`)
    db.prepare("UPDATE payments SET status = 'void', voided_at = ?, void_reason = ? WHERE id = ?").run(
      now.toISOString(),
      reason.trim(),
      id
    )
  })()
}

export function listPayments(db: Database.Database, customerId?: number): Payment[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.customer_id AS customerId, c.name AS customerName, p.payment_date AS date, p.amount_cents AS amountCents,
         a.name AS depositAccountName, p.method, p.reference, p.status, p.entry_id AS entryId
       FROM payments p JOIN customers c ON c.id = p.customer_id JOIN accounts a ON a.id = p.deposit_account_id
       WHERE (@c IS NULL OR p.customer_id = @c) ORDER BY p.payment_date DESC, p.id DESC`
    )
    .all({ c: customerId ?? null }) as Omit<Payment, 'applications'>[]
  const apps = db.prepare(
    `SELECT a.invoice_id AS invoiceId, i.number AS invoiceNumber, a.amount_cents AS amountCents FROM payment_applications a
     JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = ? ORDER BY a.id`
  )
  return rows.map((r) => ({ ...r, applications: apps.all(r.id) as Payment['applications'] }))
}

/** What each customer owes, by how late it is on `asOf`. */
export function aging(db: Database.Database, asOf: string): AgingRow[] {
  const rows = db
    .prepare(
      `SELECT o.customer_id AS customerId, c.name, o.due_date AS dueDate, o.open_cents AS openCents FROM (${OPEN_BY_INVOICE}) o
              JOIN customers c ON c.id = o.customer_id JOIN invoices i ON i.id = o.id
              WHERE o.open_cents <> 0 AND i.issue_date <= ?`
    )
    .all(asOf) as { customerId: number; name: string; dueDate: string; openCents: number }[]
  const by = new Map<number, AgingRow>()
  for (const r of rows) {
    const row =
      by.get(r.customerId) ??
      ({
        customerId: r.customerId,
        customerName: r.name,
        currentCents: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        over90: 0,
        totalCents: 0
      } as AgingRow)
    row[agingBucket(r.dueDate, asOf)] += r.openCents
    row.totalCents += r.openCents
    by.set(r.customerId, row)
  }
  return [...by.values()].sort((a, b) => a.customerName.localeCompare(b.customerName))
}
