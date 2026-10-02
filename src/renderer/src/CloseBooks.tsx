import { useEffect, useState } from 'react'
import type { ChartAccount, ClosingView, YearCloseInfo } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { formatCents } from '../../shared/money'
import AccountCombobox from './AccountCombobox'

interface Props {
  firstYear: number
  onChanged: () => void
  onClose: () => void
}

type Msg = { text: string; bad: boolean } | null

const lastDayOf = (y: number, m: number): string => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

/** Close the books through a date (or reopen them), and close a finished year into equity. */
function CloseBooks({ firstYear, onChanged, onClose }: Props): JSX.Element {
  const today = localDateString()
  const [y, mo] = today.split('-').map(Number)
  const quickDates: [string, string][] = [
    ['End of last month', lastDayOf(y, mo - 1)],
    ['End of last quarter', lastDayOf(y, Math.floor((mo - 1) / 3) * 3)],
    ['End of last year', `${y - 1}-12-31`]
  ]
  const [view, setView] = useState<ClosingView | null>(null)
  const [date, setDate] = useState(quickDates[0][1])
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const endedYears = Array.from({ length: Math.max(0, y - firstYear) }, (_, i) => y - 1 - i)
  const [year, setYear] = useState<number | null>(endedYears[0] ?? null)
  const [info, setInfo] = useState<YearCloseInfo | null>(null)
  const [equityId, setEquityId] = useState<number | null>(null)
  const [accounts, setAccounts] = useState<ChartAccount[]>([])

  useEffect(() => {
    window.juno.closingView().then((r) => r.ok && setView(r.value))
    window.juno.getChart().then((c) => setAccounts(c ? c.accounts : []))
  }, [])

  useEffect(() => {
    if (year === null) return
    window.juno.yearCloseInfo(year).then((r) => {
      if (!r.ok) return setMsg({ text: r.error, bad: true })
      setInfo(r.value)
      setEquityId(r.value.defaultEquityAccountId)
    })
  }, [year, view])

  if (!view) return <p>Loading…</p>
  const reopening = view.lockedThrough !== null && date < view.lockedThrough
  const equityGroups = [
    {
      title: 'Equity',
      accounts: accounts.filter(
        (a) => a.isActive && a.type === 'equity' && a.subtype !== 'opening_balance' && a.subtype !== 'owner_draw'
      )
    }
  ]

  async function apply(d: string | null): Promise<void> {
    setMsg(null)
    const r = await window.juno.setBooksClosed(d, reason)
    if (!r.ok) return setMsg({ text: r.error, bad: true })
    setView(r.value)
    setReason('')
    setMsg({ text: d ? `Books closed through ${d}.` : 'All periods reopened.', bad: false })
    onChanged()
  }

  return (
    <section className="panel journal-entry close-books">
      <div className="chart-header">
        <h2>Close books</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>

      <h3>Books closed through</h3>
      <p className="lock-status">
        {view.lockedThrough ? (
          <>
            Nothing dated on or before <strong>{view.lockedThrough}</strong> can be added, changed or voided.
          </>
        ) : (
          'Nothing is closed yet.'
        )}
      </p>
      <p className="hint">
        Close a period once it&rsquo;s finished and checked (for example after reconciling the bank statement or filing
        the sales tax return). Fixing a closed period later means reopening it, with a reason that is kept.
      </p>
      <div className="form">
        <div className="form-row period-row">
          <label className="narrow-date">
            Close through
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Close through" />
          </label>
          <div className="quick-periods">
            {quickDates.map(([label, d]) => (
              <button key={label} type="button" className="link-button" onClick={() => setDate(d)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {(reopening || view.lockedThrough) && (
          <label>
            Reason {reopening ? '(needed to reopen)' : '(only needed when reopening)'}
            <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for reopening" />
          </label>
        )}
        <div className="form-actions">
          <button type="button" className={reopening ? 'danger' : 'primary'} onClick={() => void apply(date)}>
            {reopening ? `Reopen back to ${date}` : `Close books through ${date}`}
          </button>
          {view.lockedThrough && (
            <button type="button" onClick={() => void apply(null)}>
              Reopen everything…
            </button>
          )}
        </div>
      </div>
      {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}

      <h3>Close a year</h3>
      {year === null ? (
        <p className="muted">
          The first year that can be closed is {firstYear}, once it has ended (after December 31, {firstYear}).
        </p>
      ) : (
        <div className="form">
          <label className="narrow">
            Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year to close">
              {endedYears.map((yy) => (
                <option key={yy} value={yy}>
                  {yy}
                </option>
              ))}
            </select>
          </label>
          {info && (
            <>
              <p>
                Net income for {info.year}: <strong>{formatCents(info.netIncomeCents)}</strong>.
                {info.existingEntryId && ` Already closed (entry #${info.existingEntryId}); closing again replaces it.`}
              </p>
              <p className="hint">
                Closing posts one entry dated {info.year}-12-31 that moves the year&rsquo;s income and expenses into the
                equity account below, then closes the books through that date. Reports for {info.year} still show the
                year&rsquo;s income and expenses.
              </p>
              {info.checks > 0 && (
                <p className="accountant-note">
                  {info.checks} thing{info.checks === 1 ? '' : 's'} to check for {info.year} (see Accountant package).
                  Best to deal with them first.
                </p>
              )}
              <label className="grow">
                Close into
                <AccountCombobox groups={equityGroups} value={equityId} onChange={setEquityId} label="Close into" />
              </label>
              <p className="accountant-note">
                <span aria-hidden="true">⚑ </span>
                Check with your accountant: which equity account the year closes into (owner&rsquo;s capital,
                partners&rsquo; capital or retained earnings), and whether draws should be closed into capital too.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!equityId}
                  onClick={async () => {
                    const r = await window.juno.closeYear(info.year, equityId!)
                    if (!r.ok) return setMsg({ text: r.error, bad: true })
                    setView(r.value)
                    setMsg({ text: `${info.year} closed.`, bad: false })
                    onChanged()
                  }}
                >
                  {info.existingEntryId ? `Close ${info.year} again` : `Close ${info.year}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {view.closings.length > 0 && (
        <>
          <h4>Years closed</h4>
          <ul>
            {view.closings.map((c) => (
              <li key={c.entryId}>
                {c.year}: {formatCents(c.netIncomeCents)} into {c.equityAccount} (entry #{c.entryId})
              </li>
            ))}
          </ul>
        </>
      )}
      {view.history.length > 0 && (
        <>
          <h4>History</h4>
          <ul className="muted lock-history">
            {view.history.map((h, i) => (
              <li key={i}>
                {h.createdAt.slice(0, 10)}: closed through {h.lockedThrough ?? '(nothing)'}
                {h.reason && ` (reason: ${h.reason})`}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export default CloseBooks
