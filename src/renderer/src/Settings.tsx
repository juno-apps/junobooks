import { useEffect, useState } from 'react'
import type { SettingsView } from '../../preload/types'

interface Props {
  /** Called after the data folder changes, so the company list reloads. */
  onFolderChanged: () => void
  onClose: () => void
}

function Settings({ onFolderChanged, onClose }: Props): JSX.Element {
  const [view, setView] = useState<SettingsView | null>(null)
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)

  useEffect(() => {
    window.juno.getSettings().then(setView)
  }, [])

  if (!view) return <p>Loading settings…</p>

  function changed(next: SettingsView): void {
    setView(next)
    setMessage({
      text: `JunoBooks now uses ${next.dataRoot}. ${
        next.companyCount === 0
          ? 'There are no companies there yet.'
          : `It holds ${next.companyCount} ${next.companyCount === 1 ? 'company' : 'companies'}.`
      }`,
      bad: false
    })
    onFolderChanged()
  }

  async function choose(): Promise<void> {
    setMessage(null)
    const r = await window.juno.chooseDataFolder()
    if (!r.ok) setMessage({ text: r.error, bad: true })
    else if (r.value) changed(r.value)
  }

  async function use(dir: string | null): Promise<void> {
    setMessage(null)
    const r = await window.juno.useDataFolder(dir)
    if (!r.ok) setMessage({ text: r.error, bad: true })
    else changed(r.value)
  }

  return (
    <section className="panel settings">
      <div className="chart-header">
        <h1>Settings</h1>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>

      <h2>Where your books are kept</h2>
      <p className="path">{view.dataRoot}</p>
      <p className="hint">
        {view.companyCount === 0
          ? 'No companies here yet.'
          : `${view.companyCount} ${view.companyCount === 1 ? 'company' : 'companies'} here, each in its own folder under "Companies".`}{' '}
        Each company folder holds its books file, receipts, automatic backups (the newest {view.backupsKept} are kept)
        and exports.
        {view.isDefault ? ' This is the standard folder.' : ` The standard folder is ${view.defaultRoot}.`}
      </p>
      {view.isDev && (
        <p className="hint">
          This is a development copy of JunoBooks, so it only uses folders inside the project&rsquo;s test data, never
          your real books.
        </p>
      )}
      <div className="form-actions">
        <button type="button" onClick={() => void window.juno.openDataFolder()}>
          Open folder
        </button>
        <button type="button" onClick={() => void choose()}>
          Use a different folder…
        </button>
        {!view.isDefault && (
          <button type="button" onClick={() => void use(null)}>
            Use the standard folder
          </button>
        )}
      </div>
      <p className="hint">
        Changing the folder doesn&rsquo;t move or copy anything: JunoBooks just looks for companies in the folder you
        choose. To move your books, close JunoBooks, move the whole folder in File Explorer, then choose its new place
        here.
      </p>

      {view.oldTestData && (
        <div className="accountant-note">
          Earlier test versions of JunoBooks kept {view.oldTestData.companyCount} practice{' '}
          {view.oldTestData.companyCount === 1 ? 'company' : 'companies'} in {view.oldTestData.path}. They are still
          there.{' '}
          <button type="button" className="link-button" onClick={() => void use(view.oldTestData!.path)}>
            Use that folder
          </button>
        </div>
      )}

      {message && <p className={message.bad ? 'error' : 'success'}>{message.text}</p>}

      <h2>Tax forms and future years</h2>
      <p className="hint">
        JunoBooks does not download tax forms. Dates work for any year, and your books carry on year after year. What
        changes with time is a small amount of built-in tax information:
      </p>
      <ul className="hint">
        <li>
          <strong>Which line of the IRS form each account goes on</strong> (Schedule C, 1065, 1120-S, 1120). These
          line numbers are built into the program, one table per form year. The IRS changes them only now and then.
          When a new year&rsquo;s forms come out, a new version of JunoBooks is released with that year&rsquo;s table,
          and the program updates itself when this PC is online (it checks each time it starts). Until then it uses the
          most recent table it has and says so on the Chart of accounts and in the tax-line report (for example &ldquo;the
          2027 forms aren&rsquo;t out yet&rdquo;). Your entries and balances are never affected, only the line labels.
        </li>
        <li>
          <strong>The 1099-NEC reporting amount</strong> is also built in ($600 through 2025, $2,000 from 2026) and
          follows the same update route. Your accountant has the final say on what must be reported.
        </li>
        <li>
          <strong>Typed by you, so nothing to download:</strong> sales tax rates (Sales tax screen) and the mileage
          rate and home-office figures for each year (Year-end records).
        </li>
      </ul>
      <p className="hint">
        The official forms and instructions are free at irs.gov/forms-instructions. JunoBooks does not fill them in:
        the Accountant package gives your accountant the figures, grouped by form line.
      </p>
    </section>
  )
}

export default Settings
