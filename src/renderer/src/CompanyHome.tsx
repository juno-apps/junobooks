import { useState, type FormEvent } from 'react'
import type { CompanyProfile, EntryListItem } from '../../preload/types'
import { getEntityType, TAX_FORM_LABELS } from '../../shared/entities'
import { getStateName } from '../../shared/states'
import { TEMPLATES } from '../../shared/templates'
import ChartOfAccounts from './ChartOfAccounts'
import EntityTypeChange from './EntityTypeChange'
import HomeStateChange from './HomeStateChange'
import JournalEntry from './JournalEntry'
import SimpleEntry, { type SimpleKind } from './SimpleEntry'
import TemplatePicker from './TemplatePicker'
import TransactionList from './TransactionList'

interface Props {
  company: CompanyProfile
  onChanged: (profile: CompanyProfile) => void
}

function CompanyHome({ company, onChanged }: Props): JSX.Element {
  const [changingEntity, setChangingEntity] = useState(false)
  const [changingState, setChangingState] = useState(false)
  /** The entry screen: closed, an expense or income, a blank journal entry, or a copy of an existing entry. */
  const [entering, setEntering] = useState<{ kind: 'journal'; copyOf?: EntryListItem } | { kind: SimpleKind } | null>(null)
  const [tab, setTab] = useState<'transactions' | 'chart'>('transactions')
  /** Bumped after anything that changes accounts or balances, so the chart and transaction list reload. */
  const [chartVersion, setChartVersion] = useState(0)
  const [entryKey, setEntryKey] = useState(0)

  function startEntry(kind: 'journal' | SimpleKind, copyOf?: EntryListItem): void {
    setEntering(kind === 'journal' ? { kind, copyOf } : { kind })
    setEntryKey((k) => k + 1)
  }
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
        {company.template && !entering && (
          <div className="form-actions home-actions">
            <button type="button" className="primary" onClick={() => startEntry('expense')}>
              New expense
            </button>
            <button type="button" className="primary" onClick={() => startEntry('income')}>
              New income
            </button>
            <button type="button" onClick={() => startEntry('journal')}>
              New journal entry
            </button>
          </div>
        )}
      </section>
      {entering?.kind === 'journal' && (
        <JournalEntry
          key={entryKey}
          copyOf={entering.copyOf}
          onPosted={() => setChartVersion((v) => v + 1)}
          onClose={() => setEntering(null)}
        />
      )}
      {(entering?.kind === 'expense' || entering?.kind === 'income') && (
        <SimpleEntry
          key={entryKey}
          kind={entering.kind}
          onPosted={() => setChartVersion((v) => v + 1)}
          onClose={() => setEntering(null)}
        />
      )}
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
      {company.template ? (
        <>
          <div className="tabs">
            <button type="button" className={tab === 'transactions' ? 'tab active' : 'tab'} onClick={() => setTab('transactions')}>
              Transactions
            </button>
            <button type="button" className={tab === 'chart' ? 'tab active' : 'tab'} onClick={() => setTab('chart')}>
              Chart of accounts
            </button>
          </div>
          {tab === 'transactions' ? (
            <TransactionList
              key={company.folder}
              version={chartVersion}
              onChanged={() => setChartVersion((v) => v + 1)}
              onDuplicate={(e) => {
                startEntry('journal', e)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          ) : (
            <ChartOfAccounts key={`${company.folder}-${chartVersion}`} />
          )}
        </>
      ) : (
        <SetupChart onDone={onChanged} />
      )}
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
