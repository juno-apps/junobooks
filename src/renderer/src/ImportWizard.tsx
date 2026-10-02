import { useEffect, useMemo, useState, type DragEvent } from 'react'
import type { ChartAccount, ColumnMapping, ImportFile, StageImportResult } from '../../preload/types'
import { importAccountGroups, inOutWords } from '../../shared/bankImport'
import {
  applyMapping,
  dateOrderAmbiguous,
  DATE_FORMAT_LABELS,
  detectDateFormat,
  guessMapping,
  parseCsv,
  type DateFormat
} from '../../shared/csvImport'
import { formatCents } from '../../shared/money'
import AccountCombobox from './AccountCombobox'

interface Props {
  /** Called after lines were staged, to open the review screen for that account. */
  onReview: (accountId: number) => void
  onImported: () => void
  onClose: () => void
}

const PREVIEW_ROWS = 8

/** Import a bank or card download: choose the account and file, check the columns, then stage the lines for review. */
function ImportWizard({ onReview, onImported, onClose }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<ChartAccount[] | null>(null)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [file, setFile] = useState<ImportFile | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [fromSaved, setFromSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StageImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    window.juno.getChart().then((c) => setAccounts(c ? c.accounts : []))
  }, [])

  const rows = useMemo(() => (file ? parseCsv(file.text) : []), [file])
  const account = accounts?.find((a) => a.id === accountId)
  const isCard = account?.subtype === 'credit_card'

  // A new file or account: use the mapping saved for this account and layout, or make a fresh guess.
  useEffect(() => {
    if (!file || accountId === null) return
    const guess = guessMapping(rows, isCard)
    window.juno.savedMapping(accountId, file.text, guess.hasHeader).then((r) => {
      setFromSaved(r.ok && r.value !== null)
      setMapping(r.ok && r.value ? r.value : guess)
    })
  }, [file, accountId])

  if (!accounts) return <p>Loading accounts…</p>

  async function load(next: Promise<{ ok: true; value: ImportFile | null } | { ok: false; error: string }>): Promise<void> {
    setError(null)
    setResult(null)
    const r = await next
    if (!r.ok) setError(r.error)
    else if (r.value) {
      if (parseCsv(r.value.text).length === 0) setError(`${r.value.fileName} is empty.`)
      else setFile(r.value)
    }
  }

  async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) await load(window.juno.readImportFile(window.juno.pathForFile(f)))
  }

  const mapped = mapping ? applyMapping(rows, mapping) : null
  const width = Math.max(0, ...rows.map((r) => r.length))
  const header = mapping?.hasHeader ? rows[0] : null
  const colName = (i: number): string => (header?.[i] ? `${header[i]} (column ${i + 1})` : `Column ${i + 1}: ${rows[mapping?.hasHeader ? 1 : 0]?.[i] ?? ''}`)
  const words = inOutWords(account)
  const set = (patch: Partial<ColumnMapping>): void => {
    setResult(null)
    setMapping((m) => (m ? { ...m, ...patch } : m))
  }
  const ambiguous = mapping ? dateOrderAmbiguous(rows, mapping.dateCol, mapping.hasHeader) && mapping.dateFormat !== 'YMD' : false

  const colSelect = (value: number, onChange: (v: number) => void, label: string, allowNone = false): JSX.Element => (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {allowNone && <option value={-1}>(none)</option>}
        {[...Array(width).keys()].map((i) => (
          <option key={i} value={i}>
            {colName(i)}
          </option>
        ))}
      </select>
    </label>
  )

  async function stage(): Promise<void> {
    if (!file || !mapping || accountId === null) return
    setBusy(true)
    setError(null)
    const r = await window.juno.stageImport({ accountId, fileName: file.fileName, text: file.text, mapping })
    setBusy(false)
    if (!r.ok) setError(r.error)
    else {
      setResult(r.value)
      onImported()
    }
  }

  return (
    <section className="panel journal-entry import-wizard">
      <div className="chart-header">
        <h2>Import a bank or card file</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Download your transactions from the bank or card website as a CSV file, then bring them in here. Nothing is
        posted yet: you&rsquo;ll review each line and choose what it was for. Lines you already imported are skipped
        automatically, so overlapping downloads are fine.
      </p>

      <div className="form import-account">
        <label>
          Import into
          <AccountCombobox
            groups={importAccountGroups(accounts)}
            value={accountId}
            onChange={(id) => {
              setAccountId(id)
              setResult(null)
            }}
            label="Import into"
          />
        </label>
      </div>

      <div
        className={dragging ? 'drop-zone dragging' : 'drop-zone'}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {file ? (
          <span>
            <strong>{file.fileName}</strong> · {rows.length} rows
          </span>
        ) : (
          <span className="muted">Drag the CSV file here, or</span>
        )}{' '}
        <button type="button" onClick={() => void load(window.juno.pickImportFile())}>
          {file ? 'Choose a different file…' : 'Choose file…'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {file && accountId === null && <p className="hint">Choose the account this file is from.</p>}

      {file && mapping && accountId !== null && mapped && (
        <>
          <h3>Check the columns</h3>
          <p className="hint">
            {fromSaved
              ? 'Using the column choices from your last import into this account.'
              : 'JunoBooks guessed which column is which. Check the preview below and fix anything that looks wrong.'}
          </p>
          <div className="mapping-grid">
            <label className="toggle">
              <input
                type="checkbox"
                checked={mapping.hasHeader}
                onChange={(e) => set({ hasHeader: e.target.checked, dateFormat: detectDateFormat(rows, mapping.dateCol, e.target.checked) })}
              />
              The first row has column names
            </label>
            {colSelect(mapping.dateCol, (v) => set({ dateCol: v, dateFormat: detectDateFormat(rows, v, mapping.hasHeader) }), 'Date')}
            <label>
              Date style
              <select value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
                {(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map((f) => (
                  <option key={f} value={f}>
                    {DATE_FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </label>
            {colSelect(mapping.descCol, (v) => set({ descCol: v }), 'Description')}
            {colSelect(mapping.extraCol, (v) => set({ extraCol: v }), 'Also add to the description (optional)', true)}
            <label>
              Amounts
              <select
                value={mapping.amountMode}
                onChange={(e) => {
                  const mode = e.target.value as 'single' | 'split'
                  set(
                    mode === 'single'
                      ? { amountMode: mode, amountCol: mapping.amountCol >= 0 ? mapping.amountCol : 0 }
                      : { amountMode: mode, outCol: mapping.outCol >= 0 ? mapping.outCol : 0, inCol: mapping.inCol >= 0 ? mapping.inCol : 0 }
                  )
                }}
              >
                <option value="single">One amount column (plus and minus)</option>
                <option value="split">Separate columns for money in and money out</option>
              </select>
            </label>
            {mapping.amountMode === 'single' ? (
              <>
                {colSelect(mapping.amountCol, (v) => set({ amountCol: v }), 'Amount')}
                <label className="toggle">
                  <input type="checkbox" checked={mapping.flipSign} onChange={(e) => set({ flipSign: e.target.checked })} />
                  Amounts are backwards (spending is shown as a plus)
                </label>
              </>
            ) : (
              <>
                {colSelect(mapping.outCol, (v) => set({ outCol: v }), `${words.out} column`)}
                {colSelect(mapping.inCol, (v) => set({ inCol: v }), `${words.in} column`)}
              </>
            )}
          </div>
          {ambiguous && (
            <p className="accountant-note">
              Every date in this file could be read either month-first or day-first. US banks use month-first; check the
              preview dates match your statement.
            </p>
          )}

          <table className="chart-table import-preview">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="amount">{words.in}</th>
                <th className="amount">{words.out}</th>
              </tr>
            </thead>
            <tbody>
              {mapped.lines.slice(0, PREVIEW_ROWS).map((l) => (
                <tr key={l.row}>
                  <td>{l.date}</td>
                  <td>{l.description}</td>
                  <td className="amount">{l.amountCents > 0 ? formatCents(l.amountCents) : ''}</td>
                  <td className="amount">{l.amountCents < 0 ? formatCents(-l.amountCents) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            {mapped.lines.length} {mapped.lines.length === 1 ? 'line' : 'lines'} read
            {mapped.lines.length > PREVIEW_ROWS && ` (first ${PREVIEW_ROWS} shown)`}.
            {mapped.zeroRows > 0 && ` ${mapped.zeroRows} with a zero amount left out.`}
          </p>
          {mapped.problems.length > 0 && (
            <p className="error">
              {mapped.problems.length} {mapped.problems.length === 1 ? 'row' : 'rows'} can&rsquo;t be read and will be
              left out: {mapped.problems.slice(0, 3).map((p) => `row ${p.row} (${p.reason})`).join('; ')}
              {mapped.problems.length > 3 && '…'}
            </p>
          )}

          {result ? (
            <div className="import-result">
              <p className="success">
                {result.added} new {result.added === 1 ? 'line' : 'lines'} ready to review.
                {result.duplicates > 0 && ` ${result.duplicates} already imported before (skipped).`}
                {result.early > 0 && ` ${result.early} dated before your books start (left out).`}
              </p>
              {result.added > 0 && (
                <button type="button" className="primary" onClick={() => onReview(accountId)}>
                  Review them now
                </button>
              )}
            </div>
          ) : (
            <div className="form-actions">
              <button type="button" className="primary" disabled={busy || mapped.lines.length === 0} onClick={() => void stage()}>
                Import {mapped.lines.length} {mapped.lines.length === 1 ? 'line' : 'lines'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default ImportWizard
