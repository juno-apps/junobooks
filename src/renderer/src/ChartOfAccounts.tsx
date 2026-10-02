import { useEffect, useState } from 'react'
import type { ChartAccount, ChartView } from '../../preload/types'
import { TAX_FORM_LABELS } from '../../shared/entities'
import { formatCents } from '../../shared/money'
import AccountForm from './AccountForm'
import AccountRegister from './AccountRegister'

const GROUPS: { title: string; test: (a: ChartAccount) => boolean }[] = [
  { title: 'Assets', test: (a) => a.type === 'asset' },
  { title: 'Liabilities', test: (a) => a.type === 'liability' },
  { title: 'Equity', test: (a) => a.type === 'equity' },
  { title: 'Income', test: (a) => a.type === 'income' },
  { title: 'Cost of goods sold', test: (a) => a.type === 'expense' && a.subtype === 'cogs' },
  { title: 'Expenses', test: (a) => a.type === 'expense' && a.subtype !== 'cogs' }
]

function taxLineText(a: ChartAccount): string {
  if (!a.taxLine) return '—'
  return a.taxLine.ref ? `${a.taxLine.ref}: ${a.taxLine.label}` : a.taxLine.label
}

type Editing = { account: ChartAccount | null } | null

function ChartOfAccounts(): JSX.Element {
  const [chart, setChart] = useState<ChartView | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [showMissing, setShowMissing] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  /** The account whose register is open, if any. */
  const [viewing, setViewing] = useState<number | null>(null)

  useEffect(() => {
    window.juno.getChart().then(setChart)
  }, [])

  if (!chart) return <p>Loading chart of accounts…</p>
  if (viewing !== null) {
    return (
      <AccountRegister
        accountId={viewing}
        onBack={() => {
          setViewing(null)
          window.juno.getChart().then(setChart)
        }}
      />
    )
  }

  const active = chart.accounts.filter((a) => a.isActive)
  const inactiveCount = chart.accounts.length - active.length
  const shown = showInactive ? chart.accounts : active
  const notes = active.filter((a) => a.accountantNote).length

  function done(next: ChartView): void {
    setChart(next)
    setEditing(null)
  }

  async function restore(numbers: string[]): Promise<void> {
    setRestoreError(null)
    const result = await window.juno.restoreAccounts(numbers)
    if (result.ok) setChart(result.value)
    else setRestoreError(result.error)
  }

  return (
    <section className="chart">
      <div className="chart-header">
        <h2>Chart of accounts</h2>
        <button type="button" className="primary" onClick={() => setEditing({ account: null })} disabled={!!editing}>
          Add account
        </button>
      </div>
      <p className="muted">
        Click an account to see its register (every entry and the running balance).
        <br />
        {active.length} accounts · Tax lines for {TAX_FORM_LABELS[chart.form]}, from the {chart.tableYear} IRS forms
        {chart.tableYear < chart.taxYear && ` (the ${chart.taxYear} forms aren't out yet)`}
        {notes > 0 && ` · ⚑ ${notes} notes for your accountant`}
      </p>
      {inactiveCount > 0 && (
        <label className="toggle">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show {inactiveCount} inactive {inactiveCount === 1 ? 'account' : 'accounts'}
        </label>
      )}

      {chart.missing.length > 0 && (
        <div className="missing-accounts">
          <button type="button" className="link-button" onClick={() => setShowMissing((v) => !v)}>
            {showMissing ? 'Hide' : 'Show'} {chart.missing.length} standard{' '}
            {chart.missing.length === 1 ? 'account' : 'accounts'} not in your chart
          </button>
          {showMissing && (
            <>
              <p className="hint">
                Standard accounts for your business type that you don&rsquo;t have (deleted, or never added). Add back
                any you want.
              </p>
              <ul>
                {chart.missing.map((m) => (
                  <li key={m.wantedNumber}>
                    {m.number} {m.name}
                    {m.number !== m.wantedNumber && ` (usual number ${m.wantedNumber} is taken)`}{' '}
                    <button type="button" className="link-button" onClick={() => void restore([m.wantedNumber])}>
                      Add back
                    </button>
                  </li>
                ))}
              </ul>
              {chart.missing.length > 1 && (
                <button type="button" onClick={() => void restore(chart.missing.map((m) => m.wantedNumber))}>
                  Add back all
                </button>
              )}
              {restoreError && <p className="error">{restoreError}</p>}
            </>
          )}
        </div>
      )}

      {editing && (
        <AccountForm
          key={editing.account?.id ?? 'new'}
          account={editing.account}
          chart={chart}
          onDone={done}
          onCancel={() => setEditing(null)}
        />
      )}

      <table className="chart-table">
        <thead>
          <tr>
            <th className="num">No.</th>
            <th>Account</th>
            <th>Tax line</th>
            <th className="amount">Balance</th>
            <th className="actions" aria-label="Actions" />
          </tr>
        </thead>
        {GROUPS.map((g) => {
          const inGroup = shown.filter(g.test)
          if (inGroup.length === 0) return null
          // Sub-accounts sit right under their parent, indented.
          const ids = new Set(inGroup.map((a) => a.id))
          const rows = inGroup
            .filter((a) => a.parentId === null || !ids.has(a.parentId))
            .flatMap((p) => [
              { a: p, depth: 0 },
              ...inGroup.filter((c) => c.parentId === p.id).map((c) => ({ a: c, depth: 1 }))
            ])
          return (
            <tbody key={g.title}>
              <tr className="group-row">
                <th colSpan={5}>{g.title}</th>
              </tr>
              {rows.map(({ a, depth }) => (
                <tr key={a.id} className={`${a.isActive ? '' : 'inactive'}${depth ? ' sub-account' : ''}`}>
                  <td className="num">{a.number}</td>
                  <td style={depth ? { paddingLeft: '1.6rem' } : undefined}>
                    <button type="button" className="link-button account-link" onClick={() => setViewing(a.id)}>
                      {a.name}
                    </button>
                    {!a.isActive && ' (inactive)'}
                    {a.description && <div className="account-description">{a.description}</div>}
                    {a.accountantNote && (
                      <div className="accountant-note">
                        <span aria-hidden="true">⚑ </span>
                        Check with your accountant: {a.accountantNote}
                      </div>
                    )}
                  </td>
                  <td className="tax-line">{taxLineText(a)}</td>
                  <td className={a.balanceCents < 0 ? 'amount unusual' : 'amount'}>{formatCents(a.balanceCents)}</td>
                  <td className="actions">
                    <button type="button" className="link-button" onClick={() => setEditing({ account: a })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          )
        })}
      </table>
    </section>
  )
}

export default ChartOfAccounts
