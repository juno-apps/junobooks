import { useEffect, useState } from 'react'
import type { Dashboard } from '../../preload/types'
import { formatCents } from '../../shared/money'

interface Props {
  /** Bumped when anything changes, so the figures reload. */
  version: number
  onAction: (action: Dashboard['todo'][number]['action']) => void
}

function Figure({ label, cents, sub }: { label: string; cents: number; sub?: string }): JSX.Element {
  return (
    <div className="figure">
      <span className="muted">{label}</span>
      <strong className={cents < 0 ? 'unusual' : ''}>{formatCents(cents)}</strong>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  )
}

/** This year so far, money on hand, owed both ways, and a to-do list with buttons to the right screen. */
function DashboardPanel({ version, onAction }: Props): JSX.Element | null {
  const [d, setD] = useState<Dashboard | null>(null)
  useEffect(() => {
    window.juno.dashboard().then((r) => r.ok && setD(r.value))
  }, [version])
  if (!d) return null
  const list = (items: { name: string; cents: number }[]): string =>
    items.map((i) => `${i.name} ${formatCents(i.cents)}`).join(' · ')
  return (
    <section className="dashboard">
      <div className="figures">
        <Figure label={`Sales ${d.year} so far`} cents={d.salesCents} />
        <Figure label="Costs and expenses" cents={d.expensesCents} />
        <Figure label="Net income" cents={d.netIncomeCents} />
        <Figure label="Cash" cents={d.cashTotalCents} sub={list(d.cash)} />
        <Figure label="Owed to you" cents={d.owedToYouTotalCents} sub={list(d.owedToYou)} />
        <Figure label="You owe" cents={d.youOweTotalCents} sub={list(d.youOwe)} />
      </div>
      {d.todo.length > 0 && (
        <div className="todo">
          <h3>To do</h3>
          <ul>
            {d.todo.map((t, i) => (
              <li key={i}>
                <button type="button" className="link-button" onClick={() => onAction(t.action)}>
                  {t.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default DashboardPanel
