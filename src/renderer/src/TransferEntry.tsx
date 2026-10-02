import { useEffect, useState, type FormEvent } from 'react'
import type { ChartAccount } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { buildTransfer, transferGroups } from '../../shared/everyday'
import { formatCents, parseMoney } from '../../shared/money'
import AccountCombobox from './AccountCombobox'
import { useFormError } from './useFormError'

interface Props {
  onPosted: () => void
  onClose: () => void
}

/** Move money between two of your own accounts, e.g. Checking to Savings, or paying a credit card bill. */
function TransferEntry({ onPosted, onClose }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<ChartAccount[] | null>(null)
  const [date, setDate] = useState(localDateString())
  const [fromId, setFromId] = useState<number | null>(null)
  const [toId, setToId] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [posted, setPosted] = useState<{ id: number; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /** Bumped after posting so the account boxes start empty again. */
  const [round, setRound] = useState(0)
  const nameOf = (id: number | null): string => accounts?.find((a) => a.id === id)?.name ?? ''
  const build = () =>
    buildTransfer({ date, memo: memo.trim() || `Transfer from ${nameOf(fromId)} to ${nameOf(toId)}`, fromId, toId, amount })
  const { error, showCheck, showSave, clear } = useFormError(() => {
    const built = build()
    return 'error' in built ? built.error : null
  }, [date, fromId, toId, amount, memo])

  useEffect(() => {
    window.juno.getChart().then((chart) => setAccounts(chart ? chart.accounts : []))
  }, [])

  if (!accounts) return <p>Loading accounts…</p>

  const groups = transferGroups(accounts)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    clear()
    const built = build()
    if ('error' in built) {
      showCheck(built.error)
      return
    }
    setBusy(true)
    const result = await window.juno.postManualEntry(built.entry)
    setBusy(false)
    if (!result.ok) {
      showSave(result.error)
      return
    }
    setPosted({ id: result.value, text: `${formatCents(parseMoney(amount) ?? 0)} from ${nameOf(fromId)} to ${nameOf(toId)}` })
    setFromId(null)
    setToId(null)
    setAmount('')
    setMemo('')
    setRound((r) => r + 1)
    onPosted()
  }

  function swap(): void {
    setFromId(toId)
    setToId(fromId)
    setRound((r) => r + 1) // the boxes remember their own text, so start them fresh
    setPosted(null)
  }

  return (
    <section className="panel journal-entry">
      <div className="chart-header">
        <h2>New transfer</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Move money between your own accounts, for example from Checking to Savings. To pay a credit card bill, move
        money from your bank account <em>to</em> the credit card.
      </p>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label className="narrow">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="narrow">
            Amount
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setPosted(null)
              }}
              autoFocus
            />
          </label>
          <label className="grow">
            Note (optional)
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Monthly card payment" />
          </label>
        </div>
        <div className="form-row">
          <label className="grow" key={`from-${round}`}>
            Move money from
            <AccountCombobox groups={groups} value={fromId} onChange={setFromId} label="Move money from" />
          </label>
          <button type="button" className="link-button" onClick={swap} title="Swap the two accounts">
            ⇄ Swap
          </button>
          <label className="grow" key={`to-${round}`}>
            To
            <AccountCombobox groups={groups} value={toId} onChange={setToId} label="Move money to" />
          </label>
        </div>

        {error && <p className="error">{error}</p>}
        {posted && (
          <p className="success">
            Transfer posted (entry #{posted.id}): {posted.text}.
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy}>
            Post transfer
          </button>
        </div>
      </form>
    </section>
  )
}

export default TransferEntry
