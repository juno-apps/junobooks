import { useState } from 'react'
import type { CompanyProfile, CompanySummary } from '../../preload/types'
import { getEntityType } from '../../shared/entities'
import { getStateName } from '../../shared/states'

interface Props {
  companies: CompanySummary[]
  currentFolder: string | null
  onOpened: (profile: CompanyProfile) => void
  onNew: () => void
}

function CompanyPicker({ companies, currentFolder, onOpened, onNew }: Props): JSX.Element {
  const [error, setError] = useState<string | null>(null)

  async function open(folder: string): Promise<void> {
    setError(null)
    const result = await window.juno.openCompany(folder)
    if (result.ok) onOpened(result.value)
    else setError(result.error)
  }

  return (
    <section className="panel">
      <h1>Choose a company</h1>
      {error && <p className="error">{error}</p>}
      <ul className="company-list">
        {companies.map((c) => (
          <li key={c.folder}>
            <button className={c.folder === currentFolder ? 'company-row current' : 'company-row'} onClick={() => open(c.folder)}>
              <span className="company-name">{c.name}</span>
              <span className="company-meta">
                {getEntityType(c.entityType).label} · {getStateName(c.homeState)}
                {c.folder === currentFolder && ' · open now'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="primary" onClick={onNew}>
        + New company
      </button>
    </section>
  )
}

export default CompanyPicker
