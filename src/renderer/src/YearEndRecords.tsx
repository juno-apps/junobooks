import { useEffect, useState } from 'react'
import type {
  ChartAccount,
  Contractor,
  FixedAssetReport,
  HomeOffice,
  HomeOfficeSummary,
  MileageReport,
  NecReport
} from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { formatCents, parseMoney } from '../../shared/money'
import { formatMiles, parseMiles } from '../../shared/records'
import { plainCents } from '../../shared/reports'
import AccountCombobox from './AccountCombobox'
import { CsvButtons, type Msg } from './ReportBits'

interface Props {
  firstYear: number
  onClose: () => void
}

type Tab = 'nec' | 'assets' | 'mileage' | 'office'

/** Records the accountant needs at year end: contractors (1099-NEC), fixed assets, mileage, home office. */
function YearEndRecords({ firstYear, onClose }: Props): JSX.Element {
  const thisYear = Number(localDateString().slice(0, 4))
  const years = Array.from({ length: Math.max(1, thisYear - firstYear + 1) }, (_, i) => thisYear - i)
  const [year, setYear] = useState(years[0])
  const [tab, setTab] = useState<Tab>('nec')
  const [msg, setMsg] = useState<Msg>(null)
  const tabs: [Tab, string][] = [
    ['nec', 'Contractors (1099-NEC)'],
    ['assets', 'Fixed assets'],
    ['mileage', 'Mileage'],
    ['office', 'Home office']
  ]
  return (
    <section className="panel journal-entry records">
      <div className="chart-header">
        <h2>Year-end records</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="form-row">
        <label className="narrow">
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Records year">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}
      <div className="form records-tab">
        {tab === 'nec' && <Nec year={year} onMsg={setMsg} />}
        {tab === 'assets' && <Assets year={year} onMsg={setMsg} />}
        {tab === 'mileage' && <Mileage year={year} onMsg={setMsg} />}
        {tab === 'office' && <Office year={year} onMsg={setMsg} />}
      </div>
    </section>
  )
}

function Nec({ year, onMsg }: { year: number; onMsg: (m: Msg) => void }): JSX.Element {
  const [list, setList] = useState<Contractor[]>([])
  const [report, setReport] = useState<NecReport | null>(null)
  const blank = { name: '', address: '', w9OnFile: false, tinLast4: '', matchText: '', notes: '' }
  const [form, setForm] = useState(blank)
  async function reload(): Promise<void> {
    const [c, r] = await Promise.all([window.juno.contractors(), window.juno.necReport(year)])
    if (c.ok) setList(c.value)
    if (r.ok) setReport(r.value)
  }
  useEffect(() => {
    void reload()
  }, [year])
  return (
    <>
      <p className="hint">
        People and businesses you pay for services (not employees, not goods). JunoBooks finds payments to Contract
        labor and Legal and professional accounts whose memo contains the contractor&rsquo;s words. Payments made by
        credit card are shown but left out: the card company reports those.
      </p>
      <div className="form-row">
        <label className="grow">
          Contractor name
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            aria-label="Contractor name"
          />
        </label>
        <label className="grow">
          Words in their payment memos
          <input
            value={form.matchText}
            placeholder="defaults to the name"
            onChange={(e) => setForm({ ...form, matchText: e.target.value })}
            aria-label="Contractor match words"
          />
        </label>
        <label className="narrow">
          Tax ID last 4
          <input
            value={form.tinLast4}
            onChange={(e) => setForm({ ...form, tinLast4: e.target.value })}
            aria-label="Contractor tax ID last four"
          />
        </label>
      </div>
      <label>
        Address (for the 1099)
        <input
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          aria-label="Contractor address"
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.w9OnFile}
          onChange={(e) => setForm({ ...form, w9OnFile: e.target.checked })}
        />
        I have their W-9
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const r = await window.juno.saveContractor(null, form)
            if (!r.ok) return onMsg({ text: r.error, bad: true })
            setForm(blank)
            onMsg({ text: 'Contractor added.', bad: false })
            await reload()
          }}
        >
          Add contractor
        </button>
      </div>
      {report && (
        <>
          <h3>1099-NEC list for {year}</h3>
          <div className="report-actions">
            <CsvButtons
              name={`1099-NEC ${year}`}
              onMsg={onMsg}
              rows={() => [
                ['1099-NEC list', String(year), `Threshold ${plainCents(report.thresholdCents)}`],
                [
                  'Contractor',
                  'W-9 on file',
                  'Tax ID last 4',
                  'Paid (bank, cash, check)',
                  'Paid by card (not on 1099-NEC)',
                  'Needs a 1099-NEC'
                ],
                ...report.rows.map((r) => [
                  r.name,
                  r.w9OnFile ? 'yes' : 'no',
                  r.tinLast4,
                  plainCents(r.paidCents),
                  plainCents(r.paidByCardCents),
                  r.overThreshold ? 'yes' : 'no'
                ])
              ]}
            />
          </div>
          {report.rows.length === 0 ? (
            <p className="muted">No payments to contractors found for {year}.</p>
          ) : (
            <table className="chart-table nec-table">
              <thead>
                <tr>
                  <th>Contractor</th>
                  <th>W-9</th>
                  <th className="amount">Paid by bank/cash/check</th>
                  <th className="amount">Paid by card</th>
                  <th>1099-NEC?</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.contractorId}>
                    <td>{r.name}</td>
                    <td className={r.w9OnFile ? 'ok' : 'warn'}>
                      {r.w9OnFile ? `on file${r.tinLast4 ? ` (…${r.tinLast4})` : ''}` : 'missing'}
                    </td>
                    <td className="amount">{formatCents(r.paidCents)}</td>
                    <td className="amount">{r.paidByCardCents ? formatCents(r.paidByCardCents) : ''}</td>
                    <td>{r.overThreshold ? <strong>Yes</strong> : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report.unmatched.length > 0 && (
            <p className="accountant-note">
              Contract-labor payments not matched to a contractor:{' '}
              {report.unmatched.map((u) => `${u.date} ${u.memo || '(no memo)'} ${formatCents(u.cents)}`).join('; ')}.
              Add the contractor above (or adjust their words) so they&rsquo;re counted.
            </p>
          )}
          <p className="accountant-note">
            <span aria-hidden="true">⚑ </span>
            Check with your accountant: a 1099-NEC is generally needed for each contractor paid{' '}
            {formatCents(report.thresholdCents)} or more in {year} by bank, cash or check (the threshold rose from $600
            to $2,000 for payments from 2026). Corporations are usually exempt; your accountant confirms who needs one
            and files them.
          </p>
          {list.length > 0 && <p className="hint">Contractors on file: {list.map((c) => c.name).join(', ')}.</p>}
        </>
      )}
    </>
  )
}

function Assets({ year, onMsg }: { year: number; onMsg: (m: Msg) => void }): JSX.Element {
  const [report, setReport] = useState<FixedAssetReport | null>(null)
  const [accounts, setAccounts] = useState<ChartAccount[]>([])
  const blank = {
    name: '',
    accountId: null as number | null,
    inServiceDate: `${year}-01-01`,
    cost: '',
    disposedDate: '',
    notes: ''
  }
  const [form, setForm] = useState(blank)
  async function reload(): Promise<void> {
    const r = await window.juno.fixedAssetReport(year)
    if (r.ok) setReport(r.value)
  }
  useEffect(() => {
    void reload()
    window.juno.getChart().then((c) => {
      const accts = c ? c.accounts : []
      setAccounts(accts)
      setForm((f) => ({
        ...f,
        accountId: f.accountId ?? accts.find((a) => a.subtype === 'fixed_asset' && a.isActive)?.id ?? null
      }))
    })
  }, [year])
  const groups = [
    {
      title: 'Equipment and other fixed assets',
      accounts: accounts.filter((a) => a.isActive && a.subtype === 'fixed_asset')
    }
  ]
  return (
    <>
      <p className="hint">
        Equipment and tools that last more than a year (a rolling mill, kiln, laser, computer). Record what it cost and
        when you started using it; your accountant decides how to depreciate it.
      </p>
      <div className="form-row">
        <label className="grow">
          Asset
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            aria-label="Asset name"
          />
        </label>
        <label className="narrow">
          Cost
          <input
            inputMode="decimal"
            value={form.cost}
            onChange={(e) => setForm({ ...form, cost: e.target.value })}
            aria-label="Asset cost"
          />
        </label>
        <label className="narrow-date">
          In service from
          <input
            type="date"
            value={form.inServiceDate}
            onChange={(e) => setForm({ ...form, inServiceDate: e.target.value })}
            aria-label="Asset in service"
          />
        </label>
        <label className="narrow-date">
          Sold or scrapped (if)
          <input
            type="date"
            value={form.disposedDate}
            onChange={(e) => setForm({ ...form, disposedDate: e.target.value })}
            aria-label="Asset disposed"
          />
        </label>
      </div>
      <div className="form-row">
        <label className="grow">
          Account
          <AccountCombobox
            groups={groups}
            value={form.accountId}
            onChange={(id) => setForm({ ...form, accountId: id })}
            label="Asset account"
          />
        </label>
        <label className="grow">
          Notes
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            aria-label="Asset notes"
          />
        </label>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const cost = parseMoney(form.cost)
            if (cost === null) return onMsg({ text: 'Enter what it cost.', bad: true })
            const r = await window.juno.saveFixedAsset(null, {
              name: form.name,
              accountId: form.accountId,
              inServiceDate: form.inServiceDate,
              costCents: cost,
              disposedDate: form.disposedDate || null,
              notes: form.notes
            })
            if (!r.ok) return onMsg({ text: r.error, bad: true })
            setForm({ ...blank, accountId: form.accountId })
            onMsg({ text: 'Asset added.', bad: false })
            await reload()
          }}
        >
          Add asset
        </button>
      </div>
      {report && (
        <>
          <h3>Fixed-asset list for {year}</h3>
          <div className="report-actions">
            <CsvButtons
              name={`Fixed assets ${year}`}
              onMsg={onMsg}
              rows={() => [
                ['Fixed-asset list', String(year)],
                ['Asset', 'Account', 'In service', 'Cost', 'Sold or scrapped', 'Notes'],
                ...report.assets.map((a) => [
                  a.name,
                  a.accountName ?? '',
                  a.inServiceDate,
                  plainCents(a.costCents),
                  a.disposedDate ?? '',
                  a.notes
                ])
              ]}
            />
          </div>
          {report.assets.length === 0 ? (
            <p className="muted">No fixed assets in service in {year}.</p>
          ) : (
            <table className="chart-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>In service</th>
                  <th className="amount">Cost</th>
                  <th>Status in {year}</th>
                </tr>
              </thead>
              <tbody>
                {report.assets.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.name}
                      {a.notes && <div className="account-description">{a.notes}</div>}
                    </td>
                    <td>{a.inServiceDate}</td>
                    <td className="amount">{formatCents(a.costCents)}</td>
                    <td>
                      {a.disposedThisYear
                        ? `Sold or scrapped ${a.disposedDate}`
                        : a.placedThisYear
                          ? 'New this year'
                          : 'In use'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={report.totalCostCents === report.booksCents ? 'hint' : 'accountant-note'}>
            Cost of assets in use at year end: {formatCents(report.totalCostCents)}. Fixed-asset accounts in your books
            on {year}-12-31: {formatCents(report.booksCents)}.
            {report.totalCostCents !== report.booksCents &&
              ' These usually match; a difference means an asset is missing here or was expensed in the books.'}
          </p>
          <p className="accountant-note">
            <span aria-hidden="true">⚑ </span>
            Check with your accountant: depreciation, section 179 and bonus depreciation are their call; this list gives
            them the cost and dates.
          </p>
        </>
      )}
    </>
  )
}

function Mileage({ year, onMsg }: { year: number; onMsg: (m: Msg) => void }): JSX.Element {
  const [report, setReport] = useState<MileageReport | null>(null)
  const [trip, setTrip] = useState({ date: localDateString(), miles: '', purpose: '', fromPlace: '', toPlace: '' })
  const [rate, setRate] = useState('')
  useEffect(() => {
    window.juno.mileageReport(year).then((r) => {
      if (!r.ok) return
      setReport(r.value)
      setRate(r.value.rateTenthCents === null ? '' : String(r.value.rateTenthCents / 10))
    })
  }, [year])
  return (
    <>
      <p className="hint">
        Log business trips (to the post office, bank, suppliers, shows). Commuting from home to a regular workplace
        doesn&rsquo;t count.
      </p>
      <div className="form-row">
        <label className="narrow-date">
          Date
          <input
            type="date"
            value={trip.date}
            onChange={(e) => setTrip({ ...trip, date: e.target.value })}
            aria-label="Trip date"
          />
        </label>
        <label className="narrow">
          Miles
          <input
            inputMode="decimal"
            value={trip.miles}
            onChange={(e) => setTrip({ ...trip, miles: e.target.value })}
            aria-label="Trip miles"
          />
        </label>
        <label className="grow">
          Business purpose
          <input
            value={trip.purpose}
            onChange={(e) => setTrip({ ...trip, purpose: e.target.value })}
            aria-label="Trip purpose"
          />
        </label>
      </div>
      <div className="form-row">
        <label className="grow">
          From
          <input
            value={trip.fromPlace}
            onChange={(e) => setTrip({ ...trip, fromPlace: e.target.value })}
            aria-label="Trip from"
          />
        </label>
        <label className="grow">
          To
          <input
            value={trip.toPlace}
            onChange={(e) => setTrip({ ...trip, toPlace: e.target.value })}
            aria-label="Trip to"
          />
        </label>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const tenths = parseMiles(trip.miles)
            if (tenths === null || tenths === 0) return onMsg({ text: 'Enter the miles, e.g. 12.5.', bad: true })
            const r = await window.juno.addTrip({
              date: trip.date,
              milesTenths: tenths,
              purpose: trip.purpose,
              fromPlace: trip.fromPlace,
              toPlace: trip.toPlace
            })
            if (!r.ok) return onMsg({ text: r.error, bad: true })
            if (r.value.year === year) setReport(r.value)
            setTrip({ ...trip, miles: '', purpose: '' })
            onMsg({ text: 'Trip added.', bad: false })
          }}
        >
          Add trip
        </button>
      </div>
      {report && (
        <>
          <h3>Mileage for {year}</h3>
          <div className="form-row">
            <label className="narrow">
              Standard rate (¢/mile)
              <input
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                aria-label="Mileage rate"
              />
            </label>
            <button
              type="button"
              className="align-end"
              onClick={async () => {
                const t = rate.trim()
                const tenth = t ? Math.round(Number(t) * 10) : null
                if (t && (!Number.isFinite(Number(t)) || Number(t) < 0))
                  return onMsg({ text: 'Enter the rate in cents, e.g. 70.', bad: true })
                const r = await window.juno.setMileageRate(year, tenth)
                if (!r.ok) return onMsg({ text: r.error, bad: true })
                setReport(r.value)
                onMsg({ text: 'Rate saved.', bad: false })
              }}
            >
              Save rate
            </button>
          </div>
          <p className="mileage-total">
            {formatMiles(report.totalTenths)} business miles
            {report.amountCents !== null &&
              ` × ${(report.rateTenthCents! / 10).toFixed(1)}¢ = ${formatCents(report.amountCents)}`}
          </p>
          <div className="report-actions">
            <CsvButtons
              name={`Mileage ${year}`}
              onMsg={onMsg}
              rows={() => [
                ['Mileage log', String(year)],
                ['Date', 'Miles', 'Purpose', 'From', 'To'],
                ...report.trips.map((t) => [t.date, formatMiles(t.milesTenths), t.purpose, t.fromPlace, t.toPlace]),
                ['Total', formatMiles(report.totalTenths)]
              ]}
            />
          </div>
          <table className="chart-table">
            <tbody>
              {report.trips.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td className="amount">{formatMiles(t.milesTenths)}</td>
                  <td>
                    {t.purpose}
                    {(t.fromPlace || t.toPlace) && (
                      <div className="account-description">{[t.fromPlace, t.toPlace].filter(Boolean).join(' → ')}</div>
                    )}
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={async () => {
                        const r = await window.juno.removeTrip(t.id, year)
                        if (r.ok) setReport(r.value)
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="accountant-note">
            <span aria-hidden="true">⚑ </span>
            Check with your accountant: type the IRS standard mileage rate for {year}; they decide between the standard
            rate and actual vehicle costs.
          </p>
        </>
      )}
    </>
  )
}

function Office({ year, onMsg }: { year: number; onMsg: (m: Msg) => void }): JSX.Element {
  const fields: [keyof HomeOffice, string][] = [
    ['rentCents', 'Rent'],
    ['mortgageInterestCents', 'Mortgage interest'],
    ['propertyTaxCents', 'Property tax'],
    ['utilitiesCents', 'Utilities'],
    ['insuranceCents', "Renter's or homeowner's insurance"],
    ['repairsCents', 'Repairs to the whole home'],
    ['otherCents', 'Other home expenses']
  ]
  const [summary, setSummary] = useState<HomeOfficeSummary | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  useEffect(() => {
    window.juno.homeOffice(year).then((r) => {
      if (!r.ok) return
      setSummary(r.value)
      const d = r.value.details
      setForm({
        officeSqft: d ? String(d.officeSqft) : '',
        homeSqft: d ? String(d.homeSqft) : '',
        notes: d?.notes ?? '',
        ...Object.fromEntries(fields.map(([k]) => [k, d ? ((d[k] as number) / 100).toFixed(2) : '']))
      })
    })
  }, [year])
  return (
    <>
      <p className="hint">
        If you use part of your home only and regularly for the business, enter the areas and the year&rsquo;s home
        expenses. JunoBooks shows both the simplified method and the regular (percentage) method for your accountant.
      </p>
      <div className="form-row">
        <label className="narrow">
          Office sq ft
          <input
            inputMode="numeric"
            value={form.officeSqft ?? ''}
            onChange={(e) => setForm({ ...form, officeSqft: e.target.value })}
            aria-label="Office square feet"
          />
        </label>
        <label className="narrow">
          Whole home sq ft
          <input
            inputMode="numeric"
            value={form.homeSqft ?? ''}
            onChange={(e) => setForm({ ...form, homeSqft: e.target.value })}
            aria-label="Home square feet"
          />
        </label>
      </div>
      <div className="office-grid">
        {fields.map(([k, label]) => (
          <label key={k}>
            {label}
            <input
              inputMode="decimal"
              value={form[k] ?? ''}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              aria-label={label}
            />
          </label>
        ))}
      </div>
      <label>
        Notes
        <input
          value={form.notes ?? ''}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          aria-label="Home office notes"
        />
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const money: Record<string, number> = {}
            for (const [k, label] of fields) {
              const c = (form[k] ?? '').trim() ? parseMoney(form[k]) : 0
              if (c === null) return onMsg({ text: `${label} isn't an amount.`, bad: true })
              money[k] = c
            }
            const r = await window.juno.saveHomeOffice({
              year,
              officeSqft: Number(form.officeSqft || 0),
              homeSqft: Number(form.homeSqft || 0),
              notes: form.notes ?? '',
              ...(money as Pick<HomeOffice, 'rentCents'>)
            } as HomeOffice)
            if (!r.ok) return onMsg({ text: r.error, bad: true })
            setSummary(r.value)
            onMsg({ text: 'Home office saved.', bad: false })
          }}
        >
          Save home office
        </button>
      </div>
      {summary?.details && (
        <div className="office-summary">
          <p>
            Office share of the home: <strong>{(summary.percentBp / 100).toFixed(2)}%</strong>
          </p>
          <p>
            Simplified method ($5 per sq ft, up to 300 sq ft): <strong>{formatCents(summary.simplifiedCents)}</strong>
          </p>
          <p>
            Regular method (office share of the home expenses): <strong>{formatCents(summary.regularCents)}</strong>
          </p>
          <p className="accountant-note">
            <span aria-hidden="true">⚑ </span>
            Check with your accountant: they choose the method and apply the limits (the deduction can&rsquo;t create a
            loss, and depreciation applies for owned homes).
          </p>
        </div>
      )}
    </>
  )
}

export default YearEndRecords
