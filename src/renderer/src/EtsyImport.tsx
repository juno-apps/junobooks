import { useEffect, useState } from 'react'
import type {
  ChartAccount,
  EtsyAccountStatus,
  EtsyImportResult,
  EtsyMapping,
  EtsyPayout,
  EtsyPreview,
  ImportFile
} from '../../preload/types'
import { importAccountGroups, lineCategoryGroups } from '../../shared/bankImport'
import { ETSY_TARGET_LABELS, type EtsyTarget } from '../../shared/etsy'
import { formatCents } from '../../shared/money'
import AccountCombobox from './AccountCombobox'

interface Props {
  onImported: () => void
  onClose: () => void
}

const PAYOUT_STATUS: Record<EtsyPayout['status'], string> = {
  matched: 'Found in the bank',
  waiting: 'In a bank import, waiting in Review imported lines (match it there)',
  missing: 'Not in an imported bank file yet'
}

/** "Sales $166.00 (money in)" style wording for a target total (debit positive). */
function describe(target: EtsyTarget, cents: number): string {
  if (target === 'sales_tax' && cents === 0) return 'nets to $0.00'
  if (target === 'clearing') return `${formatCents(Math.abs(cents))} ${cents >= 0 ? 'added to' : 'taken from'} what Etsy holds`
  return `${formatCents(Math.abs(cents))} ${cents < 0 ? 'in' : 'out'}`
}

/** Import an Etsy monthly payments statement (plus the Sold Orders file to split out shipping). */
function EtsyImport({ onImported, onClose }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<ChartAccount[] | null>(null)
  const [setup, setSetup] = useState<EtsyAccountStatus[] | null>(null)
  const [statement, setStatement] = useState<ImportFile | null>(null)
  const [orders, setOrders] = useState<ImportFile | null>(null)
  const [preview, setPreview] = useState<EtsyPreview | null>(null)
  const [mapping, setMapping] = useState<EtsyMapping>({})
  const [depositId, setDepositId] = useState<number | null>(null)
  const [result, setResult] = useState<EtsyImportResult | null>(null)
  const [payouts, setPayouts] = useState<EtsyPayout[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadBasics(): Promise<void> {
    const [chart, s, p] = await Promise.all([window.juno.getChart(), window.juno.etsyAccounts(), window.juno.etsyPayouts()])
    setAccounts(chart ? chart.accounts : [])
    if (s.ok) setSetup(s.value)
    if (p.ok) setPayouts(p.value)
  }

  useEffect(() => {
    void loadBasics()
  }, [])

  useEffect(() => {
    setPreview(null)
    setResult(null)
    if (!statement) return
    window.juno.previewEtsy({ statementText: statement.text, ordersText: orders?.text ?? null }).then((r) => {
      if (!r.ok) {
        setError(r.error)
        return
      }
      setError(null)
      setPreview(r.value)
      setMapping(r.value.mapping)
      setDepositId(r.value.depositAccountId)
    })
  }, [statement, orders, setup])

  if (!accounts || !setup) return <p>Loading…</p>
  const missing = setup.filter((a) => a.accountId === null)
  const categoryGroups = lineCategoryGroups(accounts, -1, -1)
  const balanceGroups = importAccountGroups(accounts)

  async function pick(set: (f: ImportFile) => void): Promise<void> {
    setError(null)
    const r = await window.juno.pickImportFile()
    if (!r.ok) setError(r.error)
    else if (r.value) set(r.value)
  }

  async function run(): Promise<void> {
    if (!statement) return
    setBusy(true)
    setError(null)
    const r = await window.juno.importEtsy({
      statementText: statement.text,
      ordersText: orders?.text ?? null,
      fileName: statement.fileName,
      mapping,
      depositAccountId: depositId
    })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setResult(r.value)
    onImported()
    const p = await window.juno.etsyPayouts()
    if (p.ok) setPayouts(p.value)
    const a = await window.juno.getChart()
    if (a) setAccounts(a.accounts)
  }

  const shownTargets = preview ? preview.totals.filter((t) => t.cents !== 0 || t.target === 'sales_tax') : []

  return (
    <section className="panel journal-entry etsy-import">
      <div className="chart-header">
        <h2>Import from Etsy</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        On Etsy, open Shop Manager → Finances → Monthly statements and download the month as a CSV. For shipping to be
        split out of sales, also download Settings → Options → Download Data → Orders (CSV) for the same month. JunoBooks
        posts one entry per day of Etsy activity and one transfer per deposit to your bank. Rows already imported are
        skipped, so importing the same month again is safe.
      </p>

      {missing.length > 0 && (
        <div className="accountant-note etsy-setup">
          <p>
            Etsy imports keep each kind of Etsy fee in its own account, plus an &ldquo;Etsy payment account&rdquo; for the
            money Etsy holds between sales and deposits. These accounts will be added to your chart:
          </p>
          <ul>
            {missing.map((a) => (
              <li key={a.name}>
                {a.number} {a.name}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              const r = await window.juno.addEtsyAccounts()
              if (!r.ok) setError(r.error)
              else {
                setSetup(r.value)
                const c = await window.juno.getChart()
                if (c) setAccounts(c.accounts)
              }
            }}
          >
            Add these accounts
          </button>
        </div>
      )}

      <div className="etsy-files">
        <div className="drop-zone">
          <span>
            <strong>Payments statement:</strong> {statement ? statement.fileName : <span className="muted">not chosen</span>}
          </span>
          <button type="button" onClick={() => void pick(setStatement)}>
            {statement ? 'Change…' : 'Choose statement…'}
          </button>
        </div>
        <div className="drop-zone">
          <span>
            <strong>Sold Orders (optional):</strong> {orders ? orders.fileName : <span className="muted">not chosen</span>}
          </span>
          <button type="button" onClick={() => void pick(setOrders)}>
            {orders ? 'Change…' : 'Choose orders file…'}
          </button>
          {orders && (
            <button type="button" className="link-button" onClick={() => setOrders(null)}>
              Remove
            </button>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {preview && !result && (
        <>
          <h3>What this statement holds</h3>
          <p className="hint">
            {preview.rows} rows: {preview.newRows} new
            {preview.alreadyImported > 0 && `, ${preview.alreadyImported} already imported (skipped)`}
            {preview.beforeBooksStart > 0 && `, ${preview.beforeBooksStart} before your books start (left out)`}. They
            become {preview.days} daily {preview.days === 1 ? 'entry' : 'entries'} and {preview.deposits.length}{' '}
            {preview.deposits.length === 1 ? 'deposit' : 'deposits'}.
            {preview.sales > 0 &&
              (preview.salesWithOrder === preview.sales
                ? ' Shipping is split out of every sale using the orders file.'
                : ` Shipping is split out of ${preview.salesWithOrder} of ${preview.sales} sales; the rest count fully as sales (add the Sold Orders file to split them).`)}
          </p>
          {preview.problems.length > 0 && (
            <p className="error">
              {preview.problems.length} {preview.problems.length === 1 ? 'row' : 'rows'} can&rsquo;t be read and will be
              left out: {preview.problems.slice(0, 3).map((p) => `row ${p.row} (${p.reason})`).join('; ')}
            </p>
          )}
          {preview.unknown.length > 0 && (
            <p className="accountant-note">
              Some rows are worded in a way JunoBooks doesn&rsquo;t recognize, so they go to &ldquo;Other Etsy activity&rdquo;
              below: {preview.unknown.map((u) => `${u.type} "${u.title}" (${formatCents(u.cents)})`).join('; ')}. Check
              the account chosen for them.
            </p>
          )}

          {preview.newRows > 0 && (
            <>
              <table className="chart-table etsy-map">
                <thead>
                  <tr>
                    <th>Etsy activity</th>
                    <th className="amount">Total</th>
                    <th>Goes to account</th>
                  </tr>
                </thead>
                <tbody>
                  {shownTargets.map((t) => (
                    <tr key={t.target}>
                      <td>{ETSY_TARGET_LABELS[t.target]}</td>
                      <td className="amount">{describe(t.target, t.cents)}</td>
                      <td className="review-account">
                        <AccountCombobox
                          groups={t.target === 'clearing' ? balanceGroups : categoryGroups}
                          value={mapping[t.target] ?? null}
                          onChange={(id) => setMapping({ ...mapping, [t.target]: id })}
                          label={`Account for ${ETSY_TARGET_LABELS[t.target]}`}
                        />
                      </td>
                    </tr>
                  ))}
                  {preview.deposits.length > 0 && (
                    <tr>
                      <td>
                        Deposits to your bank ({preview.deposits.length}:{' '}
                        {preview.deposits.map((d) => `${d.date} ${formatCents(d.cents)}`).join(', ')})
                      </td>
                      <td className="amount">
                        {formatCents(preview.deposits.reduce((s, d) => s + d.cents, 0))}
                      </td>
                      <td className="review-account">
                        <AccountCombobox groups={balanceGroups} value={depositId} onChange={setDepositId} label="Deposit account" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {shownTargets.some((t) => t.target === 'sales_tax') && (
                <p className="accountant-note">
                  <span aria-hidden="true">⚑ </span>
                  Check with your accountant: Etsy collects and pays sales tax for you in most states. It is recorded in
                  and out of its own account (so it nets to zero) and kept separate from your sales.
                </p>
              )}
              <div className="form-actions">
                <button type="button" className="primary" disabled={busy || missing.length > 0} onClick={() => void run()}>
                  Import {preview.newRows} Etsy {preview.newRows === 1 ? 'row' : 'rows'}
                </button>
                {missing.length > 0 && <span className="hint">Add the Etsy accounts above first.</span>}
              </div>
            </>
          )}
        </>
      )}

      {result && (
        <p className="success">
          Imported {result.rowsImported} rows: {result.entries} daily {result.entries === 1 ? 'entry' : 'entries'} and{' '}
          {result.deposits} {result.deposits === 1 ? 'deposit' : 'deposits'}.
          {result.alreadyImported > 0 && ` ${result.alreadyImported} rows were already imported.`}
        </p>
      )}

      <h3>Etsy deposits and your bank</h3>
      {payouts.length === 0 ? (
        <p className="muted">No Etsy deposits imported yet.</p>
      ) : (
        <>
          <p className="hint">
            Each Etsy deposit should show up in your bank account. Import the bank file too: its Etsy deposit lines are
            offered as a match in Review imported lines, so nothing is counted twice.
          </p>
          <table className="chart-table payouts">
            <thead>
              <tr>
                <th>Date</th>
                <th className="amount">Amount</th>
                <th>To</th>
                <th>Bank</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.entryId} className={`payout-${p.status}`}>
                  <td>{p.date}</td>
                  <td className="amount">{formatCents(p.cents)}</td>
                  <td>{p.depositAccountName}</td>
                  <td>
                    {PAYOUT_STATUS[p.status]}
                    {p.bankLineDate && ` (${p.bankLineDate})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

export default EtsyImport
