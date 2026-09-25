import { useEffect, useState } from 'react'
import type { AppInfo, TestCompanyStatus } from '../../preload/types'

function App(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [testCompany, setTestCompany] = useState<TestCompanyStatus | null>(null)

  useEffect(() => {
    window.juno.getAppInfo().then(setInfo)
    window.juno.getTestCompanyStatus().then(setTestCompany)
  }, [])

  return (
    <div className="app">
      <main className="app-main">
        <h1>JunoBooks</h1>
        <p>Setup in progress. This screen will become the company switcher.</p>

        <section className="smoke-test">
          <h2>Database smoke test</h2>
          {testCompany ? (
            <>
              <p className="path">{testCompany.dbPath}</p>
              <ul>
                {testCompany.rows.map((row) => (
                  <li key={row.id}>
                    #{row.id} — {row.note} ({row.created_at})
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>loading…</p>
          )}
        </section>
      </main>
      <footer className="app-footer">
        {info ? `v${info.version} · built ${info.buildDate}` : 'loading version…'}
      </footer>
    </div>
  )
}

export default App
