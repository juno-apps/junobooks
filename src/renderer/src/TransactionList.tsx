import { Fragment, useEffect, useState, type FormEvent } from 'react'
import type { EntryListItem } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { formatCents } from '../../shared/money'

interface Props {
  /** Bumped by the parent when an entry is posted elsewhere, so the list reloads. */
  version: number
  /** Called after a void or reversal, so balances elsewhere reload. */
  onChanged: () => void
  onDuplicate: (entry: EntryListItem) => void
}

type Action = { kind: 'void'; reason: string } | { kind: 'reverse'; date: string; memo: string } | null

/** "Supplies, Checking" — up to three account names, then "+N more". */
function accountsText(e: EntryListItem): string {
  const names = [...new Set(e.lines.map((l) => l.accountName))]
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', ')
}

function statusText(e: EntryListItem): string {
  if (e.status === 'void') return 'Voided'
  if (e.status === 'draft') return 'Draft'
  if (e.reversedById !== null) return `Reversed by #${e.reversedById}`
  if (e.reversesEntryId !== null) return `Reversal of #${e.reversesEntryId}`
  return ''
}

function TransactionList({ version, onChanged, onDuplicate }: Props): JSX.Element {
  const [entries, setEntries] = useState<EntryListItem[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.juno.listEntries().then(setEntries)
  }, [version])

  if (!entries) return <p>Loading transactions…</p>

  function toggle(id: number): void {
    setOpenId((cur) => (cur === id ? null : id))
    setAction(null)
    setError(null)
  }

  async function submitAction(e: FormEvent, entry: EntryListItem): Promise<void> {
    e.preventDefault()
    if (!action) return
    setError(null)
    const result =
      action.kind === 'void'
        ? await window.juno.voidEntry(entry.id, action.reason)
        : await window.juno.reverseEntry(entry.id, action.date, action.memo)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEntries(result.value)
    setAction(null)
    onChanged()
  }

  return (
    <section className="chart">
      <div className="chart-header">
        <h2>Transactions</h2>
      </div>
      {entries.length === 0 ? (
        <p className="muted">No transactions yet. Use New expense, New income, New transfer or New journal entry above to add one.</p>
      ) : (
        <table className="chart-table entry-list">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">#</th>
              <th>Memo</th>
              <th>Accounts</th>
              <th className="amount">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const open = openId === e.id
              const canChange = e.status === 'posted' && e.reversedById === null
              return (
                <Fragment key={e.id}>
                  <tr
                    className={`entry-row${e.status === 'void' ? ' inactive' : ''}${open ? ' open' : ''}`}
                    onClick={() => toggle(e.id)}
                  >
                    <td>{e.date}</td>
                    <td className="num">{e.id}</td>
                    <td>{e.memo || <span className="muted">(no memo)</span>}</td>
                    <td>{accountsText(e)}</td>
                    <td className="amount">{formatCents(e.amountCents)}</td>
                    <td>{statusText(e)}</td>
                  </tr>
                  {open && (
                    <tr className="entry-detail">
                      <td colSpan={6}>
                        <table className="entry-lines">
                          <thead>
                            <tr>
                              <th>Account</th>
                              <th className="amount">Debit</th>
                              <th className="amount">Credit</th>
                              <th>Line memo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.lines.map((l, i) => (
                              <tr key={i}>
                                <td>
                                  {l.accountNumber} {l.accountName}
                                </td>
                                <td className="amount">{l.amountCents > 0 ? formatCents(l.amountCents) : ''}</td>
                                <td className="amount">{l.amountCents < 0 ? formatCents(-l.amountCents) : ''}</td>
                                <td>{l.memo}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {e.status === 'void' && <p className="muted">Voided: {e.voidReason}</p>}

                        {!action && (
                          <div className="form-actions">
                            <button type="button" onClick={() => onDuplicate(e)}>
                              Duplicate
                            </button>
                            {canChange && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setAction({ kind: 'reverse', date: localDateString(), memo: '' })}
                                >
                                  Reverse…
                                </button>
                                <button type="button" className="danger" onClick={() => setAction({ kind: 'void', reason: '' })}>
                                  Void…
                                </button>
                              </>
                            )}
                          </div>
                        )}

                        {action?.kind === 'void' && (
                          <form className="form account-form" onSubmit={(ev) => submitAction(ev, e)}>
                            <p className="hint">
                              Voiding cancels this entry as if it never happened. It stays on record, marked
                              &ldquo;Voided,&rdquo; but no longer counts in any balance. Use this for mistakes.
                            </p>
                            <label>
                              Reason
                              <input
                                autoFocus
                                value={action.reason}
                                onChange={(ev) => setAction({ ...action, reason: ev.target.value })}
                                placeholder="e.g. Entered twice"
                              />
                            </label>
                            {error && <p className="error">{error}</p>}
                            <div className="form-actions">
                              <button type="submit" className="danger">
                                Void entry #{e.id}
                              </button>
                              <button type="button" onClick={() => setAction(null)}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}

                        {action?.kind === 'reverse' && (
                          <form className="form account-form" onSubmit={(ev) => submitAction(ev, e)}>
                            <p className="hint">
                              Reversing keeps this entry and posts an equal-and-opposite one on the date you choose,
                              so the two cancel out from then on. Use this when the original&rsquo;s period is already
                              closed, or the undo should happen on a later date.
                            </p>
                            <div className="form-row">
                              <label className="narrow">
                                Reversal date
                                <input
                                  type="date"
                                  autoFocus
                                  value={action.date}
                                  onChange={(ev) => setAction({ ...action, date: ev.target.value })}
                                />
                              </label>
                              <label className="grow">
                                Memo (optional)
                                <input
                                  value={action.memo}
                                  onChange={(ev) => setAction({ ...action, memo: ev.target.value })}
                                  placeholder={`Reversal of entry #${e.id}`}
                                />
                              </label>
                            </div>
                            {error && <p className="error">{error}</p>}
                            <div className="form-actions">
                              <button type="submit" className="primary">
                                Post reversal
                              </button>
                              <button type="button" onClick={() => setAction(null)}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default TransactionList
