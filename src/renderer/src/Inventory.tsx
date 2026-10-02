import { useEffect, useState, type FormEvent } from 'react'
import type {
  ChartAccount,
  CountSheet,
  InventoryMethod,
  InventoryOverview,
  InventoryYearReport
} from '../../preload/types'
import { localDateString } from '../../shared/dates'
import {
  COMMON_UNITS,
  formatQuantity,
  INVENTORY_METHODS,
  methodLabel,
  parseQuantity,
  scaleCents
} from '../../shared/inventory'
import { formatCents, parseMoney } from '../../shared/money'
import AccountCombobox from './AccountCombobox'

interface Props {
  onChanged: () => void
  onClose: () => void
}

type Tab = 'items' | 'purchases' | 'counts' | 'methods'

/** Inventory: items, material purchases, physical counts, and the four methods with the filed one. */
function Inventory({ onChanged, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('items')
  const [data, setData] = useState<InventoryOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function apply(
    p: Promise<{ ok: true; value: InventoryOverview } | { ok: false; error: string }>
  ): Promise<boolean> {
    const r = await p
    if (!r.ok) {
      setError(r.error)
      return false
    }
    setError(null)
    setData(r.value)
    return true
  }

  useEffect(() => {
    void apply(window.juno.inventoryOverview())
  }, [])

  if (!data) return <p>{error ?? 'Loading inventory…'}</p>
  const tabs: { id: Tab; label: string }[] = [
    { id: 'items', label: `Items (${data.items.length})` },
    { id: 'purchases', label: `Purchases (${data.purchases.length})` },
    { id: 'counts', label: 'Counts' },
    { id: 'methods', label: 'Methods and year end' }
  ]

  return (
    <section className="panel journal-entry inventory">
      <div className="chart-header">
        <h2>Inventory</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Record the materials you buy (how much and what it cost) and count what is on hand, at least at the end of the
        year. JunoBooks works out the value of what is left and the cost of goods sold four ways, side by side; the
        method your accountant files with is the one that goes into your books. The money for purchases is still
        recorded as usual (New expense or bank imports); this screen only adds the quantities.
      </p>
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {tab === 'items' && <Items data={data} apply={apply} />}
      {tab === 'purchases' && <Purchases data={data} apply={apply} />}
      {tab === 'counts' && <Counts data={data} onSaved={() => void apply(window.juno.inventoryOverview())} />}
      {tab === 'methods' && <Methods firstYear={data.firstYear} onChanged={onChanged} />}
    </section>
  )
}

type Apply = (p: Promise<{ ok: true; value: InventoryOverview } | { ok: false; error: string }>) => Promise<boolean>

function Items({ data, apply }: { data: InventoryOverview; apply: Apply }): JSX.Element {
  const blank = { name: '', unit: 'g', notes: '' }
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState<{
    id: number
    name: string
    unit: string
    notes: string
    isActive: boolean
  } | null>(null)

  return (
    <>
      <form
        className="form inventory-form"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault()
          if (await apply(window.juno.addInventoryItem(form))) setForm(blank)
        }}
      >
        <div className="form-row">
          <label className="grow">
            Item
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Sterling silver sheet 22ga"
            />
          </label>
          <label className="narrow">
            Unit
            <input
              list="inventory-units"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            />
          </label>
          <label className="grow">
            Notes (optional)
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>
        <datalist id="inventory-units">
          {COMMON_UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <div className="form-actions">
          <button type="submit" className="primary">
            Add item
          </button>
        </div>
      </form>
      {data.items.length === 0 ? (
        <p className="muted">
          No items yet. Add the materials you keep track of, e.g. silver sheet, gold wire, stones, chain.
        </p>
      ) : (
        <table className="chart-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Unit</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) =>
              editing?.id === i.id ? (
                <tr key={i.id}>
                  <td>
                    <input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      aria-label="Item name"
                    />
                  </td>
                  <td>
                    <input
                      list="inventory-units"
                      value={editing.unit}
                      onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                      aria-label="Unit"
                    />
                  </td>
                  <td>
                    <input
                      value={editing.notes}
                      onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                      aria-label="Notes"
                    />
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={async () => {
                        if (await apply(window.juno.updateInventoryItem(i.id, editing))) setEditing(null)
                      }}
                    >
                      Save
                    </button>{' '}
                    <button type="button" className="link-button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={i.id} className={i.isActive ? '' : 'inactive'}>
                  <td>
                    {i.name}
                    {!i.isActive && ' (turned off)'}
                  </td>
                  <td>{i.unit}</td>
                  <td>{i.notes}</td>
                  <td className="row-actions">
                    <button type="button" className="link-button" onClick={() => setEditing({ ...i })}>
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void apply(window.juno.updateInventoryItem(i.id, { ...i, isActive: !i.isActive }))}
                    >
                      {i.isActive ? 'Turn off' : 'Turn on'}
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </>
  )
}

function Purchases({ data, apply }: { data: InventoryOverview; apply: Apply }): JSX.Element {
  const active = data.items.filter((i) => i.isActive)
  const blank = {
    itemId: active[0]?.id ?? 0,
    date: localDateString(),
    quantity: '',
    cost: '',
    memo: '',
    isOpening: false
  }
  const [form, setForm] = useState(blank)
  const [error, setError] = useState<string | null>(null)
  const item = (id: number) => data.items.find((i) => i.id === id)

  if (active.length === 0) return <p className="muted">Add an item first (Items tab).</p>

  return (
    <>
      <form
        className="form inventory-form"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault()
          const q = parseQuantity(form.quantity)
          const c = parseMoney(form.cost)
          if (q === null || q === 0) return setError('Enter how much you bought, e.g. 25 or 12.5.')
          if (c === null || c < 0) return setError('Enter the total cost, e.g. 180.00.')
          setError(null)
          const ok = await apply(
            window.juno.addInventoryPurchase({
              itemId: form.itemId,
              date: form.date,
              quantityMilli: q,
              costCents: c,
              isOpening: form.isOpening,
              memo: form.memo
            })
          )
          if (ok) setForm({ ...blank, itemId: form.itemId, date: form.date })
        }}
      >
        <div className="form-row">
          <label className="narrow-date">
            Date
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label className="grow">
            Item
            <select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: Number(e.target.value) })}>
              {active.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </select>
          </label>
          <label className="narrow">
            Quantity ({item(form.itemId)?.unit})
            <input
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </label>
          <label className="narrow">
            Total cost
            <input inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </label>
        </div>
        <div className="form-row">
          <label className="grow">
            Note (optional)
            <input
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder="e.g. Rio Grande order 55120"
            />
          </label>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.isOpening}
            onChange={(e) => setForm({ ...form, isOpening: e.target.checked })}
          />
          This is stock on hand when the books start (opening stock), not a new purchase
        </label>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="primary">
            Add purchase
          </button>
        </div>
      </form>
      {data.purchases.length === 0 ? (
        <p className="muted">No purchases recorded yet.</p>
      ) : (
        <table className="chart-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th className="amount">Quantity</th>
              <th className="amount">Cost</th>
              <th className="amount">Per unit</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.purchases.map((p) => {
              const it = item(p.itemId)
              return (
                <tr key={p.id}>
                  <td>{p.date}</td>
                  <td>
                    {it?.name}
                    {p.isOpening && <div className="account-description">Opening stock</div>}
                  </td>
                  <td className="amount">
                    {formatQuantity(p.quantityMilli)} {it?.unit}
                  </td>
                  <td className="amount">{formatCents(p.costCents)}</td>
                  <td className="amount">{formatCents(scaleCents(p.costCents, 1000, p.quantityMilli))}</td>
                  <td>{p.memo}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void apply(window.juno.removeInventoryPurchase(p.id))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

function Counts({ data, onSaved }: { data: InventoryOverview; onSaved: () => void }): JSX.Element {
  const [date, setDate] = useState(`${localDateString().slice(0, 4)}-12-31`)
  const [sheet, setSheet] = useState<CountSheet | null>(null)
  const [values, setValues] = useState<Record<number, string>>({})
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)

  useEffect(() => setMessage(null), [date])

  useEffect(() => {
    window.juno.countSheet(date).then((r) => {
      if (!r.ok) {
        setSheet(null)
        return
      }
      setSheet(r.value)
      setValues(
        Object.fromEntries(
          r.value.rows.map((x) => [
            x.itemId,
            x.quantityMilli === null ? '' : formatQuantity(x.quantityMilli).replace(/,/g, '')
          ])
        )
      )
    })
  }, [date, data])

  async function save(): Promise<void> {
    if (!sheet) return
    const rows: { itemId: number; quantityMilli: number | null }[] = []
    for (const r of sheet.rows) {
      const text = (values[r.itemId] ?? '').trim()
      if (!text) {
        rows.push({ itemId: r.itemId, quantityMilli: null })
        continue
      }
      const q = parseQuantity(text)
      if (q === null) return setMessage({ text: `"${text}" for ${r.name} isn't a quantity.`, bad: true })
      rows.push({ itemId: r.itemId, quantityMilli: q })
    }
    const res = await window.juno.saveCount(date, rows)
    if (!res.ok) return setMessage({ text: res.error, bad: true })
    setMessage({ text: `Count for ${date} saved.`, bad: false })
    onSaved()
  }

  return (
    <div className="form inventory-tab">
      <p className="hint">
        Count what is physically on hand and enter it here. The year-end count (December 31) is the one the methods use;
        counts during the year help catch mistakes. Leave an item blank if you didn&rsquo;t count it.
      </p>
      <div className="form-row">
        <label className="narrow-date">
          Count date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Count date" />
        </label>
        {data.counts.length > 0 && (
          <div className="count-dates">
            Earlier counts:{' '}
            {data.counts.map((c) => (
              <button key={c.date} type="button" className="link-button" onClick={() => setDate(c.date)}>
                {c.date}
              </button>
            ))}
          </div>
        )}
      </div>
      {sheet && sheet.rows.length === 0 && <p className="muted">Add items first (Items tab).</p>}
      {sheet && sheet.rows.length > 0 && (
        <>
          <table className="chart-table count-sheet">
            <thead>
              <tr>
                <th>Item</th>
                <th className="amount">Expected</th>
                <th className="amount">Counted</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r) => (
                <tr key={r.itemId}>
                  <td>{r.name}</td>
                  <td className="amount muted">
                    {r.expectedMilli === null ? '—' : `${formatQuantity(r.expectedMilli)} ${r.unit}`}
                  </td>
                  <td className="amount">
                    <input
                      inputMode="decimal"
                      aria-label={`Counted ${r.name}`}
                      value={values[r.itemId] ?? ''}
                      onChange={(e) => setValues({ ...values, [r.itemId]: e.target.value })}
                    />{' '}
                    {r.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            &ldquo;Expected&rdquo; is the last count plus purchases since; the difference is what was used.
          </p>
          <div className="form-actions">
            <button type="button" className="primary" onClick={() => void save()}>
              Save count
            </button>
          </div>
        </>
      )}
      {message && <p className={message.bad ? 'error' : 'success'}>{message.text}</p>}
    </div>
  )
}

function Methods({ firstYear, onChanged }: { firstYear: number; onChanged: () => void }): JSX.Element {
  const thisYear = Number(localDateString().slice(0, 4))
  const years = Array.from({ length: Math.max(1, thisYear - firstYear + 1) }, (_, i) => thisYear - i)
  const [year, setYear] = useState(thisYear >= firstYear ? thisYear : firstYear)
  const [report, setReport] = useState<InventoryYearReport | null>(null)
  const [choice, setChoice] = useState<InventoryMethod | ''>('')
  const [reason, setReason] = useState('')
  const [accounts, setAccounts] = useState<ChartAccount[]>([])
  const [adj, setAdj] = useState<{ inventoryAccountId: number | null; cogsAccountId: number | null }>({
    inventoryAccountId: null,
    cogsAccountId: null
  })
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)

  useEffect(() => {
    window.juno.getChart().then((c) => setAccounts(c ? c.accounts : []))
    window.juno.inventoryAdjustmentAccounts().then((r) => r.ok && setAdj(r.value))
  }, [])

  useEffect(() => {
    setMessage(null)
    window.juno.inventoryYear(year).then((r) => {
      if (r.ok) {
        setReport(r.value)
        setChoice(r.value.filed ?? '')
        setReason('')
      } else setMessage({ text: r.error, bad: true })
    })
  }, [year])

  if (!report) return <p>{message?.text ?? 'Working it out…'}</p>
  const filed = report.methods.find((m) => m.method === report.filed)
  const changing = report.filed !== null && choice !== report.filed

  const inventoryGroups = [
    { title: 'Inventory', accounts: accounts.filter((a) => a.isActive && a.subtype === 'inventory') }
  ]
  const cogsGroups = [
    { title: 'Cost of goods sold', accounts: accounts.filter((a) => a.isActive && a.subtype === 'cogs') }
  ]

  return (
    <div className="form inventory-tab">
      <div className="form-row">
        <label className="narrow">
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      <table className="chart-table methods-table">
        <thead>
          <tr>
            <th>Method</th>
            <th className="amount">Beginning inventory</th>
            <th className="amount">+ Purchases</th>
            <th className="amount">− Ending inventory</th>
            <th className="amount">= Cost of goods sold</th>
          </tr>
        </thead>
        <tbody>
          {report.methods.map((m) => (
            <tr key={m.method} className={m.method === report.filed ? 'filed-row' : ''}>
              <td>
                {methodLabel(m.method)}
                {m.method === report.filed && <strong> · filed</strong>}
                <div className="account-description">{INVENTORY_METHODS.find((x) => x.id === m.method)!.hint}</div>
              </td>
              <td className="amount">{formatCents(m.beginCents)}</td>
              <td className="amount">{formatCents(m.purchasesCents)}</td>
              <td className="amount">{formatCents(m.endCents)}</td>
              <td className="amount">{formatCents(m.cogsCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.notCounted.length > 0 && (
        <p className="accountant-note">
          Not counted on {year}-12-31: {report.notCounted.join(', ')}. Their ending quantity is the last count plus
          purchases since (or everything bought, if never counted). Count them on the Counts tab for a true figure.
        </p>
      )}
      <p className="hint">
        Purchases recorded here in {year}: {formatCents(report.check.inventoryPurchasesCents)}. Materials and inventory
        purchases in your books in {year}: {formatCents(report.check.booksPurchasesCents)}.
        {report.check.inventoryPurchasesCents !== report.check.booksPurchasesCents &&
          ' These normally match; a difference means a purchase is missing from one side (or was posted to another account).'}
      </p>

      <h3>Filed method for {year}</h3>
      <p className="accountant-note">
        <span aria-hidden="true">⚑ </span>
        Check with your accountant: choose the method they file your tax return with. Changing a filed method generally
        needs IRS consent (Form 3115), so don&rsquo;t change it without asking them. The other methods stay here as
        what-if reports.
      </p>
      <div className="form-row">
        <label className="grow">
          Method
          <select value={choice} onChange={(e) => setChoice(e.target.value as InventoryMethod | '')}>
            <option value="">Not chosen yet</option>
            {INVENTORY_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {changing && (
          <label className="grow">
            Reason for the change
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. accountant filed Form 3115"
            />
          </label>
        )}
      </div>
      <div className="form-actions">
        <button
          type="button"
          disabled={(choice || null) === report.filed}
          onClick={async () => {
            const r = await window.juno.setFiledMethod(year, choice || null, reason)
            if (!r.ok) return setMessage({ text: r.error, bad: true })
            setReport(r.value)
            setMessage({ text: `Filed method for ${year} saved.`, bad: false })
          }}
        >
          Save filed method
        </button>
      </div>
      {report.history.length > 1 && (
        <ul className="muted method-history">
          {report.history.map((h, i) => (
            <li key={i}>
              {h.createdAt.slice(0, 10)}: {h.method ? methodLabel(h.method) : 'not chosen'}
              {h.reason && ` (${h.reason})`}
            </li>
          ))}
        </ul>
      )}

      <h3>Year-end entry</h3>
      {!filed ? (
        <p className="muted">Once a filed method is chosen, JunoBooks can post the year-end inventory entry for it.</p>
      ) : (
        <>
          <p className="hint">
            Brings your inventory account to the {methodLabel(filed.method)} ending value ({formatCents(filed.endCents)}
            ) on {year}-12-31; the difference goes to cost of goods sold. Inventory accounts in the books on that date:{' '}
            {formatCents(report.inventoryBalanceCents)}.
            {report.adjustment &&
              ` Posted as entry #${report.adjustment.entryId ?? '—'} (${methodLabel(report.adjustment.method)}, ${formatCents(report.adjustment.valueCents)}); posting again replaces it.`}
          </p>
          <div className="form-row">
            <label className="grow">
              Inventory account
              <AccountCombobox
                groups={inventoryGroups}
                value={adj.inventoryAccountId}
                onChange={(id) => setAdj({ ...adj, inventoryAccountId: id })}
                label="Inventory account"
              />
            </label>
            <label className="grow">
              Cost of goods sold account
              <AccountCombobox
                groups={cogsGroups}
                value={adj.cogsAccountId}
                onChange={(id) => setAdj({ ...adj, cogsAccountId: id })}
                label="Cost of goods sold account"
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="primary"
              disabled={!adj.inventoryAccountId || !adj.cogsAccountId}
              onClick={async () => {
                const r = await window.juno.postInventoryAdjustment(year, adj.inventoryAccountId!, adj.cogsAccountId!)
                if (!r.ok) return setMessage({ text: r.error, bad: true })
                setReport(r.value)
                setMessage({ text: `Year-end inventory entry for ${year} posted.`, bad: false })
                onChanged()
              }}
            >
              {report.adjustment ? 'Post it again (replace)' : 'Post year-end inventory entry'}
            </button>
          </div>
        </>
      )}
      {message && <p className={message.bad ? 'error' : 'success'}>{message.text}</p>}
    </div>
  )
}

export default Inventory
