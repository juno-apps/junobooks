import { useEffect, useState } from 'react'
import type { ChartAccount, ChartView } from '../../preload/types'
import { TAX_FORM_LABELS } from '../../shared/entities'
import { formatCents } from '../../shared/money'

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

function ChartOfAccounts(): JSX.Element {
  const [chart, setChart] = useState<ChartView | null>(null)

  useEffect(() => {
    window.juno.getChart().then(setChart)
  }, [])

  if (!chart) return <p>Loading chart of accounts…</p>

  const notes = chart.accounts.filter((a) => a.accountantNote).length

  return (
    <section className="chart">
      <h2>Chart of accounts</h2>
      <p className="muted">
        {chart.accounts.length} accounts · Tax lines for {TAX_FORM_LABELS[chart.form]}, from the {chart.tableYear} IRS
        forms
        {chart.tableYear < chart.taxYear && ` (the ${chart.taxYear} forms aren't out yet)`}
        {notes > 0 && ` · ⚑ ${notes} notes for your accountant`}
      </p>
      <table className="chart-table">
        <thead>
          <tr>
            <th className="num">No.</th>
            <th>Account</th>
            <th>Tax line</th>
            <th className="amount">Balance</th>
          </tr>
        </thead>
        {GROUPS.map((g) => {
          const rows = chart.accounts.filter(g.test)
          if (rows.length === 0) return null
          return (
            <tbody key={g.title}>
              <tr className="group-row">
                <th colSpan={4}>{g.title}</th>
              </tr>
              {rows.map((a) => (
                <tr key={a.id} className={a.isActive ? '' : 'inactive'}>
                  <td className="num">{a.number}</td>
                  <td>
                    {a.name}
                    {!a.isActive && ' (inactive)'}
                    {a.accountantNote && (
                      <div className="accountant-note">
                        <span aria-hidden="true">⚑ </span>
                        Check with your accountant: {a.accountantNote}
                      </div>
                    )}
                  </td>
                  <td className="tax-line">{taxLineText(a)}</td>
                  <td className={a.balanceCents < 0 ? 'amount unusual' : 'amount'}>{formatCents(a.balanceCents)}</td>
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
