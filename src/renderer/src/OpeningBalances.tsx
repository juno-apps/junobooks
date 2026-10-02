import { useEffect, useState, type FormEvent } from 'react'
import type { OpeningBalancesView } from '../../preload/types'
import { formatCents, parseMoney } from '../../shared/money'
import { openingDifference, type OpeningAccount } from '../../shared/opening'

interface Props {
  onSaved: () => void
  onClose: () => void
}

const GROUPS: { title: string; type: OpeningAccount['type']; hint: string }[] = [
  { title: 'What the business had', type: 'asset', hint: 'Bank and cash balances, money customers owed you, inventory, equipment.' },
  { title: 'What the business owed', type: 'liability', hint: 'Credit card balances, unpaid bills, sales tax owed, loans.' },
  { title: 'Owner and equity accounts', type: 'equity', hint: 'Usually left blank: your accountant sets these up from the difference below.' }
]

const plain = (cents: number): string => (cents ? formatCents(cents).replace('$', '').replace(/,/g, '') : '')

/** Opening balances: what each balance-sheet account held on the day the books start. */
function OpeningBalances({ onSaved, onClose }: Props): JSX.Element {
  const [view, setView] = useState<OpeningBalancesView | null>(null)
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function load(v: OpeningBalancesView): void {
    setView(v)
    setAmounts(Object.fromEntries(v.accounts.map((a) => [a.id, plain(a.amountCents)])))
  }

  useEffect(() => {
    window.juno.getOpeningBalances().then((r) => (r.ok ? load(r.value) : setError(r.error)))
  }, [])

  if (!view) return <p>{error ?? 'Loading opening balances…'}</p>

  const parsed = view.accounts.map((a) => {
    const text = (amounts[a.id] ?? '').trim()
    return { ...a, text, amountCents: text ? parseMoney(text) : 0 }
  })
  const bad = parsed.find((a) => a.amountCents === null)
  const difference = bad ? null : openingDifference(parsed as OpeningAccount[])

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (bad) {
      setError(`"${bad.text}" for ${bad.name} isn't an amount. Use numbers like 1250.00.`)
      return
    }
    setError(null)
    setBusy(true)
    const result = await window.juno.saveOpeningBalances(parsed.map((a) => ({ accountId: a.id, amountCents: a.amountCents! })))
    if (!result.ok) {
      setBusy(false)
      setError(result.error)
      return
    }
    const fresh = await window.juno.getOpeningBalances()
    setBusy(false)
    if (fresh.ok) load(fresh.value)
    setSaved(result.value === null ? 'Opening balances cleared.' : `Opening balances saved (entry #${result.value}).`)
    onSaved()
  }

  return (
    <section className="panel journal-entry opening">
      <div className="chart-header">
        <h2>Opening balances</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Enter what each account held when these books start, on <strong>{view.date}</strong>. Use the balance on your bank
        and card statements at the end of the day before. Leave an account blank if it was zero. Amounts are what you
        had or owed, so a card balance of $1,200 is entered as 1200. An overdrawn bank account is a minus amount.
      </p>
      {view.entryId !== null && (
        <p className="hint">
          Saved as entry #{view.entryId}. Saving again replaces it: the old entry is voided and kept on record.
        </p>
      )}
      <form className="form" onSubmit={submit}>
        {GROUPS.map((g) => {
          const rows = parsed.filter((a) => a.type === g.type)
          if (rows.length === 0) return null
          return (
            <div key={g.type} className="opening-group">
              <h3>{g.title}</h3>
              <p className="hint">{g.hint}</p>
              <table className="entry-table">
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {a.number} {a.name}
                        {!a.isActive && ' (inactive)'}
                      </td>
                      <td className="amount">
                        <input
                          inputMode="decimal"
                          aria-label={`${a.name} opening balance`}
                          className={a.amountCents === null ? 'unmatched' : ''}
                          value={amounts[a.id] ?? ''}
                          onChange={(e) => {
                            setSaved(null)
                            setError(null)
                            setAmounts({ ...amounts, [a.id]: e.target.value })
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}

        <div className="opening-difference">
          <strong>
            {view.equityAccount ? `${view.equityAccount.number} ${view.equityAccount.name}` : 'Opening balance equity'}:{' '}
            {difference === null ? '—' : formatCents(difference)}
          </strong>
          <p className="accountant-note">
            <span aria-hidden="true">⚑ </span>
            Check with your accountant: what the business had minus what it owed lands here. It is a temporary holding
            account; your accountant moves it into the right owner&rsquo;s equity or retained earnings account.
          </p>
        </div>

        {error && <p className="error">{error}</p>}
        {saved && <p className="success">{saved}</p>}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy}>
            Save opening balances
          </button>
        </div>
      </form>
    </section>
  )
}

export default OpeningBalances
