import { useEffect, useState, type FormEvent } from 'react'
import type { ChartAccount, ReconcileView } from '../../preload/types'
import { importAccountGroups, inOutWords } from '../../shared/bankImport'
import { localDateString } from '../../shared/dates'
import { formatCents, parseMoney } from '../../shared/money'
import { reconcileTotals } from '../../shared/reconcile'
import AccountCombobox from './AccountCombobox'

interface Props {
  initialAccountId: number | null
  onChanged: () => void
  onClose: () => void
}

const plain = (cents: number): string => formatCents(cents).replace('$', '').replace(/,/g, '')

/** Reconcile a bank or card account against its statement: tick what the statement shows until the difference is $0. */
function Reconcile({ initialAccountId, onChanged, onClose }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<ChartAccount[] | null>(null)
  const [accountId, setAccountId] = useState<number | null>(initialAccountId)
  const [view, setView] = useState<ReconcileView | null>(null)
  const [statement, setStatement] = useState<{ date: string; balance: string } | null>(null)
  const [undoReason, setUndoReason] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)

  useEffect(() => {
    window.juno.getChart().then((c) => setAccounts(c ? c.accounts : []))
  }, [])

  useEffect(() => {
    setView(null)
    setMessage(null)
    setStatement(null)
    if (accountId !== null) void load(window.juno.getReconcile(accountId))
  }, [accountId])

  async function load(p: ReturnType<typeof window.juno.getReconcile>, done?: string): Promise<boolean> {
    const r = await p
    if (!r.ok) {
      setMessage({ text: r.error, bad: true })
      return false
    }
    setView(r.value)
    if (done) setMessage({ text: done, bad: false })
    return true
  }

  if (!accounts) return <p>Loading accounts…</p>

  const isCard = view?.account.subtype === 'credit_card'
  const words = inOutWords(
    view
      ? { type: view.account.normalBalance === 'credit' ? 'liability' : 'asset', subtype: view.account.subtype }
      : undefined
  )
  const balanceWord = isCard ? 'Balance owed on the statement' : 'Ending balance on the statement'
  const totals = view ? reconcileTotals(view) : null

  async function saveStatement(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!statement || accountId === null) return
    const cents = parseMoney(statement.balance)
    if (cents === null) {
      setMessage({ text: `Enter the ${balanceWord.toLowerCase()} as an amount, like 1250.00.`, bad: true })
      return
    }
    if (await load(window.juno.setStatement(accountId, statement.date, cents))) {
      setStatement(null)
      setMessage(null)
    }
  }

  async function tick(lineIds: number[], cleared: boolean): Promise<void> {
    if (accountId === null) return
    setMessage(null)
    await load(window.juno.setCleared(accountId, lineIds, cleared))
  }

  return (
    <section className="panel journal-entry reconcile">
      <div className="chart-header">
        <h2>Reconcile</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Check your books against a bank or card statement. Enter the statement&rsquo;s end date and ending balance, then
        tick every line that appears on the statement. When the difference is $0.00, finish. Lines brought in from bank
        downloads are ticked already.
      </p>
      <div className="form import-account">
        <label>
          Account
          <AccountCombobox
            groups={importAccountGroups(accounts)}
            value={accountId}
            onChange={setAccountId}
            label="Account to reconcile"
          />
        </label>
      </div>

      {view && (
        <>
          <p className="muted">
            {view.last
              ? `Last reconciled through ${view.last.statementDate} at ${formatCents(view.last.statementBalanceCents)}.`
              : 'Not reconciled yet.'}
          </p>

          {(!view.open || statement) && (
            <form className="form" onSubmit={saveStatement}>
              <div className="form-row">
                <label className="narrow-date">
                  Statement end date
                  <input
                    type="date"
                    value={statement?.date ?? view.open?.statementDate ?? localDateString()}
                    onChange={(e) => setStatement({ date: e.target.value, balance: statement?.balance ?? '' })}
                    aria-label="Statement end date"
                  />
                </label>
                <label className="grow">
                  {balanceWord}
                  <input
                    inputMode="decimal"
                    value={statement?.balance ?? ''}
                    placeholder="e.g. 5873.76"
                    onChange={(e) =>
                      setStatement({
                        date: statement?.date ?? view.open?.statementDate ?? localDateString(),
                        balance: e.target.value
                      })
                    }
                    aria-label={balanceWord}
                  />
                </label>
              </div>
              <div className="form-actions">
                <button type="submit" className="primary">
                  {view.open ? 'Save statement' : 'Start reconciling'}
                </button>
                {statement && view.open && (
                  <button type="button" onClick={() => setStatement(null)}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}

          {view.open && totals && (
            <>
              <div className="reconcile-summary">
                <div>
                  <span className="muted">Statement ending {view.open.statementDate}</span>
                  <strong>{formatCents(view.open.statementBalanceCents)}</strong>
                  {!statement && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        setStatement({
                          date: view.open!.statementDate,
                          balance: plain(view.open!.statementBalanceCents)
                        })
                      }
                    >
                      Change
                    </button>
                  )}
                </div>
                <div>
                  <span className="muted">Cleared balance</span>
                  <strong>{formatCents(totals.clearedCents)}</strong>
                </div>
                <div className={totals.differenceCents === 0 ? 'balanced' : 'off'}>
                  <span className="muted">Difference</span>
                  <strong>{formatCents(totals.differenceCents ?? 0)}</strong>
                </div>
              </div>

              {view.lines.length === 0 ? (
                <p className="muted">No unreconciled entries on or before {view.open.statementDate}.</p>
              ) : (
                <table className="chart-table reconcile-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Tick all"
                          checked={view.lines.every((l) => l.cleared)}
                          onChange={(e) =>
                            void tick(
                              view.lines.map((l) => l.lineId),
                              e.target.checked
                            )
                          }
                        />
                      </th>
                      <th>Date</th>
                      <th className="num">#</th>
                      <th>Description</th>
                      <th>Other side</th>
                      <th className="amount">{words.in}</th>
                      <th className="amount">{words.out}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.lines.map((l) => {
                      // Amounts are on the normal side: for a card, positive means more owed (a charge).
                      const up = isCard ? l.amountCents < 0 : l.amountCents > 0
                      return (
                        <tr key={l.lineId} className={l.cleared ? 'cleared-row' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Cleared ${l.date} ${l.memo}`}
                              checked={l.cleared}
                              onChange={(e) => void tick([l.lineId], e.target.checked)}
                            />
                          </td>
                          <td>{l.date}</td>
                          <td className="num">{l.entryId}</td>
                          <td>{l.memo || <span className="muted">(no memo)</span>}</td>
                          <td>{l.otherSide}</td>
                          <td className="amount">{up ? formatCents(Math.abs(l.amountCents)) : ''}</td>
                          <td className="amount">{up ? '' : formatCents(Math.abs(l.amountCents))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {view.laterCount > 0 && (
                <p className="hint">
                  {view.laterCount} later {view.laterCount === 1 ? 'entry is' : 'entries are'} left for the next
                  statement.
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={totals.differenceCents !== 0}
                  onClick={() =>
                    void load(window.juno.finishReconciliation(view.account.id), 'Reconciliation finished.').then(
                      (ok) => ok && onChanged()
                    )
                  }
                >
                  Finish reconciliation
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void load(
                      window.juno.cancelReconciliation(view.account.id),
                      'Reconciliation cancelled. Ticks were kept.'
                    )
                  }
                >
                  Cancel this reconciliation
                </button>
              </div>
            </>
          )}

          <p className="accountant-note">
            <span aria-hidden="true">⚑ </span>
            Check with your accountant: entries count on the date you recorded them, not the date they cleared the bank.
            A payment made in late December that clears in January usually still belongs to December; ask if unsure.
          </p>

          {message && <p className={message.bad ? 'error' : 'success'}>{message.text}</p>}

          {view.history.length > 0 && (
            <div className="reconcile-history">
              <h3>Past reconciliations</h3>
              <ul>
                {view.history.map((h) => (
                  <li key={h.id} className={h.status === 'undone' ? 'muted' : ''}>
                    Statement ending {h.statementDate}: {formatCents(h.statementBalanceCents)}
                    {h.status === 'undone' ? ` (undone: ${h.undoReason})` : ''}
                  </li>
                ))}
              </ul>
              {view.last && !view.open && (
                <>
                  {undoReason === null ? (
                    <button type="button" className="link-button" onClick={() => setUndoReason('')}>
                      Undo the last reconciliation…
                    </button>
                  ) : (
                    <form
                      className="form-row"
                      onSubmit={async (e) => {
                        e.preventDefault()
                        if (
                          await load(
                            window.juno.undoReconciliation(view.account.id, undoReason),
                            'Reconciliation undone.'
                          )
                        ) {
                          setUndoReason(null)
                          onChanged()
                        }
                      }}
                    >
                      <input
                        autoFocus
                        placeholder="Reason, e.g. statement balance typed wrong"
                        value={undoReason}
                        onChange={(e) => setUndoReason(e.target.value)}
                        aria-label="Reason for undoing"
                      />
                      <button type="submit" className="danger">
                        Undo
                      </button>
                      <button type="button" onClick={() => setUndoReason(null)}>
                        Cancel
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default Reconcile
