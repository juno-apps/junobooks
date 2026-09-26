import { useState, type FormEvent } from 'react'
import type { CompanyProfile } from '../../preload/types'
import { getEntityType, TAX_FORM_LABELS } from '../../shared/entities'
import { getStateName } from '../../shared/states'
import { TEMPLATES } from '../../shared/templates'
import ChartOfAccounts from './ChartOfAccounts'
import EntityTypeChange from './EntityTypeChange'
import HomeStateChange from './HomeStateChange'
import TemplatePicker from './TemplatePicker'

interface Props {
  company: CompanyProfile
  onChanged: (profile: CompanyProfile) => void
}

function CompanyHome({ company, onChanged }: Props): JSX.Element {
  const [changingEntity, setChangingEntity] = useState(false)
  const [changingState, setChangingState] = useState(false)
  /** Bumped after an entity change so the chart reloads (new accounts, new tax lines). */
  const [chartVersion, setChartVersion] = useState(0)
  const entity = getEntityType(company.entityType)
  const template = TEMPLATES.find((t) => t.id === company.template)
  return (
    <>
      <section className="panel">
        <h1>{company.name}</h1>
        <dl className="details">
          <dt>Entity type</dt>
          <dd>
            {entity.label}{' '}
            <button type="button" className="link-button" onClick={() => setChangingEntity((v) => !v)}>
              Change
            </button>
          </dd>
          <dt>Federal tax return</dt>
          <dd>{TAX_FORM_LABELS[entity.taxForm]}</dd>
          <dt>Home state</dt>
          <dd>
            {getStateName(company.homeState)}{' '}
            <button type="button" className="link-button" onClick={() => setChangingState((v) => !v)}>
              Change
            </button>
          </dd>
          <dt>Books start</dt>
          <dd>{company.booksStartDate}</dd>
          {template && (
            <>
              <dt>Chart of accounts</dt>
              <dd>{template.label} template</dd>
            </>
          )}
          <dt>Company folder</dt>
          <dd className="path">{company.dir}</dd>
        </dl>
      </section>
      {changingEntity && (
        <EntityTypeChange
          currentEntityType={company.entityType}
          onChanged={(profile) => {
            setChartVersion((v) => v + 1)
            onChanged(profile)
          }}
          onClose={() => setChangingEntity(false)}
        />
      )}
      {changingState && (
        <HomeStateChange
          currentState={company.homeState}
          onChanged={onChanged}
          onClose={() => setChangingState(false)}
        />
      )}
      {company.template ?<ChartOfAccounts key={`${company.folder}-${chartVersion}`} /> : <SetupChart onDone={onChanged} />}
    </>
  )
}

/** Shown once, for companies created before charts of accounts existed. */
function SetupChart({ onDone }: { onDone: (profile: CompanyProfile) => void }): JSX.Element {
  const [template, setTemplate] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!template) {
      setError('Choose a starting chart of accounts.')
      return
    }
    const result = await window.juno.setupChart(template)
    if (result.ok) onDone(result.value)
    else setError(result.error)
  }

  return (
    <section className="panel">
      <h2>Set up the chart of accounts</h2>
      <p>This company doesn&rsquo;t have a chart of accounts yet.</p>
      <form className="form" onSubmit={submit}>
        <TemplatePicker value={template} onChange={setTemplate} />
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="primary">
            Set up accounts
          </button>
        </div>
      </form>
    </section>
  )
}

export default CompanyHome
