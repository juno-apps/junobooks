import { useEffect, useState } from 'react'
import type { RegisterView } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { formatCents } from '../../shared/money'
import { registerColumns } from '../../shared/register'

interface Props {
  accountId: number
  onBack: () => void
}

/** One account's history with a running balance. Read-only: changes are made from the Transactions tab. */
function AccountRegister({ accountId, onBack }: Props): JSX.Element {
  const year = localDateString().slice(0, 4)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [showVoided, setShowVoided] = useState(false)
  const [view, setView] = useState<RegisterView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.juno.getRegister({ accountId, from, to, includeVoided: showVoided }).then((r) => {
      if (r.ok) {
        setView(r.value)
        setError(null)
      } else setError(r.error)
    })
  }, [accountId, from, to, showVoided])

  if (!view) return <p>{error ?? 'Loading register…'}</p>
  const a = view.account
  const cols = registerColumns(a)
  const money = (c: number): string => (c ? formatCents(c) : '')

  return (
    <section className="chart register">
      <div className="chart-header">
        <h2>
          {a.number} {a.name}
          {!a.isActive && ' (inactive)'}
        </h2>
        <button type="button" className="link-button" onClick={onBack}>
          Back to chart of accounts
        </button>
      </div>
      <p className="muted">
        Every posted entry that touches this account, oldest first, with the balance after each one. To fix an entry,
        find it on the Transactions tab (void, reverse or duplicate it there).
      </p>
      <div className="form-row register-filters">
        <label className="narrow">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="narrow">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="register-quick">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setFrom(`${year}-01-01`)
              setTo(`${year}-12-31`)
            }}
          >
            This year
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setFrom('')
              setTo('')
            }}
          >
            All dates
          </button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
          Show voided entries
        </label>
      </div>
      {error && <p className="error">{error}</p>}

      <table className="chart-table register-table">
        <thead>
          <tr>
            <th>Date</th>
            <th className="num">#</th>
            <th>Description</th>
            <th>Other side</th>
            <th className="amount">{cols.increase}</th>
            <th className="amount">{cols.decrease}</th>
            <th className="amount">Balance</th>
            <th className="cleared-col" title="✓ seen on a bank statement · R reconciled">
              ✓
            </th>
          </tr>
        </thead>
        <tbody>
          {view.from && (
            <tr className="group-row">
              <td>{view.from}</td>
              <td />
              <td colSpan={4}>Balance forward</td>
              <td className="amount">{formatCents(view.openingCents)}</td>
              <td />
            </tr>
          )}
          {view.rows.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                Nothing posted to this account {view.from || view.to ? 'in these dates' : 'yet'}.
              </td>
            </tr>
          )}
          {view.rows.map((r, i) => (
            <tr key={`${r.entryId}-${i}`} className={r.status === 'void' ? 'inactive' : ''}>
              <td>{r.date}</td>
              <td className="num">{r.entryId}</td>
              <td>
                {r.memo || <span className="muted">(no memo)</span>}
                {r.lineMemo && <div className="account-description">{r.lineMemo}</div>}
                {r.status === 'void' && <div className="account-description">Voided, not counted</div>}
              </td>
              <td>{r.otherSide}</td>
              <td className="amount">{money(r.increaseCents)}</td>
              <td className="amount">{money(r.decreaseCents)}</td>
              <td className={r.balanceCents < 0 ? 'amount unusual' : 'amount'}>
                {r.status === 'void' ? '' : formatCents(r.balanceCents)}
              </td>
              <td
                className="cleared-col"
                title={
                  r.clearing === 'reconciled'
                    ? 'Reconciled'
                    : r.clearing === 'cleared'
                      ? 'Seen on a bank statement'
                      : ''
                }
              >
                {r.clearing === 'reconciled' ? 'R' : r.clearing === 'cleared' ? '✓' : ''}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={6}>Ending balance{view.to ? ` on ${view.to}` : ''}</th>
            <th className={view.closingCents < 0 ? 'amount unusual' : 'amount'}>{formatCents(view.closingCents)}</th>
            <th />
          </tr>
        </tfoot>
      </table>
    </section>
  )
}

export default AccountRegister
