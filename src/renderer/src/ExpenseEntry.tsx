import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChartAccount } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { buildExpense, expenseCategoryGroups, expenseTotal, paidFromGroups, type ExpenseLineText } from '../../shared/everyday'
import { formatCents } from '../../shared/money'
import AccountCombobox from './AccountCombobox'

interface Props {
  onPosted: () => void
  onClose: () => void
}

const blankLine = (): ExpenseLineText => ({ accountId: null, amount: '', memo: '' })

function ExpenseEntry({ onPosted, onClose }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<ChartAccount[] | null>(null)
  const [date, setDate] = useState(localDateString())
  const [paidTo, setPaidTo] = useState('')
  const [paidFromId, setPaidFromId] = useState<number | null>(null)
  const [lines, setLines] = useState<ExpenseLineText[]>([blankLine()])
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<{ id: number; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /** Bumped after posting so the category boxes start empty again. */
  const [round, setRound] = useState(0)
  const paidToRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.juno.getChart().then((chart) => setAccounts(chart ? chart.accounts : []))
  }, [])

  if (!accounts) return <p>Loading accounts…</p>

  const paidFrom = paidFromGroups(accounts)
  const categories = expenseCategoryGroups(accounts)
  const total = expenseTotal(lines)

  function updateLine(i: number, patch: Partial<ExpenseLineText>): void {
    setPosted(null)
    setLines((prev) => {
      const next = prev.map((l, j) => (j === i ? { ...l, ...patch } : l))
      const last = next[next.length - 1]
      // Filling in the last line adds a fresh one, so a split needs no extra click.
      if (last.accountId !== null || last.amount.trim()) next.push(blankLine())
      return next
    })
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    const built = buildExpense({ date, paidTo, paidFromId, lines })
    if ('error' in built) {
      setError(built.error)
      return
    }
    setBusy(true)
    const result = await window.juno.postManualEntry(built.entry)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const paidFromName = accounts!.find((a) => a.id === paidFromId)?.name ?? ''
    setPosted({ id: result.value, text: `${formatCents(total)} from ${paidFromName}` })
    setPaidTo('')
    setLines([blankLine()])
    setRound((r) => r + 1)
    onPosted()
    paidToRef.current?.focus()
  }

  return (
    <section className="panel journal-entry">
      <div className="chart-header">
        <h2>New expense</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Fill in what you bought and how you paid. JunoBooks records both sides for you. To split one payment across
        several categories, use the next line.
      </p>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label className="narrow">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="grow">
            Paid to
            <input
              ref={paidToRef}
              value={paidTo}
              onChange={(e) => setPaidTo(e.target.value)}
              placeholder="e.g. Rio Grande"
              autoFocus
            />
          </label>
        </div>
        <label>
          How did you pay?
          <AccountCombobox groups={paidFrom} value={paidFromId} onChange={setPaidFromId} label="How did you pay" />
          <span className="hint">
            Paid with your own money instead of the business&rsquo;s? Pick the owner-contribution account under
            &ldquo;Other accounts&rdquo;, and ask your accountant how to treat it.
          </span>
        </label>

        <table className="entry-table">
          <thead>
            <tr>
              <th>What was it for?</th>
              <th className="amount">Amount</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${round}-${i}`}>
                <td>
                  <AccountCombobox
                    groups={categories}
                    value={l.accountId}
                    onChange={(id) => updateLine(i, { accountId: id })}
                    label={`Line ${i + 1} category`}
                  />
                </td>
                <td className="amount">
                  <input
                    inputMode="decimal"
                    value={l.amount}
                    onChange={(e) => updateLine(i, { amount: e.target.value })}
                    aria-label={`Line ${i + 1} amount`}
                  />
                </td>
                <td>
                  <input
                    value={l.memo}
                    onChange={(e) => updateLine(i, { memo: e.target.value })}
                    aria-label={`Line ${i + 1} note`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th className="amount">{formatCents(total)}</th>
              <th />
            </tr>
          </tfoot>
        </table>

        {error && <p className="error">{error}</p>}
        {posted && (
          <p className="success">
            Expense posted (entry #{posted.id}): {posted.text}.
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy}>
            Post expense
          </button>
        </div>
      </form>
    </section>
  )
}

export default ExpenseEntry
