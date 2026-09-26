import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChartAccount, EntryListItem } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { blankRow, mirrorPair, rowsToLines, rowTotals, type EntryRow } from '../../shared/journal'
import { formatCents } from '../../shared/money'

interface Props {
  /** An existing entry to copy (Duplicate). The copy is dated today. */
  copyOf?: EntryListItem
  onPosted: () => void
  onClose: () => void
}

/** A screen row: the ledger row plus what's typed in the account box. */
type Row = EntryRow & { accountText: string }

function newRow(): Row {
  return { ...blankRow(), accountText: '' }
}

function accountLabel(a: ChartAccount): string {
  return `${a.number} ${a.name}`
}

/** Exact label, or a bare account number, picks that account. */
function exactMatch(accounts: ChartAccount[], text: string): ChartAccount | undefined {
  const t = text.trim().toLowerCase()
  if (!t) return undefined
  return accounts.find((a) => accountLabel(a).toLowerCase() === t || a.number.toLowerCase() === t)
}

/** On leaving the box: if the typed text fits exactly one account, pick it. */
function looseMatch(accounts: ChartAccount[], text: string): ChartAccount | undefined {
  const exact = exactMatch(accounts, text)
  if (exact) return exact
  const t = text.trim().toLowerCase()
  if (!t) return undefined
  const hits = accounts.filter((a) => accountLabel(a).toLowerCase().includes(t))
  return hits.length === 1 ? hits[0] : undefined
}

function isEmptyRow(r: Row): boolean {
  return !r.accountText.trim() && !r.debit.trim() && !r.credit.trim() && !r.memo.trim()
}

/** Debits minus credits, shown as a plain amount without the $ sign for typing into a box. */
function plainAmount(cents: number): string {
  return formatCents(cents).replace('$', '').replace(/,/g, '')
}

/** Screen rows for a copy of an existing entry, plus a blank row to keep typing. */
function rowsFrom(entry: EntryListItem): Row[] {
  const rows = entry.lines.map((l) => ({
    accountId: l.accountId,
    accountText: `${l.accountNumber} ${l.accountName}`,
    debit: l.amountCents > 0 ? plainAmount(l.amountCents) : '',
    credit: l.amountCents < 0 ? plainAmount(-l.amountCents) : '',
    memo: l.memo
  }))
  return [...rows, newRow()]
}

function JournalEntry({ copyOf, onPosted, onClose }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<ChartAccount[] | null>(null)
  const [date, setDate] = useState(localDateString())
  const [memo, setMemo] = useState(copyOf?.memo ?? '')
  const [rows, setRows] = useState<Row[]>(copyOf ? rowsFrom(copyOf) : [newRow(), newRow()])
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const firstAccount = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.juno.getChart().then((chart) => setAccounts(chart ? chart.accounts.filter((a) => a.isActive) : []))
  }, [])

  if (!accounts) return <p>Loading accounts…</p>

  const totals = rowTotals(rows)

  function update(i: number, patch: Partial<Row>): void {
    setPosted(null)
    setRows((prev) => {
      const next = mirrorPair(prev, prev.map((r, j) => (j === i ? { ...r, ...patch } : r)), i)
      // Typing in the last row adds a fresh one below it.
      if (i === next.length - 1 && !isEmptyRow(next[i])) next.push(newRow())
      return next
    })
  }

  function setAccountText(i: number, text: string): void {
    update(i, { accountText: text, accountId: exactMatch(accounts!, text)?.id ?? null })
  }

  function settleAccount(i: number): void {
    const r = rows[i]
    if (r.accountId !== null || !r.accountText.trim()) return
    const hit = looseMatch(accounts!, r.accountText)
    if (hit) update(i, { accountText: accountLabel(hit), accountId: hit.id })
  }

  /** Entering an empty amount box fills in whatever would balance the entry, if it belongs on that side. */
  function fillDifference(i: number, side: 'debit' | 'credit'): void {
    const r = rows[i]
    if (r.debit.trim() || r.credit.trim() || totals.difference === 0) return
    if (side === 'debit' && totals.difference < 0) update(i, { debit: plainAmount(-totals.difference) })
    if (side === 'credit' && totals.difference > 0) update(i, { credit: plainAmount(totals.difference) })
  }

  function removeRow(i: number): void {
    setRows((prev) => {
      const next = prev.filter((_, j) => j !== i)
      while (next.length < 2) next.push(newRow())
      return next
    })
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    const unmatched = rows.findIndex((r) => r.accountText.trim() && r.accountId === null)
    if (unmatched >= 0) {
      setError(`Line ${unmatched + 1}: "${rows[unmatched].accountText}" doesn't match an account. Pick one from the list.`)
      return
    }
    const checked = rowsToLines(rows)
    if ('error' in checked) {
      setError(checked.error)
      return
    }
    setBusy(true)
    const result = await window.juno.postManualEntry({ date, memo, lines: checked.lines })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPosted(result.value)
    setMemo('')
    setRows([newRow(), newRow()])
    onPosted()
    firstAccount.current?.focus()
  }

  return (
    <section className="panel journal-entry">
      <div className="chart-header">
        <h2>{copyOf ? `New journal entry (copy of #${copyOf.id})` : 'New journal entry'}</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Tab moves between boxes. Type part of an account name or number to pick it. An empty amount box fills in
        whatever balances the entry. Enter posts.
      </p>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label className="narrow">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="grow">
            Memo
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What was this for?" />
          </label>
        </div>

        <datalist id="entry-accounts">
          {accounts.map((a) => (
            <option key={a.id} value={accountLabel(a)} />
          ))}
        </datalist>

        <table className="entry-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="amount">Debit</th>
              <th className="amount">Credit</th>
              <th>Line memo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input
                    ref={i === 0 ? firstAccount : undefined}
                    list="entry-accounts"
                    value={r.accountText}
                    onChange={(e) => setAccountText(i, e.target.value)}
                    onBlur={() => settleAccount(i)}
                    className={r.accountText.trim() && r.accountId === null ? 'unmatched' : undefined}
                    aria-label={`Line ${i + 1} account`}
                  />
                </td>
                <td className="amount">
                  <input
                    inputMode="decimal"
                    value={r.debit}
                    onFocus={() => fillDifference(i, 'debit')}
                    onChange={(e) => update(i, { debit: e.target.value })}
                    aria-label={`Line ${i + 1} debit`}
                  />
                </td>
                <td className="amount">
                  <input
                    inputMode="decimal"
                    value={r.credit}
                    onFocus={() => fillDifference(i, 'credit')}
                    onChange={(e) => update(i, { credit: e.target.value })}
                    aria-label={`Line ${i + 1} credit`}
                  />
                </td>
                <td>
                  <input
                    value={r.memo}
                    onChange={(e) => update(i, { memo: e.target.value })}
                    aria-label={`Line ${i + 1} memo`}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    tabIndex={-1}
                    onClick={() => removeRow(i)}
                    title="Remove this line"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Totals</th>
              <th className="amount">{formatCents(totals.debits)}</th>
              <th className="amount">{formatCents(totals.credits)}</th>
              <th colSpan={2} className={totals.difference === 0 ? 'balanced' : 'unbalanced'}>
                {totals.difference === 0
                  ? totals.debits > 0
                    ? 'Balanced'
                    : ''
                  : `Off by ${formatCents(Math.abs(totals.difference))} (${totals.difference > 0 ? 'needs more credits' : 'needs more debits'})`}
              </th>
            </tr>
          </tfoot>
        </table>

        {error && <p className="error">{error}</p>}
        {posted !== null && <p className="success">Entry #{posted} posted.</p>}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy}>
            Post entry
          </button>
        </div>
      </form>
    </section>
  )
}

export default JournalEntry
