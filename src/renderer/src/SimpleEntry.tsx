import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChartAccount, ManualEntryInput } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import {
  buildExpense,
  buildIncome,
  depositToGroups,
  expenseCategoryGroups,
  incomeCategoryGroups,
  paidFromGroups,
  splitTotal,
  type AccountGroup,
  type SplitLine
} from '../../shared/everyday'
import { formatCents } from '../../shared/money'
import AccountCombobox from './AccountCombobox'

export type SimpleKind = 'expense' | 'income'

interface Props {
  kind: SimpleKind
  onPosted: () => void
  onClose: () => void
}

interface Mode {
  title: string
  hint: string
  who: string
  whoPlaceholder: string
  other: string
  otherHint: string
  category: string
  button: string
  done: string
  /** How the total is described after posting, e.g. "from Checking". */
  direction: string
  otherGroups: (accounts: ChartAccount[]) => AccountGroup[]
  categoryGroups: (accounts: ChartAccount[]) => AccountGroup[]
  build: (f: { date: string; who: string; otherId: number | null; lines: SplitLine[] }) => { entry: ManualEntryInput } | { error: string }
}

const MODES: Record<SimpleKind, Mode> = {
  expense: {
    title: 'New expense',
    hint:
      'Fill in what you bought and how you paid. JunoBooks records both sides for you. To split one payment across several categories, use the next line.',
    who: 'Paid to',
    whoPlaceholder: 'e.g. Rio Grande',
    other: 'How did you pay?',
    otherHint:
      'Paid with your own money instead of the business’s? Pick the owner-contribution account under “Other accounts”, and ask your accountant how to treat it.',
    category: 'What was it for?',
    button: 'Post expense',
    done: 'Expense posted',
    direction: 'from',
    otherGroups: paidFromGroups,
    categoryGroups: expenseCategoryGroups,
    build: (f) => buildExpense({ date: f.date, paidTo: f.who, paidFromId: f.otherId, lines: f.lines })
  },
  income: {
    title: 'New income',
    hint:
      'Fill in what you were paid for and where the money went. Use the next line to split one deposit, for example a sale plus the sales tax you collected on it.',
    who: 'Received from',
    whoPlaceholder: 'e.g. a customer, or Etsy payout',
    other: 'Where was it deposited?',
    otherHint:
      'Choose “Not received yet” if you invoiced someone and they haven’t paid. Sales tax collected is money you owe the state, not income; ask your accountant if unsure how it applies to you.',
    category: 'What kind of income?',
    button: 'Post income',
    done: 'Income posted',
    direction: 'to',
    otherGroups: depositToGroups,
    categoryGroups: incomeCategoryGroups,
    build: (f) => buildIncome({ date: f.date, receivedFrom: f.who, depositToId: f.otherId, lines: f.lines })
  }
}

const blankLine = (): SplitLine => ({ accountId: null, amount: '', memo: '' })

/** The Expense and Income screens: same questions, opposite direction. */
function SimpleEntry({ kind, onPosted, onClose }: Props): JSX.Element {
  const mode = MODES[kind]
  const [accounts, setAccounts] = useState<ChartAccount[] | null>(null)
  const [date, setDate] = useState(localDateString())
  const [who, setWho] = useState('')
  const [otherId, setOtherId] = useState<number | null>(null)
  const [lines, setLines] = useState<SplitLine[]>([blankLine()])
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<{ id: number; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /** Bumped after posting so the category boxes start empty again. */
  const [round, setRound] = useState(0)
  const whoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.juno.getChart().then((chart) => setAccounts(chart ? chart.accounts : []))
  }, [])

  if (!accounts) return <p>Loading accounts…</p>

  const otherGroups = mode.otherGroups(accounts)
  const categories = mode.categoryGroups(accounts)
  const total = splitTotal(lines)

  function updateLine(i: number, patch: Partial<SplitLine>): void {
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
    const built = mode.build({ date, who, otherId, lines })
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
    const otherName = accounts!.find((a) => a.id === otherId)?.name ?? ''
    setPosted({ id: result.value, text: `${formatCents(total)} ${mode.direction} ${otherName}` })
    setWho('')
    setLines([blankLine()])
    setRound((r) => r + 1)
    onPosted()
    whoRef.current?.focus()
  }

  return (
    <section className="panel journal-entry">
      <div className="chart-header">
        <h2>{mode.title}</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">{mode.hint}</p>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label className="narrow">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="grow">
            {mode.who}
            <input
              ref={whoRef}
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder={mode.whoPlaceholder}
              autoFocus
            />
          </label>
        </div>
        <label>
          {mode.other}
          <AccountCombobox groups={otherGroups} value={otherId} onChange={setOtherId} label={mode.other} />
          <span className="hint">{mode.otherHint}</span>
        </label>

        <table className="entry-table">
          <thead>
            <tr>
              <th>{mode.category}</th>
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
            {mode.done} (entry #{posted.id}): {posted.text}.
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy}>
            {mode.button}
          </button>
        </div>
      </form>
    </section>
  )
}

export default SimpleEntry
