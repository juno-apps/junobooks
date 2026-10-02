import { useEffect, useState } from 'react'
import type { AccountantNote, PackageResult } from '../../preload/types'
import { localDateString } from '../../shared/dates'

interface Props {
  firstYear: number
  onClose: () => void
}

/** One click: everything the accountant needs for a year, in one ZIP. Shows the notes first so problems can be fixed. */
function AccountantPackage({ firstYear, onClose }: Props): JSX.Element {
  const thisYear = Number(localDateString().slice(0, 4))
  const years = Array.from({ length: Math.max(1, thisYear - firstYear + 1) }, (_, i) => thisYear - i)
  const [year, setYear] = useState(years.length > 1 ? years[1] : years[0])
  const [notes, setNotes] = useState<AccountantNote[] | null>(null)
  const [result, setResult] = useState<PackageResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setResult(null)
    setNotes(null)
    window.juno.accountantNotes(year).then((r) => (r.ok ? setNotes(r.value) : setError(r.error)))
  }, [year])

  const checks = notes?.filter((n) => n.kind === 'check') ?? []
  const infos = notes?.filter((n) => n.kind === 'note') ?? []
  const list = (items: AccountantNote[]): JSX.Element => (
    <ul className="note-list">
      {items.map((n, i) => (
        <li key={i}>
          <strong>{n.area}:</strong> {n.text}
        </li>
      ))}
    </ul>
  )

  return (
    <section className="panel journal-entry package">
      <div className="chart-header">
        <h2>Accountant package</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Builds one ZIP file for your accountant: an Excel workbook with every report (one tab each), a PDF summary with
        the notes below, the general ledger and transactions as CSV files, the inventory count sheet, the fixed-asset
        list, and copies of the year&rsquo;s receipts and your resale certificates. It is saved in the company&rsquo;s
        exports folder; send it to your accountant yourself (email or a shared drive).
      </p>
      <div className="form">
        <label className="narrow">
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Package year">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {notes && (
        <>
          <h3>To check before sending ({checks.length})</h3>
          {checks.length === 0 ? <p className="success">Nothing to check.</p> : list(checks)}
          <h3>Notes for your accountant ({infos.length})</h3>
          {infos.length === 0 ? <p className="muted">None.</p> : list(infos)}
          <p className="hint">
            The package can be built at any time; build it again after fixing anything above. The notes go into the PDF
            summary and the workbook either way.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                const r = await window.juno.buildPackage(year)
                setBusy(false)
                if (!r.ok) return setError(r.error)
                setResult(r.value)
              }}
            >
              {busy ? 'Building…' : `Build ${year} package`}
            </button>
          </div>
        </>
      )}
      {result && (
        <div className="package-result">
          <p className="success">Saved {result.zipPath}</p>
          <p className="hint">
            {result.files.length} files, including {result.receipts} receipt{result.receipts === 1 ? '' : 's'} and{' '}
            {result.notes} note
            {result.notes === 1 ? '' : 's'}.
          </p>
          <button type="button" onClick={() => void window.juno.showPackage(result.zipPath)}>
            Show in folder
          </button>
        </div>
      )}
    </section>
  )
}

export default AccountantPackage
