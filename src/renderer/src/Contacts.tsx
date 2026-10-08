import { useEffect, useState } from 'react'
import type { ChartAccount, ContactRow, Supplier, SupplierInput } from '../../preload/types'
import { SUPPLIER_KINDS, supplierProblem, type SupplierKind } from '../../shared/contacts'
import { expenseCategoryGroups } from '../../shared/everyday'
import AccountCombobox from './AccountCombobox'

interface Props {
  /** Opens the screen where customers (Invoices) or contractors (Year-end records) are edited. */
  onOpen: (screen: 'sales' | 'records') => void
  onClose: () => void
}

type Filter = 'all' | ContactRow['role']

const BLANK: SupplierInput = {
  name: '',
  kind: 'supplier',
  contactPerson: '',
  email: '',
  phone: '',
  website: '',
  address: '',
  accountNumber: '',
  termsDays: null,
  defaultAccountId: null,
  notes: ''
}

/** Everyone you deal with: suppliers (kept here), customers and contractors (kept on their own screens). */
function Contacts({ onOpen, onClose }: Props): JSX.Element {
  const [rows, setRows] = useState<ContactRow[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [accounts, setAccounts] = useState<ChartAccount[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  /** The supplier form: closed, a new supplier, or one being edited. */
  const [editing, setEditing] = useState<{ id: number | null } | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function reload(): Promise<void> {
    const [c, s, chart] = await Promise.all([window.juno.contacts(), window.juno.suppliers(), window.juno.getChart()])
    if (c.ok) setRows(c.value)
    if (s.ok) setSuppliers(s.value)
    setAccounts(chart ? chart.accounts : [])
  }

  useEffect(() => {
    void reload()
  }, [])

  if (!rows) return <p>Loading contacts…</p>

  const words = search.trim().toLowerCase()
  const shown = rows.filter(
    (r) =>
      (filter === 'all' || r.role === filter) &&
      (showInactive || r.isActive) &&
      (!words || [r.name, r.contactPerson, r.email, r.phone].some((t) => t.toLowerCase().includes(words)))
  )
  const count = (role: ContactRow['role']): number => rows.filter((r) => r.role === role && r.isActive).length
  const inactive = rows.filter((r) => !r.isActive).length

  return (
    <section className="panel journal-entry contacts">
      <div className="chart-header">
        <h2>Contacts</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Everyone you deal with in one list. Suppliers (the companies you buy materials, supplies and services from,
        including your refiner or metal dealer) are kept here. Customers are kept under Invoices, and contractors
        under Year-end records; they show here too, and their Open link takes you there.
      </p>

      {editing ? (
        <SupplierForm
          supplier={editing.id === null ? null : (suppliers.find((s) => s.id === editing.id) ?? null)}
          accounts={accounts}
          onSaved={(name) => {
            setEditing(null)
            setSaved(`${name} saved.`)
            void reload()
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="form-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setSaved(null)
              setEditing({ id: null })
            }}
          >
            Add a supplier
          </button>
        </div>
      )}
      {saved && !editing && <p className="success">{saved}</p>}

      <div className="tabs">
        {(
          [
            ['all', 'All'],
            ['supplier', `Suppliers (${count('supplier')})`],
            ['customer', `Customers (${count('customer')})`],
            ['contractor', `Contractors (${count('contractor')})`]
          ] as [Filter, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" className={filter === id ? 'tab active' : 'tab'} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="form">
        <div className="form-row">
          <label className="grow">
            Find
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, contact person, email or phone"
              aria-label="Find a contact"
            />
          </label>
        </div>
        {inactive > 0 && (
          <label className="toggle">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show {inactive} inactive
          </label>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="muted">
          {rows.length === 0 ? 'No contacts yet. Add a supplier above.' : 'No contacts match.'}
        </p>
      ) : (
        <table className="chart-table contact-list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Contact person</th>
              <th>Phone</th>
              <th>Email</th>
              <th className="actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.role}-${r.id}`} className={r.isActive ? '' : 'inactive'}>
                <td>
                  {r.name}
                  {!r.isActive && ' (inactive)'}
                </td>
                <td>{r.detail}</td>
                <td>{r.contactPerson}</td>
                <td>{r.phone}</td>
                <td>{r.email}</td>
                <td className="actions">
                  {r.role === 'supplier' ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setSaved(null)
                        setEditing({ id: r.id })
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onOpen(r.role === 'customer' ? 'sales' : 'records')}
                    >
                      {r.role === 'customer' ? 'Open in Invoices' : 'Open in Year-end records'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function SupplierForm({
  supplier,
  accounts,
  onSaved,
  onCancel
}: {
  supplier: Supplier | null
  accounts: ChartAccount[]
  onSaved: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [form, setForm] = useState<SupplierInput & { isActive: boolean }>(
    supplier ? { ...supplier } : { ...BLANK, isActive: true }
  )
  const [terms, setTerms] = useState(supplier?.termsDays?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]): void => {
    setForm((f) => ({ ...f, [key]: value }))
    setError(null)
  }

  async function save(): Promise<void> {
    const t = terms.trim()
    const termsDays = t === '' ? null : /^\d+$/.test(t) ? Number(t) : NaN
    const input = { ...form, termsDays: Number.isNaN(termsDays) ? -1 : termsDays }
    const problem = supplierProblem(input)
    if (problem) return setError(problem)
    setBusy(true)
    const r = await window.juno.saveSupplier(supplier?.id ?? null, supplier ? input : { ...input, isActive: undefined })
    setBusy(false)
    if (r.ok) onSaved(input.name.trim())
    else setError(r.error)
  }

  return (
    <div className="form account-form">
      <h3>{supplier ? `Edit ${supplier.name}` : 'Add a supplier'}</h3>
      <div className="form-row">
        <label className="grow">
          Company name
          <input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus={!supplier} />
        </label>
        <label>
          Kind
          <select value={form.kind} onChange={(e) => set('kind', e.target.value as SupplierKind)}>
            {SUPPLIER_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label className="grow">
          Contact person
          <input value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
        </label>
        <label className="grow">
          Phone
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>
      </div>
      <div className="form-row">
        <label className="grow">
          Email
          <input value={form.email} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="grow">
          Website
          <input value={form.website} onChange={(e) => set('website', e.target.value)} />
        </label>
      </div>
      <label>
        Address
        <textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} />
      </label>
      <div className="form-row">
        <label className="grow">
          Your account number with them
          <input value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} />
        </label>
        <label className="narrow">
          Payment terms (days)
          <input
            value={terms}
            onChange={(e) => {
              setTerms(e.target.value)
              setError(null)
            }}
            placeholder="e.g. 30"
            inputMode="numeric"
          />
        </label>
      </div>
      <p className="hint">
        Payment terms: how many days you have to pay their bills (30 for &ldquo;net 30&rdquo;). Leave blank if you pay
        right away.
      </p>
      <label>
        What you usually buy from them (optional)
        <AccountCombobox
          groups={expenseCategoryGroups(accounts)}
          value={form.defaultAccountId}
          onChange={(id) => set('defaultAccountId', id)}
          label="What you usually buy from them"
        />
        <span className="hint">The account their bills and purchases will start with. You can still change it each time.</span>
      </label>
      <label>
        Notes
        <input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </label>
      {supplier && (
        <label className="toggle">
          <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          Active (untick for a supplier you no longer use; it stays on record)
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          {supplier ? 'Save supplier' : 'Add supplier'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default Contacts
