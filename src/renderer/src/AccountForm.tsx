import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AccountInput, ChartAccount, ChartView, Result } from '../../preload/types'
import {
  ACCOUNT_TYPES,
  numberRangeWarning,
  SUBTYPE_OPTIONS,
  SYSTEM_SUBTYPES,
  validateAccountInput
} from '../../shared/accounts'
import { getTaxLine, TAX_CATEGORIES, type AccountType } from '../../shared/taxLines'
import type { AccountSubtype } from '../../shared/templates'

interface Props {
  /** null = adding a new account. */
  account: ChartAccount | null
  chart: ChartView
  onDone: (chart: ChartView) => void
  onCancel: () => void
}

function initialInput(a: ChartAccount | null): AccountInput {
  if (!a) return { number: '', name: '', type: 'expense', subtype: '', taxCategory: '', description: '' }
  return {
    number: a.number,
    name: a.name,
    type: a.type,
    subtype: a.subtype as AccountSubtype,
    taxCategory: a.taxCategory ?? '',
    description: a.description
  }
}

function AccountForm({ account, chart, onDone, onCancel }: Props): JSX.Element {
  const [input, setInput] = useState<AccountInput>(() => initialInput(account))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const isSystem = account !== null && SYSTEM_SUBTYPES.includes(account.subtype as AccountSubtype)
  const typeLocked = isSystem || (account?.hasPostings ?? false)
  const subtypeOptions = SUBTYPE_OPTIONS[input.type]
  const categories = TAX_CATEGORIES.filter((c) => c.accountType === input.type)
  const warning = numberRangeWarning(input.type, input.taxCategory, input.number)
  const categoryChanged = account !== null && input.taxCategory !== (account.taxCategory ?? '')

  function set<K extends keyof AccountInput>(key: K, value: AccountInput[K]): void {
    setInput((prev) => ({ ...prev, [key]: value }))
  }

  function changeType(type: AccountType): void {
    setInput((prev) => ({ ...prev, type, subtype: '', taxCategory: '' }))
  }

  async function run(action: () => Promise<Result<ChartView>>): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (result.ok) onDone(result.value)
    else setError(result.error)
  }

  function submit(e: FormEvent): void {
    e.preventDefault()
    const problem = validateAccountInput(input)
    if (problem) {
      setError(problem)
      return
    }
    run(() => (account ? window.juno.updateAccount(account.id, input) : window.juno.addAccount(input)))
  }

  function remove(): void {
    if (!account) return
    if (!window.confirm(`Delete account ${account.number} ${account.name}? This can't be undone.`)) return
    run(() => window.juno.deleteAccount(account.id))
  }

  return (
    <section className="account-form" ref={ref}>
      <h3>{account ? `Edit account ${account.number} ${account.name}` : 'Add an account'}</h3>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label className="narrow">
            Number
            <input value={input.number} onChange={(e) => set('number', e.target.value)} autoFocus={!account} />
          </label>
          <label className="grow">
            Name
            <input value={input.name} onChange={(e) => set('name', e.target.value)} />
          </label>
        </div>
        {warning && <p className="warning">{warning}</p>}

        <div className="form-row">
          <label>
            Type
            <select
              value={input.type}
              disabled={typeLocked}
              onChange={(e) => changeType(e.target.value as AccountType)}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {isSystem ? (
            <label>
              Kind
              <span className="hint">A special account JunoBooks uses</span>
            </label>
          ) : (
            subtypeOptions.length > 0 && (
              <label className="grow">
                Kind
                <select
                  value={input.subtype}
                  disabled={typeLocked}
                  onChange={(e) => set('subtype', e.target.value as AccountSubtype)}
                >
                  {subtypeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )
          )}
        </div>
        {typeLocked && (
          <p className="hint">
            {isSystem
              ? "This account's type can't be changed."
              : "Type and kind are locked because this account has posted entries. You can still rename it or change its tax category."}
          </p>
        )}

        <label>
          Tax category
          <select value={input.taxCategory} onChange={(e) => set('taxCategory', e.target.value as AccountInput['taxCategory'])}>
            <option value="">Choose…</option>
            {categories.map((c) => {
              const line = getTaxLine(c.key, chart.form, chart.taxYear)
              return (
                <option key={c.key} value={c.key}>
                  {c.label} ({line.ref ? `${line.ref}: ${line.label}` : line.label})
                </option>
              )
            })}
          </select>
          <span className="hint">
            {input.type === 'expense' &&
              'Cost of goods sold categories put the account under "Cost of goods sold". '}
            {categoryChanged && 'Changing the tax category may add a note for your accountant to check.'}
          </span>
        </label>

        <label>
          Description (optional)
          <input value={input.description} onChange={(e) => set('description', e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy}>
            {account ? 'Save changes' : 'Add account'}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {account && (
            <span className="form-actions-right">
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => window.juno.setAccountActive(account.id, !account.isActive))}
              >
                {account.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
              {!account.usedInEntries && !isSystem && (
                <button type="button" className="danger" disabled={busy} onClick={remove}>
                  Delete
                </button>
              )}
            </span>
          )}
        </div>
        {account && account.usedInEntries && (
          <p className="hint">This account has been used in entries, so it can be deactivated but not deleted.</p>
        )}
      </form>
    </section>
  )
}

export default AccountForm
