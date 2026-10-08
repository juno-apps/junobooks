import type Database from 'better-sqlite3'
import { supplierKindLabel, supplierProblem, type ContactRow, type Supplier, type SupplierInput } from '../shared/contacts'
import { LedgerError } from './ledger'
import { listContractors } from './records'
import { listCustomers } from './sales'

/** Suppliers (companies you buy from), and the combined Contacts list with customers and contractors. */

const SUPPLIER = `SELECT id, name, kind, contact_person AS contactPerson, email, phone, website, address,
  account_number AS accountNumber, terms_days AS termsDays, default_account_id AS defaultAccountId, notes,
  is_active AS isActive FROM suppliers`

export function listSuppliers(db: Database.Database): Supplier[] {
  return (
    db.prepare(`${SUPPLIER} ORDER BY lower(name)`).all() as (Omit<Supplier, 'isActive'> & { isActive: number })[]
  ).map((s) => ({ ...s, isActive: !!s.isActive }))
}

function checkSupplier(db: Database.Database, id: number | null, s: SupplierInput): void {
  const problem = supplierProblem(s)
  if (problem) throw new LedgerError(problem)
  const same = db
    .prepare('SELECT id FROM suppliers WHERE lower(trim(name)) = lower(?) AND id IS NOT ?')
    .get(s.name.trim(), id) as { id: number } | undefined
  if (same) throw new LedgerError(`There is already a supplier called ${s.name.trim()}.`)
  if (s.defaultAccountId !== null) {
    const a = db.prepare('SELECT type, subtype, is_active FROM accounts WHERE id = ?').get(s.defaultAccountId) as
      { type: string; subtype: string; is_active: number } | undefined
    const fits = a && (a.type === 'expense' || (a.type === 'asset' && ['inventory', 'fixed_asset'].includes(a.subtype)))
    if (!fits || !a.is_active)
      throw new LedgerError('Choose an active expense, cost of goods sold, inventory or equipment account.')
  }
}

/** Adds (id null) or edits a supplier. Returns its id. */
export function saveSupplier(
  db: Database.Database,
  id: number | null,
  s: SupplierInput & { isActive?: boolean },
  now: Date = new Date()
): number {
  checkSupplier(db, id, s)
  const values = {
    name: s.name.trim(),
    kind: s.kind,
    contact: s.contactPerson.trim(),
    email: s.email.trim(),
    phone: s.phone.trim(),
    website: s.website.trim(),
    address: s.address.trim(),
    account: s.accountNumber.trim(),
    terms: s.termsDays,
    defaultAccount: s.defaultAccountId,
    notes: s.notes.trim(),
    stamp: now.toISOString()
  }
  if (id === null) {
    return Number(
      db
        .prepare(
          `INSERT INTO suppliers (name, kind, contact_person, email, phone, website, address, account_number, terms_days,
             default_account_id, notes, created_at, updated_at)
           VALUES (@name, @kind, @contact, @email, @phone, @website, @address, @account, @terms, @defaultAccount, @notes,
             @stamp, @stamp)`
        )
        .run(values).lastInsertRowid
    )
  }
  const r = db
    .prepare(
      `UPDATE suppliers SET name = @name, kind = @kind, contact_person = @contact, email = @email, phone = @phone,
         website = @website, address = @address, account_number = @account, terms_days = @terms,
         default_account_id = @defaultAccount, notes = @notes, is_active = COALESCE(@active, is_active),
         updated_at = @stamp
       WHERE id = @id`
    )
    .run({ ...values, id, active: s.isActive === undefined ? null : s.isActive ? 1 : 0 })
  if (r.changes === 0) throw new LedgerError('That supplier no longer exists.')
  return id
}

/** Everyone in one list: suppliers, customers and contractors, by name. */
export function listContacts(db: Database.Database): ContactRow[] {
  const rows: ContactRow[] = [
    ...listSuppliers(db).map((s) => ({
      role: 'supplier' as const,
      id: s.id,
      name: s.name,
      detail: supplierKindLabel(s.kind),
      contactPerson: s.contactPerson,
      email: s.email,
      phone: s.phone,
      isActive: s.isActive
    })),
    ...listCustomers(db).map((c) => ({
      role: 'customer' as const,
      id: c.id,
      name: c.name,
      detail: c.isWholesale ? 'Customer (wholesale)' : 'Customer',
      contactPerson: '',
      email: c.email,
      phone: c.phone,
      isActive: c.isActive
    })),
    ...listContractors(db).map((c) => ({
      role: 'contractor' as const,
      id: c.id,
      name: c.name,
      detail: c.w9OnFile ? 'Contractor (W-9 on file)' : 'Contractor (no W-9 yet)',
      contactPerson: '',
      email: '',
      phone: '',
      isActive: c.isActive
    }))
  ]
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}
