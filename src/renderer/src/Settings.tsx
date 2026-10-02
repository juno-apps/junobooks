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
        next.companyCount === 0 ? 'There are no companies there yet.' : `It holds ${next.companyCount} ${next.companyCount === 1 ? 'company' : 'companies'}.`
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
        Each company folder holds its books file, receipts, automatic backups (the newest {view.backupsKept} are kept) and
        exports.
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
    </section>
  )
}

export default Settings
