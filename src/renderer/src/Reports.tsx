import { useEffect, useState, type ReactNode } from 'react'
import type { BalanceSheet, GeneralLedger, ProfitAndLoss, TrialBalance } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { formatCents } from '../../shared/money'
import { plainCents, type ReportSection } from '../../shared/reports'
import ExtraReports, { type ExtraTab, EXTRA_TABS } from './ReportsExtra'
import { CsvButtons, PeriodPicker } from './ReportBits'

interface Props {
  firstYear: number
  onClose: () => void
}

type Tab = 'pl' | 'bs' | 'tb' | 'gl' | ExtraTab
type Msg = { text: string; bad: boolean } | null

const TABS: { id: Tab; label: string }[] = [
  { id: 'pl', label: 'Profit & loss' },
  { id: 'bs', label: 'Balance sheet' },
  { id: 'tb', label: 'Trial balance' },
  { id: 'gl', label: 'General ledger' },
  ...EXTRA_TABS
]

function Money({ c, strong = false }: { c: number; strong?: boolean }): JSX.Element {
  const text = formatCents(c)
  return <td className={c < 0 ? 'amount unusual' : 'amount'}>{strong ? <strong>{text}</strong> : text}</td>
}

function SectionRows({ s, cols }: { s: ReportSection; cols: number }): JSX.Element {
  return (
    <>
      <tr className="group-row">
        <th colSpan={cols + 1}>{s.title}</th>
      </tr>
      {s.rows.length === 0 && (
        <tr>
          <td colSpan={cols + 1} className="muted">
            Nothing in this period.
          </td>
        </tr>
      )}
      {s.rows.map((r) => (
        <tr
          key={`${r.accountId}${r.subtotal ? '-total' : ''}`}
          className={r.subtotal ? 'parent-total' : r.depth ? 'sub-account' : ''}
        >
          <td style={{ paddingLeft: `${0.4 + r.depth * 1.4}rem` }}>{r.subtotal ? r.name : `${r.number} ${r.name}`}</td>
          {r.values.map((v, i) => (
            <Money key={i} c={v} />
          ))}
        </tr>
      ))}
      <tr className="subtotal-row">
        <td>Total {s.title.toLowerCase()}</td>
        {s.total.map((v, i) => (
          <Money key={i} c={v} strong />
        ))}
      </tr>
    </>
  )
}

const sectionCsv = (s: ReportSection): (string | number)[][] => [
  [s.title],
  ...s.rows.map((r) => [
    r.subtotal ? r.name : `${'  '.repeat(r.depth)}${r.number} ${r.name}`,
    ...r.values.map(plainCents)
  ]),
  [`Total ${s.title.toLowerCase()}`, ...s.total.map(plainCents)]
]

/** Profit & loss, balance sheet, trial balance, general ledger, and the year-end detail reports. */
function Reports({ firstYear, onClose }: Props): JSX.Element {
  const today = localDateString()
  const [tab, setTab] = useState<Tab>('pl')
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const [byMonth, setByMonth] = useState(false)
  const [pl, setPl] = useState<ProfitAndLoss | null>(null)
  const [bs, setBs] = useState<BalanceSheet | null>(null)
  const [tb, setTb] = useState<TrialBalance | null>(null)
  const [gl, setGl] = useState<GeneralLedger | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  useEffect(() => {
    setMsg(null)
    const done =
      <T,>(set: (v: T) => void) =>
      (r: { ok: true; value: T } | { ok: false; error: string }) =>
        r.ok ? set(r.value) : setMsg({ text: r.error, bad: true })
    if (tab === 'pl') window.juno.profitAndLoss(from, to, byMonth).then(done(setPl))
    if (tab === 'bs') window.juno.balanceSheet(to).then(done(setBs))
    if (tab === 'tb') window.juno.trialBalance(to).then(done(setTb))
    if (tab === 'gl') window.juno.generalLedger(from, to).then(done(setGl))
  }, [tab, from, to, byMonth])

  const period = (single = false): ReactNode => (
    <PeriodPicker
      firstYear={firstYear}
      from={from}
      to={to}
      single={single}
      onChange={(f, t) => {
        setFrom(f)
        setTo(t)
      }}
    />
  )

  let body: ReactNode = null
  if (tab === 'pl' && pl) {
    const cols = pl.columns.length
    body = (
      <>
        {period()}
        <label className="toggle">
          <input type="checkbox" checked={byMonth} onChange={(e) => setByMonth(e.target.checked)} />
          Show each month
        </label>
        <div className="report-actions">
          <CsvButtons
            name={`Profit and loss ${pl.from} to ${pl.to}`}
            onMsg={setMsg}
            rows={() => [
              ['Profit and loss', `${pl.from} to ${pl.to}`],
              ['Account', ...pl.columns],
              ...sectionCsv(pl.income),
              ...sectionCsv(pl.cogs),
              ['Gross profit', ...pl.grossProfit.map(plainCents)],
              ...sectionCsv(pl.expenses),
              ['Net income', ...pl.netIncome.map(plainCents)]
            ]}
          />
        </div>
        <div className="report-scroll">
          <table className="chart-table report-table">
            <thead>
              <tr>
                <th>Account</th>
                {pl.columns.map((c) => (
                  <th key={c} className="amount">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <SectionRows s={pl.income} cols={cols} />
              <SectionRows s={pl.cogs} cols={cols} />
              <tr className="total-row">
                <td>Gross profit</td>
                {pl.grossProfit.map((v, i) => (
                  <Money key={i} c={v} strong />
                ))}
              </tr>
              <SectionRows s={pl.expenses} cols={cols} />
              <tr className="total-row">
                <td>Net income</td>
                {pl.netIncome.map((v, i) => (
                  <Money key={i} c={v} strong />
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </>
    )
  } else if (tab === 'bs' && bs) {
    body = (
      <>
        {period(true)}
        <div className="report-actions">
          <CsvButtons
            name={`Balance sheet ${bs.asOf}`}
            onMsg={setMsg}
            rows={() => [
              ['Balance sheet', bs.asOf],
              ...sectionCsv(bs.assets),
              ...sectionCsv(bs.liabilities),
              ...sectionCsv(bs.equity),
              ['Profit this year (not yet closed)', plainCents(bs.currentYearProfit)],
              ['Profit from earlier years (not yet closed)', plainCents(bs.priorYearsProfit)],
              ['Total liabilities and equity', plainCents(bs.totalLiabilitiesAndEquity)]
            ]}
          />
        </div>
        <table className="chart-table report-table">
          <tbody>
            <SectionRows s={bs.assets} cols={1} />
            <SectionRows s={bs.liabilities} cols={1} />
            <SectionRows s={bs.equity} cols={1} />
            <tr>
              <td>Profit this year (not yet closed into equity)</td>
              <Money c={bs.currentYearProfit} />
            </tr>
            {bs.priorYearsProfit !== 0 && (
              <tr>
                <td>Profit from earlier years (not yet closed into equity)</td>
                <Money c={bs.priorYearsProfit} />
              </tr>
            )}
            <tr className="total-row">
              <td>Total liabilities and equity</td>
              <Money c={bs.totalLiabilitiesAndEquity} strong />
            </tr>
          </tbody>
        </table>
        <p className={bs.balanced ? 'success' : 'error'}>
          {bs.balanced
            ? `Balanced: assets ${formatCents(bs.assets.total[0])} = liabilities and equity.`
            : 'Out of balance: please report this, it should never happen.'}
        </p>
      </>
    )
  } else if (tab === 'tb' && tb) {
    body = (
      <>
        {period(true)}
        <div className="report-actions">
          <CsvButtons
            name={`Trial balance ${tb.asOf}`}
            onMsg={setMsg}
            rows={() => [
              ['Trial balance', tb.asOf],
              ['Number', 'Account', 'Debit', 'Credit'],
              ...tb.rows.map((r) => [
                r.number,
                r.name,
                r.debit ? plainCents(r.debit) : '',
                r.credit ? plainCents(r.credit) : ''
              ]),
              ['', 'Total', plainCents(tb.totalDebit), plainCents(tb.totalCredit)]
            ]}
          />
        </div>
        <table className="chart-table report-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="amount">Debit</th>
              <th className="amount">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.accountId}>
                <td>
                  {r.number} {r.name}
                </td>
                <td className="amount">{r.debit ? formatCents(r.debit) : ''}</td>
                <td className="amount">{r.credit ? formatCents(r.credit) : ''}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td>Total</td>
              <Money c={tb.totalDebit} strong />
              <Money c={tb.totalCredit} strong />
            </tr>
          </tbody>
        </table>
      </>
    )
  } else if (tab === 'gl' && gl) {
    body = (
      <>
        {period()}
        <div className="report-actions">
          <CsvButtons
            name={`General ledger ${gl.from} to ${gl.to}`}
            onMsg={setMsg}
            rows={() => [
              ['General ledger', `${gl.from} to ${gl.to}`],
              ['Account', 'Date', 'Entry', 'Description', 'Other side', 'Debit', 'Credit', 'Balance'],
              ...gl.accounts.flatMap((a) => [
                [`${a.number} ${a.name}`, gl.from, '', 'Opening balance', '', '', '', plainCents(a.opening)],
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
                [`${a.number} ${a.name}`, gl.to, '', 'Closing balance', '', '', '', plainCents(a.closing)]
              ])
            ]}
          />
        </div>
        {gl.accounts.length === 0 && <p className="muted">No activity in this period.</p>}
        {gl.accounts.map((a) => (
          <div key={a.accountId} className="gl-account">
            <h4>
              {a.number} {a.name}
            </h4>
            <table className="chart-table report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">#</th>
                  <th>Description</th>
                  <th>Other side</th>
                  <th className="amount">Debit</th>
                  <th className="amount">Credit</th>
                  <th className="amount">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="muted">
                  <td colSpan={6}>Opening balance</td>
                  <Money c={a.opening} />
                </tr>
                {a.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.date}</td>
                    <td className="num">{l.entryId}</td>
                    <td>{l.memo}</td>
                    <td>{l.otherSide}</td>
                    <td className="amount">{l.debit ? formatCents(l.debit) : ''}</td>
                    <td className="amount">{l.credit ? formatCents(l.credit) : ''}</td>
                    <Money c={l.balance} />
                  </tr>
                ))}
                <tr className="subtotal-row">
                  <td colSpan={6}>Closing balance</td>
                  <Money c={a.closing} strong />
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </>
    )
  } else if (EXTRA_TABS.some((t) => t.id === tab)) {
    body = <ExtraReports tab={tab as ExtraTab} firstYear={firstYear} onMsg={setMsg} />
  }

  return (
    <section className="panel journal-entry reports">
      <div className="chart-header">
        <h2>Reports</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="tabs report-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}
      <div className="form report-body">{body}</div>
    </section>
  )
}

export default Reports
