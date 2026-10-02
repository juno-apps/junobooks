import { useEffect, useState } from 'react'
import type { TieOutRow } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { DIFFERENCE_REASONS } from '../../shared/form1099k'
import { formatCents, parseMoney } from '../../shared/money'

interface Props {
  firstYear: number
  onClose: () => void
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const plain = (c: number | null): string => (c === null ? '' : (c / 100).toFixed(2))

/** Compares each platform's 1099-K (box 1a, typed in) with the gross JunoBooks imported. */
function Form1099K({ firstYear, onClose }: Props): JSX.Element {
  const thisYear = Number(localDateString().slice(0, 4))
  const years = Array.from({ length: Math.max(1, thisYear - firstYear + 1) }, (_, i) => thisYear - i)
  const [year, setYear] = useState(years[0])
  const [rows, setRows] = useState<TieOutRow[] | null>(null)
  const [edits, setEdits] = useState<Record<string, { amount: string; notes: string }>>({})
  const [newPlatform, setNewPlatform] = useState({ platform: '', amount: '' })
  const [showMonths, setShowMonths] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)

  function load(r: TieOutRow[]): void {
    setRows(r)
    setEdits(Object.fromEntries(r.map((x) => [x.platform, { amount: plain(x.formCents), notes: x.notes }])))
  }

  useEffect(() => {
    setMsg(null)
    window.juno.tieOut1099k(year).then((r) => (r.ok ? load(r.value) : setMsg({ text: r.error, bad: true })))
  }, [year])

  async function save(platform: string, amount: string, notes: string): Promise<boolean> {
    const cents = amount.trim() ? parseMoney(amount) : null
    if (amount.trim() && (cents === null || cents < 0)) {
      setMsg({ text: `"${amount}" isn't an amount.`, bad: true })
      return false
    }
    const r = await window.juno.set1099k(year, platform, cents, notes)
    if (!r.ok) {
      setMsg({ text: r.error, bad: true })
      return false
    }
    load(r.value)
    setMsg({ text: `Saved ${platform}.`, bad: false })
    return true
  }

  return (
    <section className="panel journal-entry form-1099k">
      <div className="chart-header">
        <h2>1099-K tie-out</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Etsy, Amazon and payment apps send a Form 1099-K reporting the gross amount buyers paid you (box 1a). Type that
        amount in for each one; JunoBooks compares it with what it imported (sales, shipping and sales tax collected,
        before fees and refunds) so you and your accountant can explain any difference.
      </p>
      <div className="form">
        <label className="narrow">
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="1099-K year">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows && (
        <table className="chart-table tie-out">
          <thead>
            <tr>
              <th>Platform</th>
              <th className="amount">Imported gross</th>
              <th className="amount">1099-K box 1a</th>
              <th className="amount">Difference</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = edits[r.platform] ?? { amount: '', notes: '' }
              return (
                <tr key={r.platform}>
                  <td>
                    {r.platform}
                    {r.imported && (
                      <div>
                        <button
                          type="button"
                          className="link-button small"
                          onClick={() => setShowMonths(showMonths === r.platform ? null : r.platform)}
                        >
                          {showMonths === r.platform ? 'Hide months' : 'By month'}
                        </button>
                      </div>
                    )}
                    {showMonths === r.platform && (
                      <table className="months">
                        <tbody>
                          {r.monthlyCents.map((c, i) => (
                            <tr key={i}>
                              <td>{MONTHS[i]}</td>
                              <td className="amount">{formatCents(c)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                  <td className="amount">
                    {r.imported ? formatCents(r.importedCents) : <span className="muted">not imported</span>}
                  </td>
                  <td className="amount">
                    <input
                      inputMode="decimal"
                      value={e.amount}
                      onChange={(ev) => setEdits({ ...edits, [r.platform]: { ...e, amount: ev.target.value } })}
                      aria-label={`${r.platform} 1099-K amount`}
                    />
                  </td>
                  <td className={r.differenceCents ? 'amount warn' : 'amount'}>
                    {r.differenceCents === null ? '' : formatCents(r.differenceCents)}
                  </td>
                  <td>
                    <input
                      value={e.notes}
                      onChange={(ev) => setEdits({ ...edits, [r.platform]: { ...e, notes: ev.target.value } })}
                      aria-label={`${r.platform} notes`}
                    />
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void save(r.platform, e.amount, e.notes)}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="form-row add-platform">
        <input
          placeholder="Another platform, e.g. PayPal, Square, Shopify"
          value={newPlatform.platform}
          onChange={(e) => setNewPlatform({ ...newPlatform, platform: e.target.value })}
          aria-label="Other platform"
        />
        <input
          inputMode="decimal"
          placeholder="Box 1a"
          value={newPlatform.amount}
          onChange={(e) => setNewPlatform({ ...newPlatform, amount: e.target.value })}
          aria-label="Other platform amount"
        />
        <button
          type="button"
          onClick={async () => {
            if (await save(newPlatform.platform, newPlatform.amount || '0', ''))
              setNewPlatform({ platform: '', amount: '' })
          }}
        >
          Add
        </button>
      </div>
      {msg && <p className={msg.bad ? 'error' : 'success'}>{msg.text}</p>}
      {rows?.some((r) => r.differenceCents) && (
        <div className="accountant-note">
          <p>
            <span aria-hidden="true">⚑ </span>
            Check with your accountant about any difference. Common reasons:
          </p>
          <ul>
            {DIFFERENCE_REASONS.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="hint">
        For platforms JunoBooks doesn&rsquo;t import (payment apps, Shopify and so on), the 1099-K amount is kept here
        for your accountant; those sales should already be in your books through bank imports or invoices.
      </p>
    </section>
  )
}

export default Form1099K
