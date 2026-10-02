import { useEffect, useState } from 'react'
import type { AppInfo, CompanyProfile, CompanySummary } from '../../preload/types'
import CompanyHome from './CompanyHome'
import CompanyPicker from './CompanyPicker'
import NewCompanyForm from './NewCompanyForm'
import Settings from './Settings'

type View = 'home' | 'picker' | 'new' | 'settings'

function App(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null)
  const [current, setCurrent] = useState<CompanyProfile | null>(null)
  const [view, setView] = useState<View>('home')

  async function refresh(): Promise<void> {
    const [list, cur] = await Promise.all([window.juno.listCompanies(), window.juno.getCurrentCompany()])
    setCompanies(list)
    setCurrent(cur)
  }

  useEffect(() => {
    window.juno.getAppInfo().then(setInfo)
    refresh()
  }, [])

  async function opened(profile: CompanyProfile): Promise<void> {
    setCurrent(profile)
    setView('home')
    setCompanies(await window.juno.listCompanies())
  }

  let body: JSX.Element
  if (companies === null) {
    body = <p>Loading…</p>
  } else if (view === 'settings') {
    body = <Settings onFolderChanged={() => void refresh()} onClose={() => setView(current ? 'home' : 'picker')} />
  } else if (view === 'new' || companies.length === 0) {
    body = (
      <NewCompanyForm
        isFirst={companies.length === 0}
        onCreated={opened}
        onCancel={companies.length > 0 ? () => setView(current ? 'home' : 'picker') : undefined}
      />
    )
  } else if (view === 'picker' || !current) {
    body = (
      <CompanyPicker
        companies={companies}
        currentFolder={current?.folder ?? null}
        onOpened={opened}
        onNew={() => setView('new')}
      />
    )
  } else {
    body = <CompanyHome company={current} onChanged={setCurrent} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">JunoBooks</span>
        {current && view === 'home' && (
          <>
            <span className="current-company">{current.name}</span>
            <button className="link-button" onClick={() => setView('picker')}>
              Switch company
            </button>
          </>
        )}
        {view !== 'settings' && (
          <button className="link-button header-settings" onClick={() => setView('settings')}>
            Settings
          </button>
        )}
      </header>
      <main className="app-main">{body}</main>
      <footer className="app-footer">
        {info ? `v${info.version} · built ${info.buildDate}` : 'loading version…'}
      </footer>
    </div>
  )
}

export default App
