import { useEffect, useState } from 'react'
import type {
  AmazonImportResult,
  AmazonMapping,
  AmazonPreview,
  ChartAccount,
  EtsyAccountStatus,
  EtsyPayout,
  ImportFile
} from '../../preload/types'
import { AMAZON_TARGET_LABELS, type AmazonTarget } from '../../shared/amazon'
import { importAccountGroups, lineCategoryGroups } from '../../shared/bankImport'
import { formatCents } from '../../shared/money'
import AccountCombobox from './AccountCombobox'
import { PayoutsTable } from './EtsyImport'

interface Props {
  onImported: () => void
  onClose: () => void
}

function describe(target: AmazonTarget, cents: number): string {
  if (target === 'sales_tax' && cents === 0) return 'nets to $0.00'
  if (target === 'clearing')
    return `${formatCents(Math.abs(cents))} ${cents >= 0 ? 'added to' : 'taken from'} what Amazon holds`
  return `${formatCents(Math.abs(cents))} ${cents < 0 ? 'in' : 'out'}`
}

/** Import an Amazon settlement report: one per settlement period (usually every two weeks). */
function AmazonImport({ onImported, onClose }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<ChartAccount[] | null>(null)
  const [setup, setSetup] = useState<EtsyAccountStatus[] | null>(null)
  const [file, setFile] = useState<ImportFile | null>(null)
  const [preview, setPreview] = useState<AmazonPreview | null>(null)
  const [mapping, setMapping] = useState<AmazonMapping>({})
  const [depositId, setDepositId] = useState<number | null>(null)
  const [result, setResult] = useState<AmazonImportResult | null>(null)
  const [payouts, setPayouts] = useState<EtsyPayout[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadBasics(): Promise<void> {
    const [chart, s, p] = await Promise.all([
      window.juno.getChart(),
      window.juno.amazonAccounts(),
      window.juno.amazonPayouts()
    ])
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
    if (!file) return
    window.juno.previewAmazon(file.text).then((r) => {
      if (!r.ok) return setError(r.error)
      setError(null)
      setPreview(r.value)
      setMapping(r.value.mapping)
      setDepositId(r.value.depositAccountId)
    })
  }, [file, setup])

  if (!accounts || !setup) return <p>Loading…</p>
  const missing = setup.filter((a) => a.accountId === null)
  const categoryGroups = lineCategoryGroups(accounts, -1, -1)
  const balanceGroups = importAccountGroups(accounts)
  const shown = preview ? preview.totals.filter((t) => t.cents !== 0 || t.target === 'sales_tax') : []

  async function run(): Promise<void> {
    if (!file) return
    setBusy(true)
    setError(null)
    const r = await window.juno.importAmazon({
      text: file.text,
      fileName: file.fileName,
      mapping,
      depositAccountId: depositId
    })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setResult(r.value)
    onImported()
    const p = await window.juno.amazonPayouts()
    if (p.ok) setPayouts(p.value)
  }

  return (
    <section className="panel journal-entry etsy-import">
      <div className="chart-header">
        <h2>Import from Amazon</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        In Seller Central, open Payments → Reports repository and download a settlement report (the &ldquo;flat
        file&rdquo;, a .txt file). Import each settlement once; importing it again is safe, anything already imported is
        skipped. JunoBooks posts one entry per day of activity and the settlement payout as a transfer to your bank.
      </p>

      {missing.length > 0 && (
        <div className="accountant-note etsy-setup">
          <p>
            Amazon imports keep each kind of Amazon fee in its own account, plus an &ldquo;Amazon payment
            account&rdquo;. These accounts will be added:
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
              const r = await window.juno.addAmazonAccounts()
              if (!r.ok) return setError(r.error)
              setSetup(r.value)
              const c = await window.juno.getChart()
              if (c) setAccounts(c.accounts)
            }}
          >
            Add these accounts
          </button>
        </div>
      )}

      <div className="etsy-files">
        <div className="drop-zone">
          <span>
            <strong>Settlement report:</strong> {file ? file.fileName : <span className="muted">not chosen</span>}
          </span>
          <button
            type="button"
            onClick={async () => {
              const r = await window.juno.pickImportFile()
              if (!r.ok) setError(r.error)
              else if (r.value) setFile(r.value)
            }}
          >
            {file ? 'Change…' : 'Choose settlement report…'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {preview && !result && (
        <>
          <h3>
            Settlement {preview.settlementId}
            {preview.startDate && preview.endDate && ` (${preview.startDate} to ${preview.endDate})`}
          </h3>
          <p className="hint">
            {preview.rows} rows: {preview.newRows} new
            {preview.alreadyImported > 0 && `, ${preview.alreadyImported} already imported (skipped)`}
            {preview.beforeBooksStart > 0 && `, ${preview.beforeBooksStart} before your books start (left out)`}. They
            become {preview.days} daily {preview.days === 1 ? 'entry' : 'entries'}
            {preview.deposit ? ` and a payout of ${formatCents(preview.deposit.cents)} on ${preview.deposit.date}` : ''}
            .
            {preview.reserveCents !== 0 &&
              ` Amazon ${preview.reserveCents < 0 ? 'held back' : 'released'} ${formatCents(Math.abs(preview.reserveCents))} of reserve; it stays in the Amazon payment account.`}
            {preview.depositAlreadyImported && ' The payout was imported before.'}
          </p>
          {preview.negativeTotalCents < 0 && (
            <p className="accountant-note">
              This settlement ends with {formatCents(-preview.negativeTotalCents)} owed to Amazon (no payout). Amazon
              usually charges it to your card on file; record that charge when it shows up.
            </p>
          )}
          {preview.problems.length > 0 && (
            <p className="error">
              {preview.problems.length} {preview.problems.length === 1 ? 'row' : 'rows'} can&rsquo;t be read and will be
              left out:{' '}
              {preview.problems
                .slice(0, 3)
                .map((p) => `row ${p.row} (${p.reason})`)
                .join('; ')}
            </p>
          )}
          {preview.unknown.length > 0 && (
            <p className="accountant-note">
              Some rows aren&rsquo;t recognized and go to &ldquo;Other Amazon activity&rdquo;:{' '}
              {preview.unknown
                .map((u) => `${u.transactionType} / ${u.amountType} / ${u.description} (${formatCents(u.cents)})`)
                .join('; ')}
              .
            </p>
          )}
          {(preview.newRows > 0 || preview.deposit) && (
            <>
              <table className="chart-table etsy-map">
                <thead>
                  <tr>
                    <th>Amazon activity</th>
                    <th className="amount">Total</th>
                    <th>Goes to account</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.target}>
                      <td>{AMAZON_TARGET_LABELS[t.target]}</td>
                      <td className="amount">{describe(t.target, t.cents)}</td>
                      <td className="review-account">
                        <AccountCombobox
                          groups={t.target === 'clearing' ? balanceGroups : categoryGroups}
                          value={mapping[t.target] ?? null}
                          onChange={(id) => setMapping({ ...mapping, [t.target]: id })}
                          label={`Account for ${AMAZON_TARGET_LABELS[t.target]}`}
                        />
                      </td>
                    </tr>
                  ))}
                  {!shown.some((t) => t.target === 'clearing') && preview.deposit && (
                    <tr>
                      <td>{AMAZON_TARGET_LABELS.clearing}</td>
                      <td />
                      <td className="review-account">
                        <AccountCombobox
                          groups={balanceGroups}
                          value={mapping.clearing ?? null}
                          onChange={(id) => setMapping({ ...mapping, clearing: id })}
                          label={`Account for ${AMAZON_TARGET_LABELS.clearing}`}
                        />
                      </td>
                    </tr>
                  )}
                  {preview.deposit && (
                    <tr>
                      <td>Payout to your bank ({preview.deposit.date})</td>
                      <td className="amount">{formatCents(preview.deposit.cents)}</td>
                      <td className="review-account">
                        <AccountCombobox
                          groups={balanceGroups}
                          value={depositId}
                          onChange={setDepositId}
                          label="Payout account"
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="accountant-note">
                <span aria-hidden="true">⚑ </span>
                Check with your accountant: Amazon collects and pays sales tax for you; it is recorded in and out of its
                own account (nets to zero). Promotions are recorded with refunds as reductions of sales.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy || missing.length > 0}
                  onClick={() => void run()}
                >
                  Import settlement
                </button>
                {missing.length > 0 && <span className="hint">Add the Amazon accounts above first.</span>}
              </div>
            </>
          )}
        </>
      )}
      {result && (
        <p className="success">
          Imported {result.rowsImported} rows: {result.entries} daily {result.entries === 1 ? 'entry' : 'entries'}
          {result.deposits ? ' and the payout' : ''}.
        </p>
      )}

      <h3>Amazon payouts and your bank</h3>
      <PayoutsTable payouts={payouts} channel="Amazon" />
    </section>
  )
}

export default AmazonImport
