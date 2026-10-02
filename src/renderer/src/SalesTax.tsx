import { useEffect, useState } from 'react'
import type { ChartAccount, SalesTaxRate, SalesTaxReport } from '../../preload/types'
import { importAccountGroups } from '../../shared/bankImport'
import { localDateString } from '../../shared/dates'
import { formatCents, parseMoney } from '../../shared/money'
import { formatRate, parseRate } from '../../shared/sales'
import { quarters } from '../../shared/salesTax'
import { US_STATES } from '../../shared/states'
import AccountCombobox from './AccountCombobox'

interface Props {
  homeState: string
  firstYear: number
  onChanged: () => void
  onClose: () => void
}

type Msg = { text: string; bad: boolean } | null

/** Sales tax: the report for a period (for the CDTFA return) and the dated rates. */
function SalesTax({ homeState, firstYear, onChanged, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<'report' | 'rates'>('report')
  return (
    <section className="panel journal-entry sales-tax">
      <div className="chart-header">
        <h2>Sales tax</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="tabs">
        <button type="button" className={tab === 'report' ? 'tab active' : 'tab'} onClick={() => setTab('report')}>
          Report
        </button>
        <button type="button" className={tab === 'rates' ? 'tab active' : 'tab'} onClick={() => setTab('rates')}>
          Rates
        </button>
      </div>
      {tab === 'report' ? <Report firstYear={firstYear} onChanged={onChanged} /> : <Rates homeState={homeState} />}
    </section>
  )
}

function Report({ firstYear, onChanged }: { firstYear: number; onChanged: () => void }): JSX.Element {
  const today = localDateString()
  const thisYear = Number(today.slice(0, 4))
  const years = Array.from({ length: Math.max(1, thisYear - firstYear + 1) }, (_, i) => thisYear - i)
  const current = quarters(thisYear).find((q) => q.from <= today && today <= q.to) ?? quarters(thisYear)[0]
  const [period, setPeriod] = useState({ from: current.from, to: current.to })
  const [year, setYear] = useState(thisYear)
  const [report, setReport] = useState<SalesTaxReport | null>(null)
  const [accounts, setAccounts] = useState<ChartAccount[]>([])
  const [pay, setPay] = useState<{ date: string; amount: string; bankId: number | null; memo: string } | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  async function load(): Promise<void> {
    const r = await window.juno.salesTaxReport(period.from, period.to)
    if (r.ok) {
      setReport(r.value)
      setMsg(null)
    } else setMsg({ text: r.error, bad: true })
  }

  useEffect(() => {
    void load()
  }, [period])

  useEffect(() => {
    window.juno.getChart().then((c) => setAccounts(c ? c.accounts : []))
  }, [])

  const line = (label: string, cents: number, minus = false, hint?: string): JSX.Element => (
    <tr>
      <td>
        {label}
        {hint && <div className="account-description">{hint}</div>}
      </td>
      <td className="amount">{minus ? `−${formatCents(cents)}` : formatCents(cents)}</td>
    </tr>
  )

  return (
    <div className="form sales-tax-tab">
      <div className="form-row period-row">
        <label className="narrow">
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Sales tax year">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <div className="quarter-buttons">
          {quarters(year).map((q) => (
            <button
              key={q.label}
              type="button"
              className={period.from === q.from && period.to === q.to ? 'tab active' : 'tab'}
              onClick={() => setPeriod({ from: q.from, to: q.to })}
            >
              {q.label.slice(0, 2)}
            </button>
          ))}
        </div>
        <label className="narrow-date">
          From
          <input
            type="date"
            value={period.from}
            onChange={(e) => setPeriod({ ...period, from: e.target.value })}
            aria-label="Report from"
          />
        </label>
        <label className="narrow-date">
          To
          <input
            type="date"
            value={period.to}
            onChange={(e) => setPeriod({ ...period, to: e.target.value })}
            aria-label="Report to"
          />
        </label>
      </div>
      {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}
      {report && (
        <>
          <table className="chart-table tax-report">
            <tbody>
              {line(
                'Total sales',
                report.grossSalesCents,
                false,
                'All sales income in your books for the period, including shipping you charged.'
              )}
              {line(
                'Sales through marketplaces',
                report.marketplaceCents,
                true,
                `${report.marketplaceByChannel.map((m) => `${m.channel === 'etsy' ? 'Etsy' : 'Amazon'} ${formatCents(m.cents)}`).join(', ') || 'None'}. The marketplace collected and paid the tax.`
              )}
              {line(
                'Sales for resale',
                report.resaleCents,
                true,
                `${report.resale.length} invoice(s) with a valid resale certificate (listed below).`
              )}
              {report.otherExemptCents !== 0 &&
                line(
                  'Other sales marked tax-exempt',
                  report.otherExemptCents,
                  true,
                  'No valid resale certificate on file; check these (listed below).'
                )}
              {line('Refunds and returns', report.refundsCents, true, 'Outside the marketplaces.')}
              <tr className="total-row">
                <th>Taxable sales</th>
                <th className="amount">{formatCents(report.taxableCents)}</th>
              </tr>
              {line(
                'Tax at the rates in force',
                report.computedTaxCents,
                false,
                report.months
                  .map(
                    (m) =>
                      `${m.month}: ${formatCents(m.taxableCents)} at ${m.rateMilli === null ? 'no rate' : formatRate(m.rateMilli)}`
                  )
                  .join(' · ')
              )}
              {line('Sales tax you charged (in your books)', report.chargedCents)}
              <tr>
                <td>Difference (rate − charged)</td>
                <td className={report.computedTaxCents - report.chargedCents ? 'amount warn' : 'amount'}>
                  {formatCents(report.computedTaxCents - report.chargedCents)}
                </td>
              </tr>
              {line('Sales tax payments recorded in this period', report.paidCents)}
              {line(`Sales tax payable on ${report.to}`, report.owedAtEndCents)}
            </tbody>
          </table>
          {report.missingRate && (
            <p className="error">
              Some months have taxable sales but no rate for {report.homeState}. Add the rate on the Rates tab.
            </p>
          )}
          <p className="accountant-note">
            <span aria-hidden="true">⚑ </span>
            Check with your accountant: these figures are for your California sales and use tax return (CDTFA). Which
            return lines they go on, district taxes for sales delivered elsewhere in the state, whether shipping is
            taxable for your sales, and sales shipped out of state are their call. A difference between the tax at the
            rate and the tax you charged usually means a sale was entered without tax (or at another rate).
          </p>

          {report.resale.length > 0 && (
            <>
              <h3>Sales for resale</h3>
              <table className="chart-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Certificate</th>
                    <th className="amount">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {report.resale.map((r) => (
                    <tr key={r.invoiceId}>
                      <td>{r.number}</td>
                      <td>{r.date}</td>
                      <td>{r.customerName}</td>
                      <td>{r.certificate}</td>
                      <td className="amount">{formatCents(r.subtotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {report.otherExempt.length > 0 && (
            <>
              <h3>Marked exempt without a valid certificate</h3>
              <table className="chart-table">
                <tbody>
                  {report.otherExempt.map((r) => (
                    <tr key={r.invoiceId}>
                      <td>{r.number}</td>
                      <td>{r.date}</td>
                      <td>{r.customerName}</td>
                      <td className="amount">{formatCents(r.subtotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3>Pay sales tax</h3>
          {!pay ? (
            <button
              type="button"
              onClick={() =>
                setPay({
                  date: today,
                  amount: report.owedAtEndCents > 0 ? (report.owedAtEndCents / 100).toFixed(2) : '',
                  bankId: accounts.find((a) => a.subtype === 'bank' && a.isActive)?.id ?? null,
                  memo: `Sales tax ${period.from} to ${period.to}`
                })
              }
            >
              Record a sales tax payment…
            </button>
          ) : (
            <div className="form">
              <div className="form-row">
                <label className="narrow-date">
                  Date paid
                  <input
                    type="date"
                    value={pay.date}
                    onChange={(e) => setPay({ ...pay, date: e.target.value })}
                    aria-label="Tax payment date"
                  />
                </label>
                <label className="narrow">
                  Amount
                  <input
                    inputMode="decimal"
                    value={pay.amount}
                    onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                    aria-label="Tax payment amount"
                  />
                </label>
                <label className="grow">
                  Paid from
                  <AccountCombobox
                    groups={importAccountGroups(accounts)}
                    value={pay.bankId}
                    onChange={(id) => setPay({ ...pay, bankId: id })}
                    label="Tax paid from"
                  />
                </label>
              </div>
              <label>
                Memo
                <input
                  value={pay.memo}
                  onChange={(e) => setPay({ ...pay, memo: e.target.value })}
                  aria-label="Tax payment memo"
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    const cents = parseMoney(pay.amount)
                    if (cents === null) return setMsg({ text: 'Enter the amount paid.', bad: true })
                    const r = await window.juno.recordSalesTaxPayment({
                      date: pay.date,
                      amountCents: cents,
                      bankAccountId: pay.bankId,
                      memo: pay.memo
                    })
                    if (!r.ok) return setMsg({ text: r.error, bad: true })
                    setPay(null)
                    await load()
                    setMsg({ text: `Sales tax payment recorded (entry #${r.value}).`, bad: false })
                    onChanged()
                  }}
                >
                  Record payment
                </button>
                <button type="button" onClick={() => setPay(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Rates({ homeState }: { homeState: string }): JSX.Element {
  const [rates, setRates] = useState<SalesTaxRate[]>([])
  const [form, setForm] = useState({
    stateCode: homeState,
    place: '',
    rate: '',
    effectiveDate: localDateString(),
    notes: ''
  })
  const [msg, setMsg] = useState<Msg>(null)
  useEffect(() => {
    window.juno.salesTaxRates().then((r) => r.ok && setRates(r.value))
  }, [])
  return (
    <div className="form sales-tax-tab">
      <p className="hint">
        Add each rate with the date it starts. When a rate changes, add the new one with its start date; earlier sales
        keep the rate that applied on their date. New invoices start with the rate in force for your home state on the
        invoice date (you can still change it on the invoice).
      </p>
      <div className="form-row">
        <label className="narrow">
          State
          <select
            value={form.stateCode}
            onChange={(e) => setForm({ ...form, stateCode: e.target.value })}
            aria-label="Rate state"
          >
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Place (optional)
          <input
            value={form.place}
            onChange={(e) => setForm({ ...form, place: e.target.value })}
            placeholder="e.g. San Diego"
            aria-label="Rate place"
          />
        </label>
        <label className="narrow">
          Rate %
          <input
            inputMode="decimal"
            value={form.rate}
            onChange={(e) => setForm({ ...form, rate: e.target.value })}
            placeholder="7.75"
            aria-label="Rate percent"
          />
        </label>
        <label className="narrow-date">
          Starts on
          <input
            type="date"
            value={form.effectiveDate}
            onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
            aria-label="Rate starts on"
          />
        </label>
      </div>
      <label>
        Notes (optional)
        <input
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          aria-label="Rate notes"
        />
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const rateMilli = parseRate(form.rate)
            if (rateMilli === null || !form.rate.trim())
              return setMsg({ text: 'Enter the rate as a percent, e.g. 7.75.', bad: true })
            const r = await window.juno.addSalesTaxRate({
              stateCode: form.stateCode,
              place: form.place,
              rateMilli,
              effectiveDate: form.effectiveDate,
              notes: form.notes
            })
            if (!r.ok) return setMsg({ text: r.error, bad: true })
            setRates(r.value)
            setForm({ ...form, rate: '', notes: '' })
            setMsg({ text: 'Rate added.', bad: false })
          }}
        >
          Add rate
        </button>
      </div>
      {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}
      {rates.length === 0 ? (
        <p className="muted">
          No rates yet. California&rsquo;s rate depends on where the sale happens; look up yours on the CDTFA website
          and add it here.
        </p>
      ) : (
        <table className="chart-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Place</th>
              <th className="amount">Rate</th>
              <th>Starts on</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td>{r.stateCode}</td>
                <td>{r.place}</td>
                <td className="amount">{formatRate(r.rateMilli)}</td>
                <td>{r.effectiveDate}</td>
                <td>{r.notes}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="link-button"
                    onClick={async () => {
                      const res = await window.juno.removeSalesTaxRate(r.id)
                      if (res.ok) setRates(res.value)
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default SalesTax
