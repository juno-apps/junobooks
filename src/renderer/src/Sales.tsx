import { useEffect, useState } from 'react'
import type {
  AgingRow,
  BusinessDetails,
  ChartAccount,
  Customer,
  Invoice,
  InvoiceInput,
  Payment,
  ResaleCertificate
} from '../../preload/types'
import { importAccountGroups } from '../../shared/bankImport'
import { localDateString } from '../../shared/dates'
import { formatQuantity, parseQuantity } from '../../shared/inventory'
import { formatCents, parseMoney } from '../../shared/money'
import { certificateValid, daysBetween, formatRate, invoiceTotals, parseRate } from '../../shared/sales'
import { US_STATES } from '../../shared/states'
import AccountCombobox from './AccountCombobox'

interface Props {
  onChanged: () => void
  onClose: () => void
}

type Tab = 'customers' | 'invoices' | 'payments' | 'aging'
type Msg = { text: string; bad: boolean } | null

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const STATUS_LABEL: Record<Invoice['status'], string> = { draft: 'Draft', open: 'Open', paid: 'Paid', void: 'Voided' }

/** Direct sales: customers (with resale certificates), invoices, payments received, and who owes you. */
function Sales({ onChanged, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('invoices')
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [accounts, setAccounts] = useState<ChartAccount[]>([])
  const [payFor, setPayFor] = useState<{ customerId: number; invoiceId: number } | null>(null)

  async function reload(): Promise<void> {
    const [c, i, chart] = await Promise.all([window.juno.customers(), window.juno.invoices(), window.juno.getChart()])
    if (c.ok) setCustomers(c.value)
    if (i.ok) setInvoices(i.value)
    setAccounts(chart ? chart.accounts : [])
  }

  useEffect(() => {
    void reload()
  }, [])

  if (!customers) return <p>Loading sales…</p>
  const changed = (): void => {
    void reload()
    onChanged()
  }

  return (
    <section className="panel journal-entry sales">
      <div className="chart-header">
        <h2>Sales and invoices</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        For sales outside Etsy and Amazon: wholesale orders, shows, custom work. Make an invoice, save it as a PDF to
        email or print, and record the payment when it arrives. JunoBooks never emails anything itself.
      </p>
      <div className="tabs">
        {(
          [
            ['invoices', 'Invoices'],
            ['customers', `Customers (${customers.length})`],
            ['payments', 'Payments received'],
            ['aging', 'Who owes you']
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'customers' && <Customers customers={customers} onChanged={changed} />}
      {tab === 'invoices' && (
        <Invoices
          customers={customers}
          invoices={invoices}
          accounts={accounts}
          onChanged={changed}
          onPay={(customerId, invoiceId) => {
            setPayFor({ customerId, invoiceId })
            setTab('payments')
          }}
        />
      )}
      {tab === 'payments' && (
        <Payments customers={customers} invoices={invoices} accounts={accounts} start={payFor} onChanged={changed} />
      )}
      {tab === 'aging' && <Aging />}
    </section>
  )
}

// ---- Customers ------------------------------------------------------------------------------------------

function Customers({ customers, onChanged }: { customers: Customer[]; onChanged: () => void }): JSX.Element {
  const blank = { name: '', email: '', phone: '', address: '', notes: '', isWholesale: false }
  const [form, setForm] = useState(blank)
  const [open, setOpen] = useState<number | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  return (
    <div className="form sales-tab">
      <h3>Add a customer</h3>
      <div className="form-row">
        <label className="grow">
          Name
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            aria-label="Customer name"
          />
        </label>
        <label className="grow">
          Email
          <input
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            aria-label="Customer email"
          />
        </label>
        <label className="grow">
          Phone
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            aria-label="Customer phone"
          />
        </label>
      </div>
      <label>
        Billing address
        <textarea
          rows={2}
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          aria-label="Customer address"
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.isWholesale}
          onChange={(e) => setForm({ ...form, isWholesale: e.target.checked })}
        />
        Wholesale buyer (buys to resell; keep their resale certificate on file)
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const r = await window.juno.addCustomer(form)
            if (!r.ok) return setMsg({ text: r.error, bad: true })
            setForm(blank)
            setMsg({ text: 'Customer added.', bad: false })
            onChanged()
          }}
        >
          Add customer
        </button>
      </div>
      {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}

      {customers.length === 0 ? (
        <p className="muted">No customers yet.</p>
      ) : (
        <table className="chart-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Email</th>
              <th className="amount">Owes you</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <CustomerRow
                key={c.id}
                c={c}
                open={open === c.id}
                onToggle={() => setOpen(open === c.id ? null : c.id)}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function CustomerRow({
  c,
  open,
  onToggle,
  onChanged
}: {
  c: Customer
  open: boolean
  onToggle: () => void
  onChanged: () => void
}): JSX.Element {
  const [edit, setEdit] = useState({ ...c })
  const [certs, setCerts] = useState<ResaleCertificate[]>([])
  const [cert, setCert] = useState({
    certNumber: '',
    stateCode: 'CA',
    issuedDate: '',
    expiresDate: '',
    notes: '',
    filePath: null as string | null
  })
  const [msg, setMsg] = useState<Msg>(null)
  const today = localDateString()

  useEffect(() => {
    if (open) window.juno.certificates(c.id).then((r) => r.ok && setCerts(r.value))
  }, [open])

  return (
    <>
      <tr className={c.isActive ? 'entry-row' : 'entry-row inactive'} onClick={onToggle}>
        <td>
          {c.name}
          {c.isWholesale && <span className="badge">wholesale</span>}
          {!c.isActive && ' (turned off)'}
        </td>
        <td>{c.email}</td>
        <td className="amount">{c.openCents ? formatCents(c.openCents) : ''}</td>
        <td className="row-actions">{open ? 'Close' : 'Open'}</td>
      </tr>
      {open && (
        <tr className="entry-detail">
          <td colSpan={4}>
            <div className="form">
              <div className="form-row">
                <label className="grow">
                  Name
                  <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                </label>
                <label className="grow">
                  Email
                  <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
                </label>
                <label className="grow">
                  Phone
                  <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                </label>
              </div>
              <label>
                Billing address
                <textarea
                  rows={2}
                  value={edit.address}
                  onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                />
              </label>
              <label>
                Notes
                <input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={edit.isWholesale}
                  onChange={(e) => setEdit({ ...edit, isWholesale: e.target.checked })}
                />
                Wholesale buyer
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={edit.isActive}
                  onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })}
                />
                Active
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  onClick={async () => {
                    const r = await window.juno.updateCustomer(c.id, edit)
                    setMsg(r.ok ? { text: 'Saved.', bad: false } : { text: r.error, bad: true })
                    if (r.ok) onChanged()
                  }}
                >
                  Save customer
                </button>
              </div>

              <h4>Resale certificates</h4>
              {certs.length === 0 ? (
                <p className="muted">
                  None on file.
                  {c.isWholesale && ' A wholesale buyer needs a valid resale certificate for you to skip sales tax.'}
                </p>
              ) : (
                <ul className="cert-list">
                  {certs.map((x) => (
                    <li key={x.id}>
                      {x.certNumber} ({x.stateCode}){x.issuedDate && `, issued ${x.issuedDate}`}
                      {x.expiresDate && `, expires ${x.expiresDate}`} ·{' '}
                      <strong className={certificateValid(x, today) ? 'ok' : 'warn'}>
                        {certificateValid(x, today) ? 'valid today' : 'not valid today'}
                      </strong>{' '}
                      {x.storedPath && (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => void window.juno.openCertificate(x.id)}
                        >
                          Open file
                        </button>
                      )}{' '}
                      <button
                        type="button"
                        className="link-button"
                        onClick={async () => {
                          const r = await window.juno.removeCertificate(x.id, c.id)
                          if (r.ok) setCerts(r.value)
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="form-row">
                <label className="grow">
                  Certificate or permit number
                  <input
                    value={cert.certNumber}
                    onChange={(e) => setCert({ ...cert, certNumber: e.target.value })}
                    aria-label="Certificate number"
                  />
                </label>
                <label className="narrow">
                  State
                  <select
                    value={cert.stateCode}
                    onChange={(e) => setCert({ ...cert, stateCode: e.target.value })}
                    aria-label="Certificate state"
                  >
                    {US_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="narrow-date">
                  Issued
                  <input
                    type="date"
                    value={cert.issuedDate}
                    onChange={(e) => setCert({ ...cert, issuedDate: e.target.value })}
                    aria-label="Certificate issued"
                  />
                </label>
                <label className="narrow-date">
                  Expires (if any)
                  <input
                    type="date"
                    value={cert.expiresDate}
                    onChange={(e) => setCert({ ...cert, expiresDate: e.target.value })}
                    aria-label="Certificate expires"
                  />
                </label>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  onClick={async () => {
                    const r = await window.juno.pickCertificateFile()
                    if (r.ok && r.value) setCert({ ...cert, filePath: r.value })
                  }}
                >
                  {cert.filePath ? `File: ${cert.filePath.split(/[\\/]/).pop()}` : 'Attach a copy…'}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    const r = await window.juno.addCertificate({
                      customerId: c.id,
                      certNumber: cert.certNumber,
                      stateCode: cert.stateCode,
                      issuedDate: cert.issuedDate || null,
                      expiresDate: cert.expiresDate || null,
                      notes: cert.notes,
                      filePath: cert.filePath
                    })
                    if (!r.ok) return setMsg({ text: r.error, bad: true })
                    setCerts(r.value)
                    setCert({
                      certNumber: '',
                      stateCode: 'CA',
                      issuedDate: '',
                      expiresDate: '',
                      notes: '',
                      filePath: null
                    })
                    setMsg({ text: 'Certificate saved.', bad: false })
                  }}
                >
                  Add certificate
                </button>
              </div>
              <p className="accountant-note">
                <span aria-hidden="true">⚑ </span>
                Check with your accountant: keep a valid resale certificate (in California, a CDTFA-230) for every sale
                you don&rsquo;t charge sales tax on because the buyer will resell it.
              </p>
              {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ---- Invoices -------------------------------------------------------------------------------------------

interface LineDraft {
  description: string
  quantity: string
  price: string
  accountId: number | null
  taxable: boolean
}

const blankLine = (accountId: number | null): LineDraft => ({
  description: '',
  quantity: '1',
  price: '',
  accountId,
  taxable: true
})

function Invoices({
  customers,
  invoices,
  accounts,
  onChanged,
  onPay
}: {
  customers: Customer[]
  invoices: Invoice[]
  accounts: ChartAccount[]
  onChanged: () => void
  onPay: (customerId: number, invoiceId: number) => void
}): JSX.Element {
  const [editing, setEditing] = useState<Invoice | 'new' | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [filter, setFilter] = useState<'unpaid' | 'all'>('all')
  const shown = invoices.filter((i) => filter === 'all' || i.status === 'open' || i.status === 'draft')

  if (editing) {
    return (
      <InvoiceEditor
        key={editing === 'new' ? 'new' : editing.id}
        existing={editing === 'new' ? null : editing}
        customers={customers}
        accounts={accounts}
        onDone={(id) => {
          setEditing(null)
          setViewing(id)
          onChanged()
        }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="form sales-tab">
      <BusinessDetailsBox />
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          disabled={customers.filter((c) => c.isActive).length === 0}
          onClick={() => setEditing('new')}
        >
          New invoice
        </button>
        {customers.length === 0 && <span className="hint">Add a customer first (Customers tab).</span>}
        <label className="toggle">
          <input
            type="checkbox"
            checked={filter === 'unpaid'}
            onChange={(e) => setFilter(e.target.checked ? 'unpaid' : 'all')}
          />
          Only drafts and unpaid
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="muted">No invoices yet.</p>
      ) : (
        <table className="chart-table invoice-list">
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Customer</th>
              <th className="amount">Total</th>
              <th className="amount">Still owed</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <InvoiceRow
                key={i.id}
                inv={i}
                open={viewing === i.id}
                onToggle={() => setViewing(viewing === i.id ? null : i.id)}
                onEdit={() => setEditing(i)}
                onPay={() => onPay(i.customerId, i.id)}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function BusinessDetailsBox(): JSX.Element {
  const [d, setD] = useState<BusinessDetails | null>(null)
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  useEffect(() => {
    window.juno.businessDetails().then((r) => r.ok && setD(r.value))
  }, [])
  if (!d) return <></>
  if (!editing) {
    return (
      <p className="hint">
        Invoices show: <strong>{d.name}</strong>
        {d.address ? `, ${d.address.replace(/\n/g, ', ')}` : ''}
        {d.email ? `, ${d.email}` : ''}
        {d.phone ? `, ${d.phone}` : ''}.{' '}
        <button type="button" className="link-button" onClick={() => setEditing(true)}>
          {d.address || d.email ? 'Change' : 'Add your address and email'}
        </button>
      </p>
    )
  }
  return (
    <div className="form business-details">
      <label>
        Business address (shown on invoices)
        <textarea
          rows={2}
          value={d.address}
          onChange={(e) => setD({ ...d, address: e.target.value })}
          aria-label="Business address"
        />
      </label>
      <div className="form-row">
        <label className="grow">
          Email
          <input value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} aria-label="Business email" />
        </label>
        <label className="grow">
          Phone
          <input value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} aria-label="Business phone" />
        </label>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const r = await window.juno.setBusinessDetails(d)
            if (!r.ok) return setMsg({ text: r.error, bad: true })
            setD(r.value)
            setEditing(false)
          }}
        >
          Save business details
        </button>
      </div>
      {msg && <p className="error">{msg.text}</p>}
    </div>
  )
}

function InvoiceRow({
  inv,
  open,
  onToggle,
  onEdit,
  onPay,
  onChanged
}: {
  inv: Invoice
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onPay: () => void
  onChanged: () => void
}): JSX.Element {
  const [msg, setMsg] = useState<Msg>(null)
  const [voiding, setVoiding] = useState<string | null>(null)
  const today = localDateString()
  const overdue = inv.status === 'open' && inv.dueDate < today
  return (
    <>
      <tr className={`entry-row${inv.status === 'void' ? ' inactive' : ''}${open ? ' open' : ''}`} onClick={onToggle}>
        <td>{inv.number}</td>
        <td>{inv.issueDate}</td>
        <td>{inv.customerName}</td>
        <td className="amount">{formatCents(inv.totalCents)}</td>
        <td className="amount">{inv.openCents ? formatCents(inv.openCents) : ''}</td>
        <td>
          {STATUS_LABEL[inv.status]}
          {overdue && <span className="warn"> · {daysBetween(inv.dueDate, today)} days late</span>}
        </td>
      </tr>
      {open && (
        <tr className="entry-detail">
          <td colSpan={6}>
            <table className="entry-lines">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="amount">Qty</th>
                  <th className="amount">Price</th>
                  <th className="amount">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {l.description}
                      {!l.taxable && <span className="muted"> (not taxed)</span>}
                    </td>
                    <td className="amount">{formatQuantity(l.quantityMilli)}</td>
                    <td className="amount">{formatCents(l.unitPriceCents)}</td>
                    <td className="amount">{formatCents(l.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">
              Subtotal {formatCents(inv.subtotalCents)} ·{' '}
              {inv.taxExempt
                ? `No sales tax: ${inv.exemptReason || 'exempt'}`
                : `Sales tax ${formatRate(inv.taxRateMilli)} ${formatCents(inv.taxCents)}`}{' '}
              · Total {formatCents(inv.totalCents)} · Due {inv.dueDate}
              {inv.paidCents > 0 && ` · Paid ${formatCents(inv.paidCents)}`}
              {inv.voidReason && ` · Voided: ${inv.voidReason}`}
            </p>
            <div className="form-actions">
              {inv.status === 'draft' && (
                <>
                  <button type="button" className="primary" onClick={onEdit}>
                    Edit draft
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={async () => {
                      const r = await window.juno.deleteInvoiceDraft(inv.id)
                      if (!r.ok) setMsg({ text: r.error, bad: true })
                      else onChanged()
                    }}
                  >
                    Delete draft
                  </button>
                </>
              )}
              {inv.status !== 'draft' && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await window.juno.openInvoicePdf(inv.id)
                      setMsg(r.ok ? { text: `Saved as ${r.value}`, bad: false } : { text: r.error, bad: true })
                    }}
                  >
                    Open PDF
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await window.juno.saveInvoicePdf(inv.id)
                      setMsg(r.ok ? { text: `Saved as ${r.value}`, bad: false } : { text: r.error, bad: true })
                    }}
                  >
                    Save PDF
                  </button>
                </>
              )}
              {inv.status === 'open' && (
                <>
                  <button type="button" className="primary" onClick={onPay}>
                    Record payment
                  </button>
                  <button type="button" className="danger" onClick={() => setVoiding('')}>
                    Void…
                  </button>
                </>
              )}
            </div>
            {voiding !== null && (
              <div className="form-row void-row">
                <input
                  autoFocus
                  placeholder="Reason, e.g. order cancelled"
                  value={voiding}
                  onChange={(e) => setVoiding(e.target.value)}
                  aria-label="Reason for voiding"
                />
                <button
                  type="button"
                  className="danger"
                  onClick={async () => {
                    const r = await window.juno.voidInvoice(inv.id, voiding)
                    if (!r.ok) return setMsg({ text: r.error, bad: true })
                    setVoiding(null)
                    onChanged()
                  }}
                >
                  Void invoice {inv.number}
                </button>
                <button type="button" onClick={() => setVoiding(null)}>
                  Cancel
                </button>
              </div>
            )}
            {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}
          </td>
        </tr>
      )}
    </>
  )
}

function InvoiceEditor({
  existing,
  customers,
  accounts,
  onDone,
  onCancel
}: {
  existing: Invoice | null
  customers: Customer[]
  accounts: ChartAccount[]
  onDone: (id: number) => void
  onCancel: () => void
}): JSX.Element {
  const income = accounts.filter((a) => a.isActive && a.type === 'income' && a.subtype !== 'contra')
  const defaultIncome = income.find((a) => a.number === '4000')?.id ?? income[0]?.id ?? null
  const today = localDateString()
  const [customerId, setCustomerId] = useState<number | null>(existing?.customerId ?? null)
  const [number, setNumber] = useState(existing?.number ?? '')
  const [issueDate, setIssueDate] = useState(existing?.issueDate ?? today)
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? addDays(today, 30))
  const [memo, setMemo] = useState(existing?.memo ?? '')
  const [rate, setRate] = useState(existing ? formatRate(existing.taxRateMilli).replace('%', '') : '')
  const [exempt, setExempt] = useState(existing?.taxExempt ?? false)
  const [exemptReason, setExemptReason] = useState(existing?.exemptReason ?? '')
  const [lines, setLines] = useState<LineDraft[]>(
    existing
      ? [
          ...existing.lines.map((l) => ({
            description: l.description,
            quantity: formatQuantity(l.quantityMilli).replace(/,/g, ''),
            price: (l.unitPriceCents / 100).toFixed(2),
            accountId: l.accountId,
            taxable: l.taxable
          })),
          blankLine(defaultIncome)
        ]
      : [blankLine(defaultIncome)]
  )
  const [cert, setCert] = useState<ResaleCertificate | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  useEffect(() => {
    if (!existing) window.juno.nextInvoiceNumber().then((r) => r.ok && setNumber(r.value))
  }, [])

  // A valid resale certificate on the invoice date: skip sales tax (the owner can still change it).
  useEffect(() => {
    if (customerId === null) return setCert(null)
    window.juno.validCertificate(customerId, issueDate).then((r) => {
      const c = r.ok ? r.value : null
      setCert(c)
      if (!existing && c) {
        setExempt(true)
        setExemptReason(`Resale certificate ${c.certNumber} (${c.stateCode})`)
      }
    })
  }, [customerId, issueDate])

  const customer = customers.find((c) => c.id === customerId)
  const used = lines.filter((l) => l.description.trim() || l.price.trim())
  const parsed = used.map((l) => ({
    description: l.description,
    quantityMilli: parseQuantity(l.quantity) ?? 0,
    unitPriceCents: parseMoney(l.price) ?? 0,
    accountId: l.accountId,
    taxable: l.taxable
  }))
  const rateMilli = parseRate(rate)
  const totals = invoiceTotals({ lines: parsed, taxRateMilli: rateMilli ?? 0, taxExempt: exempt })

  function setLine(i: number, patch: Partial<LineDraft>): void {
    setLines((prev) => {
      const next = prev.map((l, j) => (j === i ? { ...l, ...patch } : l))
      const last = next[next.length - 1]
      if (last.description.trim() || last.price.trim()) next.push(blankLine(defaultIncome))
      return next
    })
  }

  function input(): InvoiceInput | string {
    if (rateMilli === null) return 'Enter the sales tax rate as a percent, e.g. 7.25.'
    for (const [i, l] of used.entries()) {
      if (parseQuantity(l.quantity) === null || parseQuantity(l.quantity) === 0)
        return `Line ${i + 1}: enter a quantity.`
      if (parseMoney(l.price) === null) return `Line ${i + 1}: enter a price.`
    }
    return {
      number,
      customerId,
      issueDate,
      dueDate,
      memo,
      taxRateMilli: rateMilli,
      taxExempt: exempt,
      exemptReason,
      lines: parsed
    }
  }

  async function save(finalize: boolean): Promise<void> {
    const data = input()
    if (typeof data === 'string') return setMsg({ text: data, bad: true })
    const r = await window.juno.saveInvoiceDraft(existing?.id ?? null, data)
    if (!r.ok) return setMsg({ text: r.error, bad: true })
    if (finalize) {
      const f = await window.juno.finalizeInvoice(r.value.id)
      if (!f.ok) return setMsg({ text: `Saved as a draft, but not finalized: ${f.error}`, bad: true })
    }
    onDone(r.value.id)
  }

  return (
    <div className="form sales-tab invoice-editor">
      <h3>{existing ? `Edit draft invoice ${existing.number}` : 'New invoice'}</h3>
      <div className="form-row">
        <label className="grow">
          Customer
          <select
            value={customerId ?? ''}
            onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}
            aria-label="Invoice customer"
          >
            <option value="">Choose…</option>
            {customers
              .filter((c) => c.isActive || c.id === customerId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="narrow">
          Number
          <input value={number} onChange={(e) => setNumber(e.target.value)} aria-label="Invoice number" />
        </label>
        <label className="narrow-date">
          Date
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            aria-label="Invoice date"
          />
        </label>
        <label className="narrow-date">
          Due
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
        </label>
      </div>

      <table className="entry-table invoice-lines">
        <thead>
          <tr>
            <th>Description</th>
            <th className="amount">Qty</th>
            <th className="amount">Price</th>
            <th>Income account</th>
            <th>Taxable</th>
            <th className="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <input
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  aria-label={`Line ${i + 1} description`}
                />
              </td>
              <td className="amount">
                <input
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                  aria-label={`Line ${i + 1} quantity`}
                />
              </td>
              <td className="amount">
                <input
                  inputMode="decimal"
                  value={l.price}
                  onChange={(e) => setLine(i, { price: e.target.value })}
                  aria-label={`Line ${i + 1} price`}
                />
              </td>
              <td>
                <AccountCombobox
                  groups={[{ title: 'Income', accounts: income }]}
                  value={l.accountId}
                  onChange={(id) => setLine(i, { accountId: id })}
                  label={`Line ${i + 1} income account`}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={l.taxable}
                  onChange={(e) => setLine(i, { taxable: e.target.checked })}
                  aria-label={`Line ${i + 1} taxable`}
                />
              </td>
              <td className="amount">
                {l.description.trim() || l.price.trim() ? formatCents(totals.lineCents[used.indexOf(l)] ?? 0) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="form-row">
        <label className="narrow">
          Sales tax %
          <input
            inputMode="decimal"
            value={rate}
            disabled={exempt}
            onChange={(e) => setRate(e.target.value)}
            placeholder="e.g. 7.25"
            aria-label="Sales tax rate"
          />
        </label>
        <label className="toggle exempt-toggle">
          <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
          No sales tax (sale for resale or otherwise exempt)
        </label>
        {exempt && (
          <label className="grow">
            Why it&rsquo;s exempt
            <input value={exemptReason} onChange={(e) => setExemptReason(e.target.value)} aria-label="Exempt reason" />
          </label>
        )}
      </div>
      {exempt && !cert && (
        <p className="accountant-note">
          <span aria-hidden="true">⚑ </span>
          {customer?.name ?? 'This customer'} has no resale certificate on file that is valid on {issueDate}. Check with
          your accountant before skipping sales tax; add the certificate on the Customers tab.
        </p>
      )}
      {!exempt && customer?.isWholesale && cert && (
        <p className="hint">
          This wholesale buyer has a valid resale certificate ({cert.certNumber}); sales for resale usually aren&rsquo;t
          taxed.
        </p>
      )}
      <p className="hint">
        Sales tax rates by date come later; for now type the rate for where the sale happens (your accountant can
        confirm it).
      </p>
      <label>
        Note on the invoice (optional)
        <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} aria-label="Invoice note" />
      </label>
      <p className="invoice-totals">
        Subtotal {formatCents(totals.subtotalCents)} · Sales tax {formatCents(totals.taxCents)} ·{' '}
        <strong>Total {formatCents(totals.totalCents)}</strong>
      </p>
      {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}
      <div className="form-actions">
        <button type="button" onClick={() => void save(false)}>
          Save draft
        </button>
        <button type="button" className="primary" onClick={() => void save(true)}>
          Finalize invoice
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="hint">
        A draft changes nothing in your books. Finalizing records the sale (what the customer owes you, the income and
        any sales tax) and fixes the invoice; to change it afterwards, void it and make a new one.
      </p>
    </div>
  )
}

// ---- Payments -------------------------------------------------------------------------------------------

function Payments({
  customers,
  invoices,
  accounts,
  start,
  onChanged
}: {
  customers: Customer[]
  invoices: Invoice[]
  accounts: ChartAccount[]
  start: { customerId: number; invoiceId: number } | null
  onChanged: () => void
}): JSX.Element {
  const bank = accounts.find((a) => a.subtype === 'bank' && a.isActive)?.id ?? null
  const [customerId, setCustomerId] = useState<number | null>(start?.customerId ?? null)
  const [date, setDate] = useState(localDateString())
  const [amount, setAmount] = useState('')
  const [deposit, setDeposit] = useState<number | null>(bank)
  const [method, setMethod] = useState('')
  const [reference, setReference] = useState('')
  const [apply, setApply] = useState<Record<number, string>>({})
  const [payments, setPayments] = useState<Payment[]>([])
  const [voiding, setVoiding] = useState<{ id: number; reason: string } | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  useEffect(() => {
    window.juno.payments().then((r) => r.ok && setPayments(r.value))
  }, [invoices])

  const open = invoices
    .filter((i) => i.customerId === customerId && i.status === 'open')
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id - b.id)

  // Prefill from "Record payment" on an invoice.
  useEffect(() => {
    if (!start) return
    const inv = invoices.find((i) => i.id === start.invoiceId)
    if (inv && inv.status === 'open') {
      setAmount((inv.openCents / 100).toFixed(2))
      setApply({ [inv.id]: (inv.openCents / 100).toFixed(2) })
    }
  }, [start])

  /** Spreads the amount over open invoices, oldest first. */
  function spread(text: string): void {
    setAmount(text)
    let left = parseMoney(text) ?? 0
    const next: Record<number, string> = {}
    for (const i of open) {
      const take = Math.max(0, Math.min(left, i.openCents))
      next[i.id] = take ? (take / 100).toFixed(2) : ''
      left -= take
    }
    setApply(next)
  }

  async function record(): Promise<void> {
    const cents = parseMoney(amount)
    if (cents === null || cents <= 0) return setMsg({ text: 'Enter the amount you received.', bad: true })
    const applications = []
    for (const i of open) {
      const t = (apply[i.id] ?? '').trim()
      if (!t) continue
      const c = parseMoney(t)
      if (c === null || c < 0) return setMsg({ text: `The amount for invoice ${i.number} isn't readable.`, bad: true })
      if (c) applications.push({ invoiceId: i.id, amountCents: c })
    }
    const r = await window.juno.recordPayment({
      customerId,
      date,
      amountCents: cents,
      depositAccountId: deposit,
      method,
      reference,
      applications
    })
    if (!r.ok) return setMsg({ text: r.error, bad: true })
    setPayments(r.value)
    setAmount('')
    setApply({})
    setReference('')
    setMsg({ text: 'Payment recorded.', bad: false })
    onChanged()
  }

  const appliedTotal = open.reduce((s, i) => s + (parseMoney(apply[i.id] ?? '') ?? 0), 0)

  return (
    <div className="form sales-tab">
      <h3>Record a payment</h3>
      <div className="form-row">
        <label className="grow">
          From customer
          <select
            value={customerId ?? ''}
            onChange={(e) => {
              setCustomerId(e.target.value ? Number(e.target.value) : null)
              setApply({})
            }}
            aria-label="Payment customer"
          >
            <option value="">Choose…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.openCents ? ` (owes ${formatCents(c.openCents)})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="narrow-date">
          Date received
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Payment date" />
        </label>
        <label className="narrow">
          Amount
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => spread(e.target.value)}
            aria-label="Payment amount"
          />
        </label>
      </div>
      <div className="form-row">
        <label className="grow">
          Deposited to
          <AccountCombobox
            groups={importAccountGroups(accounts).filter((g) => g.title !== 'Credit cards')}
            value={deposit}
            onChange={setDeposit}
            label="Deposited to"
          />
        </label>
        <label className="narrow">
          Method
          <input
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="Check, Zelle…"
            aria-label="Payment method"
          />
        </label>
        <label className="narrow">
          Reference
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Check #"
            aria-label="Payment reference"
          />
        </label>
      </div>
      {customerId !== null &&
        (open.length === 0 ? (
          <p className="muted">This customer has no open invoices.</p>
        ) : (
          <table className="chart-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th className="amount">Still owed</th>
                <th className="amount">Apply</th>
              </tr>
            </thead>
            <tbody>
              {open.map((i) => (
                <tr key={i.id}>
                  <td>{i.number}</td>
                  <td>{i.issueDate}</td>
                  <td className="amount">{formatCents(i.openCents)}</td>
                  <td className="amount">
                    <input
                      inputMode="decimal"
                      value={apply[i.id] ?? ''}
                      onChange={(e) => setApply({ ...apply, [i.id]: e.target.value })}
                      aria-label={`Apply to invoice ${i.number}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      {customerId !== null && open.length > 0 && (
        <p className="hint">
          Applied {formatCents(appliedTotal)} of {formatCents(parseMoney(amount) ?? 0)}. Typing the amount fills the
          oldest invoices first; change the split if the customer said otherwise.
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="primary" onClick={() => void record()}>
          Record payment
        </button>
      </div>
      {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}

      <h3>Payments received</h3>
      {payments.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <table className="chart-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Customer</th>
              <th className="amount">Amount</th>
              <th>For</th>
              <th>Into</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className={p.status === 'void' ? 'inactive' : ''}>
                <td>{p.date}</td>
                <td>{p.customerName}</td>
                <td className="amount">{formatCents(p.amountCents)}</td>
                <td>{p.applications.map((a) => `#${a.invoiceNumber} ${formatCents(a.amountCents)}`).join(', ')}</td>
                <td>
                  {p.depositAccountName}
                  {p.reference && ` · ${p.reference}`}
                </td>
                <td className="row-actions">
                  {p.status === 'void' ? (
                    'Voided'
                  ) : voiding?.id === p.id ? (
                    <>
                      <input
                        value={voiding.reason}
                        onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })}
                        placeholder="Reason"
                        aria-label="Reason for voiding payment"
                      />{' '}
                      <button
                        type="button"
                        className="link-button"
                        onClick={async () => {
                          const r = await window.juno.voidPayment(p.id, voiding.reason)
                          if (!r.ok) return setMsg({ text: r.error, bad: true })
                          setPayments(r.value)
                          setVoiding(null)
                          onChanged()
                        }}
                      >
                        Void
                      </button>
                    </>
                  ) : (
                    <button type="button" className="link-button" onClick={() => setVoiding({ id: p.id, reason: '' })}>
                      Void…
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---- Aging ----------------------------------------------------------------------------------------------

function Aging(): JSX.Element {
  const [asOf, setAsOf] = useState(localDateString())
  const [rows, setRows] = useState<AgingRow[]>([])
  useEffect(() => {
    window.juno.aging(asOf).then((r) => r.ok && setRows(r.value))
  }, [asOf])
  const total = (k: keyof Omit<AgingRow, 'customerId' | 'customerName'>): number => rows.reduce((s, r) => s + r[k], 0)
  const cols: [keyof Omit<AgingRow, 'customerId' | 'customerName'>, string][] = [
    ['currentCents', 'Not due yet'],
    ['days1to30', '1–30 days late'],
    ['days31to60', '31–60'],
    ['days61to90', '61–90'],
    ['over90', 'Over 90'],
    ['totalCents', 'Total owed']
  ]
  return (
    <div className="form sales-tab">
      <label className="narrow-date">
        As of
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="Aging as of" />
      </label>
      {rows.length === 0 ? (
        <p className="muted">Nobody owes you anything on {asOf}.</p>
      ) : (
        <table className="chart-table aging">
          <thead>
            <tr>
              <th>Customer</th>
              {cols.map(([k, label]) => (
                <th key={k} className="amount">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customerId}>
                <td>{r.customerName}</td>
                {cols.map(([k]) => (
                  <td key={k} className="amount">
                    {r[k] ? formatCents(r[k]) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              {cols.map(([k]) => (
                <th key={k} className="amount">
                  {formatCents(total(k))}
                </th>
              ))}
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}

export default Sales
