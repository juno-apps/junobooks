import { useEffect, useState } from 'react'
import type { AppInfo } from '../../preload/types'

function App(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    window.juno.getAppInfo().then(setInfo)
  }, [])

  return (
    <div className="app">
      <main className="app-main">
        <h1>JunoBooks</h1>
        <p>Setup in progress. This screen will become the company switcher.</p>
      </main>
      <footer className="app-footer">
        {info ? `v${info.version} · built ${info.buildDate}` : 'loading version…'}
      </footer>
    </div>
  )
}

export default App
