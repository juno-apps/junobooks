import { useEffect, useState, type FormEvent } from 'react'
import type { CompanyProfile, EntryListItem } from '../../preload/types'
import { getEntityType, TAX_FORM_LABELS } from '../../shared/entities'
import { getStateName } from '../../shared/states'
import { TEMPLATES } from '../../shared/templates'
import ChartOfAccounts from './ChartOfAccounts'
import EntityTypeChange from './EntityTypeChange'
import HomeStateChange from './HomeStateChange'
import BankReview from './BankReview'
import DashboardPanel from './DashboardPanel'
import CloseBooks from './CloseBooks'
import AmazonImport from './AmazonImport'
import EtsyImport from './EtsyImport'
import Form1099K from './Form1099K'
import ImportWizard from './ImportWizard'
import Inventory from './Inventory'
import JournalEntry from './JournalEntry'
import OpeningBalances from './OpeningBalances'
import Reconcile from './Reconcile'
import AccountantPackage from './AccountantPackage'
import Reports from './Reports'
import YearEndRecords from './YearEndRecords'
import Sales from './Sales'
import SalesTax from './SalesTax'
import SimpleEntry, { type SimpleKind } from './SimpleEntry'
import TemplatePicker from './TemplatePicker'
import TransactionList from './TransactionList'
import TransferEntry from './TransferEntry'

interface Props {
  company: CompanyProfile
  onChanged: (profile: CompanyProfile) => void
}

function CompanyHome({ company, onChanged }: Props): JSX.Element {
  const [changingEntity, setChangingEntity] = useState(false)
  const [changingState, setChangingState] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  /** The entry screen: closed, an expense, income or transfer, a blank journal entry, or a copy of an existing entry. */
  const [entering, setEntering] = useState<
    | { kind: 'journal'; copyOf?: EntryListItem }
    | {
        kind:
          | SimpleKind
          | 'transfer'
          | 'opening'
          | 'import'
          | 'reconcile'
          | 'etsy'
          | 'inventory'
          | 'sales'
          | 'amazon'
          | '1099k'
          | 'salesTax'
          | 'reports'
          | 'records'
          | 'package'
          | 'close'
      }
    | { kind: 'review'; accountId: number | null }
    | null
  >(null)
  const [tab, setTab] = useState<'transactions' | 'chart'>('transactions')
  /** Bumped after anything that changes accounts or balances, so the chart and transaction list reload. */
  const [chartVersion, setChartVersion] = useState(0)
  const [entryKey, setEntryKey] = useState(0)

  const [toReview, setToReview] = useState(0)

  useEffect(() => {
    window.juno.reviewCounts().then((c) => setToReview(c.reduce((s, x) => s + x.count, 0)))
  }, [chartVersion, company.folder])

  function startEntry(
    kind:
      | 'journal'
      | 'transfer'
      | 'opening'
      | 'import'
      | 'reconcile'
      | 'etsy'
      | 'inventory'
      | 'sales'
      | 'amazon'
      | '1099k'
      | 'salesTax'
      | 'reports'
      | 'records'
      | 'package'
      | 'close'
      | SimpleKind,
    copyOf?: EntryListItem
  ): void {
    setEntering(kind === 'journal' ? { kind, copyOf } : { kind })
    setEntryKey((k) => k + 1)
  }

  function startReview(accountId: number | null): void {
    setEntering({ kind: 'review', accountId })
    setEntryKey((k) => k + 1)
  }
  const entity = getEntityType(company.entityType)
  const template = TEMPLATES.find((t) => t.id === company.template)
  return (
    <>
      <section className="panel home-panel">
        <h1>{company.name}</h1>
        <p className="company-line">
          {entity.label} · {TAX_FORM_LABELS[entity.taxForm]} · {getStateName(company.homeState)} · books start{' '}
          {company.booksStartDate}{' '}
          <button type="button" className="link-button" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? 'Hide details' : 'Details'}
          </button>
        </p>
        {showDetails && (
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
        )}
        {company.template && !entering && (
          <div className="home-groups">
            {(
              [
                [
                  'Enter',
                  [
                    ['New expense', 'expense', true],
                    ['New income', 'income', true],
                    ['New transfer', 'transfer', true],
                    ['New journal entry', 'journal', false],
                    ['Opening balances', 'opening', false]
                  ]
                ],
                [
                  'Bring in',
                  [
                    ['Import bank file', 'import', false],
                    ['Import from Etsy', 'etsy', false],
                    ['Import from Amazon', 'amazon', false],
                    ['Reconcile', 'reconcile', false]
                  ]
                ],
                [
                  'Sell and make',
                  [
                    ['Invoices', 'sales', false],
                    ['Inventory', 'inventory', false],
                    ['Sales tax', 'salesTax', false]
                  ]
                ],
                [
                  'Year end',
                  [
                    ['Reports', 'reports', false],
                    ['Year-end records', 'records', false],
                    ['1099-K tie-out', '1099k', false],
                    ['Accountant package', 'package', false],
                    ['Close books', 'close', false]
                  ]
                ]
              ] as [string, [string, Parameters<typeof startEntry>[0], boolean][]][]
            ).map(([title, buttons]) => (
              <div key={title} className="home-group">
                <span className="home-group-title">{title}</span>
                <div className="form-actions home-actions">
                  {buttons.map(([label, kind, primary]) => (
                    <button
                      key={label}
                      type="button"
                      className={primary ? 'primary' : ''}
                      onClick={() => startEntry(kind)}
                    >
                      {label}
                    </button>
                  ))}
                  {title === 'Bring in' && toReview > 0 && (
                    <button type="button" className="primary attention" onClick={() => startReview(null)}>
                      Review imported lines ({toReview})
                    </button>
                  )}
                </div>
              </div>
            ))}
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
      {entering?.kind === 'sales' && (
        <Sales key={entryKey} onChanged={() => setChartVersion((v) => v + 1)} onClose={() => setEntering(null)} />
      )}
      {entering?.kind === 'inventory' && (
        <Inventory key={entryKey} onChanged={() => setChartVersion((v) => v + 1)} onClose={() => setEntering(null)} />
      )}
      {entering?.kind === 'amazon' && (
        <AmazonImport
          key={entryKey}
          onImported={() => setChartVersion((v) => v + 1)}
          onClose={() => setEntering(null)}
        />
      )}
      {company.template && !entering && (
        <DashboardPanel
          version={chartVersion}
          onAction={(action) =>
            action === 'review' ? startReview(null) : startEntry(action === 'invoices' ? 'sales' : action)
          }
        />
      )}
      {entering?.kind === 'close' && (
        <CloseBooks
          key={entryKey}
          firstYear={Number(company.booksStartDate.slice(0, 4))}
          onChanged={() => setChartVersion((v) => v + 1)}
          onClose={() => setEntering(null)}
        />
      )}
      {entering?.kind === 'package' && (
        <AccountantPackage
          key={entryKey}
          firstYear={Number(company.booksStartDate.slice(0, 4))}
          onClose={() => setEntering(null)}
        />
      )}
      {entering?.kind === 'records' && (
        <YearEndRecords
          key={entryKey}
          firstYear={Number(company.booksStartDate.slice(0, 4))}
          onClose={() => setEntering(null)}
        />
      )}
      {entering?.kind === 'reports' && (
        <Reports
          key={entryKey}
          firstYear={Number(company.booksStartDate.slice(0, 4))}
          onClose={() => setEntering(null)}
        />
      )}
      {entering?.kind === 'salesTax' && (
        <SalesTax
          key={entryKey}
          homeState={company.homeState}
          firstYear={Number(company.booksStartDate.slice(0, 4))}
          onChanged={() => setChartVersion((v) => v + 1)}
          onClose={() => setEntering(null)}
        />
      )}
      {entering?.kind === '1099k' && (
        <Form1099K
          key={entryKey}
          firstYear={Number(company.booksStartDate.slice(0, 4))}
          onClose={() => setEntering(null)}
        />
      )}
      {entering?.kind === 'etsy' && (
        <EtsyImport key={entryKey} onImported={() => setChartVersion((v) => v + 1)} onClose={() => setEntering(null)} />
      )}
      {entering?.kind === 'reconcile' && (
        <Reconcile
          key={entryKey}
          initialAccountId={null}
          onChanged={() => setChartVersion((v) => v + 1)}
          onClose={() => setEntering(null)}
        />
      )}
      {entering?.kind === 'import' && (
        <ImportWizard
          key={entryKey}
          onImported={() => setChartVersion((v) => v + 1)}
          onReview={(id) => startReview(id)}
          onClose={() => setEntering(null)}
        />
      )}
      {entering?.kind === 'review' && (
        <BankReview
          key={entryKey}
          initialAccountId={entering.accountId}
          onPosted={() => setChartVersion((v) => v + 1)}
          onClose={() => {
            setEntering(null)
            setChartVersion((v) => v + 1)
          }}
        />
      )}
      {entering?.kind === 'opening' && (
        <OpeningBalances
          key={entryKey}
          onSaved={() => setChartVersion((v) => v + 1)}
          onClose={() => setEntering(null)}
        />
      )}
      {entering?.kind === 'transfer' && (
        <TransferEntry
          key={entryKey}
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
            <button
              type="button"
              className={tab === 'transactions' ? 'tab active' : 'tab'}
              onClick={() => setTab('transactions')}
            >
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
