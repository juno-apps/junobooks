import { localDateString } from '../../shared/dates'
import { toCsv } from '../../shared/reports'
import { quarters } from '../../shared/salesTax'

export type Msg = { text: string; bad: boolean } | null

/** Saves report rows as a CSV in the company's exports\reports folder (and opens it, e.g. in Excel). */
export function CsvButtons({
  name,
  rows,
  onMsg
}: {
  name: string
  rows: () => (string | number)[][]
  onMsg: (m: Msg) => void
}): JSX.Element {
  async function save(open: boolean): Promise<void> {
    const r = await window.juno.saveCsv(name, toCsv(rows()), open)
    onMsg(r.ok ? { text: `Saved ${r.value}`, bad: false } : { text: r.error, bad: true })
  }
  return (
    <span className="csv-buttons">
      <button type="button" onClick={() => void save(true)}>
        Open in Excel
      </button>
      <button type="button" onClick={() => void save(false)}>
        Save as CSV
      </button>
    </span>
  )
}

/** The period picker shared by the period reports. */
export function PeriodPicker({
  firstYear,
  from,
  to,
  onChange,
  single = false
}: {
  firstYear: number
  from: string
  to: string
  onChange: (from: string, to: string) => void
  single?: boolean
}): JSX.Element {
  const thisYear = Number(localDateString().slice(0, 4))
  const years = Array.from({ length: Math.max(1, thisYear - firstYear + 1) }, (_, i) => thisYear - i)
  return (
    <div className="form-row period-row">
      {!single && (
        <label className="narrow-date">
          From
          <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} aria-label="Report from" />
        </label>
      )}
      <label className="narrow-date">
        {single ? 'As of' : 'To'}
        <input
          type="date"
          value={to}
          onChange={(e) => onChange(from, e.target.value)}
          aria-label={single ? 'Report as of' : 'Report to'}
        />
      </label>
      <div className="quick-periods">
        {years.map((y) => (
          <button key={y} type="button" className="link-button" onClick={() => onChange(`${y}-01-01`, `${y}-12-31`)}>
            {single ? `End of ${y}` : y}
          </button>
        ))}
        {!single &&
          quarters(thisYear).map((q) => (
            <button key={q.label} type="button" className="link-button" onClick={() => onChange(q.from, q.to)}>
              {q.label}
            </button>
          ))}
      </div>
    </div>
  )
}
