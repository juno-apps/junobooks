import { useEffect, useState, type ReactNode } from 'react'
import type { ChannelSales, CogsSchedule, InventoryYearReport, TaxLineSummary } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { methodLabel } from '../../shared/inventory'
import { formatCents } from '../../shared/money'
import { plainCents } from '../../shared/reports'
import { CsvButtons, PeriodPicker, type Msg } from './ReportBits'

/** Year-end detail reports, shown as extra tabs on the Reports screen. */
export type ExtraTab = 'channels' | 'taxlines' | 'cogs' | 'inventory'

export const EXTRA_TABS: { id: ExtraTab; label: string }[] = [
  { id: 'channels', label: 'Sales by channel' },
  { id: 'taxlines', label: 'Tax-line summary' },
  { id: 'cogs', label: 'Cost of goods sold' },
  { id: 'inventory', label: 'Inventory methods' }
]

function YearPicker({
  firstYear,
  year,
  onChange
}: {
  firstYear: number
  year: number
  onChange: (y: number) => void
}): JSX.Element {
  const thisYear = Number(localDateString().slice(0, 4))
  const years = Array.from({ length: Math.max(1, thisYear - firstYear + 1) }, (_, i) => thisYear - i)
  return (
    <label className="narrow">
      Year
      <select value={year} onChange={(e) => onChange(Number(e.target.value))} aria-label="Report year">
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  )
}

function ExtraReports({
  tab,
  firstYear,
  onMsg
}: {
  tab: ExtraTab
  firstYear: number
  onMsg: (m: Msg) => void
}): JSX.Element {
  const today = localDateString()
  const thisYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(Math.max(firstYear, thisYear))
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const [channels, setChannels] = useState<ChannelSales | null>(null)
  const [lines, setLines] = useState<TaxLineSummary | null>(null)
  const [cogs, setCogs] = useState<CogsSchedule | null>(null)
  const [inv, setInv] = useState<InventoryYearReport | null>(null)

  useEffect(() => {
    const done =
      <T,>(set: (v: T) => void) =>
      (r: { ok: true; value: T } | { ok: false; error: string }) =>
        r.ok ? set(r.value) : onMsg({ text: r.error, bad: true })
    if (tab === 'channels') window.juno.salesByChannel(from, to).then(done(setChannels))
    if (tab === 'taxlines') window.juno.taxLineSummary(year).then(done(setLines))
    if (tab === 'cogs') window.juno.cogsSchedule(year).then(done(setCogs))
    if (tab === 'inventory') window.juno.inventoryYear(year).then(done(setInv))
  }, [tab, year, from, to])

  const yearPicker = <YearPicker firstYear={firstYear} year={year} onChange={setYear} />
  let body: ReactNode = null

  if (tab === 'channels' && channels) {
    body = (
      <>
        <PeriodPicker
          firstYear={firstYear}
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f)
            setTo(t)
          }}
        />
        <div className="report-actions">
          <CsvButtons
            name={`Sales by channel ${channels.from} to ${channels.to}`}
            onMsg={onMsg}
            rows={() => [
              ['Sales by channel', `${channels.from} to ${channels.to}`],
              ['Channel', 'Sales', 'Refunds', 'Net'],
              ...channels.channels.map((c) => [
                c.name,
                plainCents(c.salesCents),
                plainCents(c.refundsCents),
                plainCents(c.netCents)
              ]),
              [
                'Total',
                plainCents(channels.totalSalesCents),
                plainCents(channels.totalRefundsCents),
                plainCents(channels.totalNetCents)
              ]
            ]}
          />
        </div>
        <table className="chart-table report-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th className="amount">Sales</th>
              <th className="amount">Refunds</th>
              <th className="amount">Net</th>
            </tr>
          </thead>
          <tbody>
            {channels.channels.map((c) => (
              <tr key={c.source}>
                <td>{c.name}</td>
                <td className="amount">{formatCents(c.salesCents)}</td>
                <td className="amount">{formatCents(c.refundsCents)}</td>
                <td className="amount">{formatCents(c.netCents)}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td>Total</td>
              <td className="amount">{formatCents(channels.totalSalesCents)}</td>
              <td className="amount">{formatCents(channels.totalRefundsCents)}</td>
              <td className="amount">{formatCents(channels.totalNetCents)}</td>
            </tr>
          </tbody>
        </table>
        <p className="hint">Sales include shipping charged. Refunds include promotions given on marketplaces.</p>
      </>
    )
  } else if (tab === 'taxlines' && lines) {
    const part = (p: 'income' | 'balance'): JSX.Element[] =>
      lines.lines
        .filter((l) => l.part === p)
        .map((l, i) => (
          <tbody key={`${p}-${i}`}>
            <tr className="taxline-row">
              <td>
                <strong>{l.ref ?? 'Not on this form'}</strong> {l.label}
              </td>
              <td className="amount">
                <strong>{formatCents(l.cents)}</strong>
              </td>
            </tr>
            {l.accounts.map((a) => (
              <tr key={a.accountId} className="sub-account">
                <td style={{ paddingLeft: '1.8rem' }}>
                  {a.number} {a.name}
                  {a.note && <div className="accountant-note small-note">⚑ {a.note}</div>}
                </td>
                <td className="amount">{formatCents(a.cents)}</td>
              </tr>
            ))}
          </tbody>
        ))
    body = (
      <>
        <div className="form-row">{yearPicker}</div>
        <p className="hint">
          {lines.formLabel}, line numbers from the {lines.tableYear} IRS forms. Income and expenses are for {lines.year}
          ; balance-sheet lines are as of {lines.year}-12-31.
        </p>
        <div className="report-actions">
          <CsvButtons
            name={`Tax-line summary ${lines.year}`}
            onMsg={onMsg}
            rows={() => [
              ['Tax-line summary', String(lines.year), lines.formLabel],
              ['Line', 'Description', 'Account', 'Amount', 'Note for accountant'],
              ...lines.lines.flatMap((l) => [
                [l.ref ?? '', l.label, '', plainCents(l.cents), ''],
                ...l.accounts.map((a) => ['', '', `${a.number} ${a.name}`, plainCents(a.cents), a.note])
              ]),
              ...lines.unmapped.map((u) => [
                'NOT MAPPED',
                '',
                `${u.number} ${u.name}`,
                plainCents(u.cents),
                'Choose a tax category'
              ])
            ]}
          />
        </div>
        <h3>Income and expenses</h3>
        <table className="chart-table report-table">{part('income')}</table>
        <h3>Balance sheet (year end)</h3>
        <table className="chart-table report-table">{part('balance')}</table>
        {lines.unmapped.length > 0 && (
          <p className="error">
            Not mapped to a tax line:{' '}
            {lines.unmapped.map((u) => `${u.number} ${u.name} (${formatCents(u.cents)})`).join(', ')}. Choose a tax
            category for these on the chart of accounts.
          </p>
        )}
        <p className="accountant-note">
          <span aria-hidden="true">⚑ </span>
          Check with your accountant: this is a starting point for the return, grouped by the line each account normally
          goes on. Your accountant decides the final figures.
        </p>
      </>
    )
  } else if (tab === 'cogs' && cogs) {
    const row = (label: string, c: number, strong = false): JSX.Element => (
      <tr className={strong ? 'total-row' : ''}>
        <td>{label}</td>
        <td className="amount">{formatCents(c)}</td>
      </tr>
    )
    body = (
      <>
        <div className="form-row">{yearPicker}</div>
        <div className="report-actions">
          <CsvButtons
            name={`Cost of goods sold ${cogs.year}`}
            onMsg={onMsg}
            rows={() => [
              ['Cost of goods sold', String(cogs.year)],
              ['Beginning inventory', plainCents(cogs.beginningCents)],
              ['Purchases', plainCents(cogs.purchasesCents)],
              ['Cost of labor', plainCents(cogs.laborCents)],
              ['Materials and supplies', plainCents(cogs.materialsCents)],
              ['Other costs', plainCents(cogs.otherCents)],
              ['Subtotal', plainCents(cogs.subtotalCents)],
              ['Ending inventory', plainCents(cogs.endingCents)],
              ['Cost of goods sold', plainCents(cogs.cogsCents)]
            ]}
          />
        </div>
        <table className="chart-table report-table cogs-table">
          <tbody>
            {row('Inventory at the beginning of the year', cogs.beginningCents)}
            {row('Purchases (merchandise, and stock bought into inventory)', cogs.purchasesCents)}
            {row('Cost of labor', cogs.laborCents)}
            {row('Materials and supplies', cogs.materialsCents)}
            {row('Other costs (packaging, outside services…)', cogs.otherCents)}
            {row('Subtotal', cogs.subtotalCents, true)}
            {row('Inventory at the end of the year', cogs.endingCents)}
            {row('Cost of goods sold', cogs.cogsCents, true)}
          </tbody>
        </table>
        <p className={cogs.yearEndEntryPosted ? 'hint' : 'accountant-note'}>
          {cogs.filedMethod
            ? `Filed inventory method for ${cogs.year}: ${cogs.filedMethod}.`
            : `No filed inventory method chosen for ${cogs.year} (Inventory → Methods and year end).`}{' '}
          {cogs.yearEndEntryPosted
            ? 'The year-end inventory entry is posted, so the ending inventory is the method’s value.'
            : 'The year-end inventory entry isn’t posted yet, so the ending inventory is whatever the inventory accounts hold.'}
        </p>
      </>
    )
  } else if (tab === 'inventory' && inv) {
    body = (
      <>
        <div className="form-row">{yearPicker}</div>
        <div className="report-actions">
          <CsvButtons
            name={`Inventory methods ${inv.year}`}
            onMsg={onMsg}
            rows={() => [
              [
                'Inventory method comparison',
                String(inv.year),
                inv.filed ? `Filed: ${methodLabel(inv.filed)}` : 'Filed method not chosen'
              ],
              ['Method', 'Beginning inventory', 'Purchases', 'Ending inventory', 'Cost of goods sold'],
              ...inv.methods.map((m) => [
                methodLabel(m.method),
                plainCents(m.beginCents),
                plainCents(m.purchasesCents),
                plainCents(m.endCents),
                plainCents(m.cogsCents)
              ])
            ]}
          />
        </div>
        <table className="chart-table report-table">
          <thead>
            <tr>
              <th>Method</th>
              <th className="amount">Beginning</th>
              <th className="amount">Purchases</th>
              <th className="amount">Ending</th>
              <th className="amount">Cost of goods sold</th>
            </tr>
          </thead>
          <tbody>
            {inv.methods.map((m) => (
              <tr key={m.method} className={m.method === inv.filed ? 'filed-row' : ''}>
                <td>
                  {methodLabel(m.method)}
                  {m.method === inv.filed && <strong> · filed</strong>}
                </td>
                <td className="amount">{formatCents(m.beginCents)}</td>
                <td className="amount">{formatCents(m.purchasesCents)}</td>
                <td className="amount">{formatCents(m.endCents)}</td>
                <td className="amount">{formatCents(m.cogsCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {inv.notCounted.length > 0 && (
          <p className="accountant-note">
            Not counted on {inv.year}-12-31: {inv.notCounted.join(', ')}.
          </p>
        )}
        <p className="hint">
          The same purchases and counts, valued four ways. Only the filed method goes into the books.
        </p>
      </>
    )
  }
  return <>{body}</>
}

export default ExtraReports
