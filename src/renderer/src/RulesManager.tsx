import { useEffect, useState } from 'react'
import type { CategorizationRule, ChartAccount, RuleInput } from '../../preload/types'
import type { AccountGroup } from '../../shared/everyday'
import AccountCombobox from './AccountCombobox'

/** The fields of one rule, used to add a rule from an imported line and to edit one. */
export function RuleForm({
  initial,
  accounts,
  categoryGroups,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial: RuleInput
  accounts: ChartAccount[]
  categoryGroups: AccountGroup[]
  submitLabel: string
  onSubmit: (input: RuleInput) => Promise<string | null>
  onCancel: () => void
}): JSX.Element {
  const [input, setInput] = useState<RuleInput>(initial)
  const [error, setError] = useState<string | null>(null)
  const bank = accounts.find((a) => a.id === initial.bankAccountId) ?? null
  const [onlyThisBank, setOnlyThisBank] = useState(initial.bankAccountId !== null)
  const [bankId] = useState(initial.bankAccountId)

  return (
    <form
      className="form rule-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const problem = await onSubmit({ ...input, bankAccountId: onlyThisBank ? bankId : null })
        setError(problem)
      }}
    >
      <div className="form-row">
        <label className="grow">
          When the bank description contains
          <input
            autoFocus
            value={input.matchText}
            onChange={(e) => setInput({ ...input, matchText: e.target.value })}
          />
        </label>
        <label className="grow">
          use this account
          <AccountCombobox
            groups={categoryGroups}
            value={input.accountId}
            onChange={(id) => setInput({ ...input, accountId: id })}
            label="Rule account"
          />
        </label>
        <label className="grow">
          and this memo (optional)
          <input
            value={input.payee}
            placeholder="the bank description"
            onChange={(e) => setInput({ ...input, payee: e.target.value })}
          />
        </label>
      </div>
      {bank && (
        <label className="toggle">
          <input type="checkbox" checked={onlyThisBank} onChange={(e) => setOnlyThisBank(e.target.checked)} />
          Only for lines imported into {bank.name}
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Every categorization rule: edit, turn off, delete. */
function RulesManager({
  accounts,
  categoryGroups,
  onChanged,
  onClose
}: {
  accounts: ChartAccount[]
  categoryGroups: AccountGroup[]
  onChanged: () => void
  onClose: () => void
}): JSX.Element {
  const [rules, setRules] = useState<CategorizationRule[] | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nameOf = (id: number | null): string =>
    id === null ? '' : (accounts.find((a) => a.id === id)?.name ?? '(deleted account)')

  useEffect(() => {
    window.juno.listRules().then((r) => (r.ok ? setRules(r.value) : setError(r.error)))
  }, [])

  async function apply(p: ReturnType<typeof window.juno.listRules>): Promise<string | null> {
    const r = await p
    if (!r.ok) return r.error
    setRules(r.value)
    setEditing(null)
    onChanged()
    return null
  }

  return (
    <div className="rules-manager">
      <div className="chart-header">
        <h3>Categorization rules</h3>
        <button type="button" className="link-button" onClick={onClose}>
          Hide rules
        </button>
      </div>
      <p className="hint">
        Rules fill in the account (and memo) for imported lines whose bank description contains the words. You still
        review and post each line. When several rules fit, the one with the longest words wins.
      </p>
      {error && <p className="error">{error}</p>}
      {rules && rules.length === 0 && (
        <p className="muted">No rules yet. Use &ldquo;Make a rule…&rdquo; on an imported line.</p>
      )}
      {rules && rules.length > 0 && (
        <table className="chart-table rules-table">
          <thead>
            <tr>
              <th>Description contains</th>
              <th>Account</th>
              <th>Memo</th>
              <th>Applies to</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) =>
              editing === r.id ? (
                <tr key={r.id}>
                  <td colSpan={5}>
                    <RuleForm
                      initial={{
                        matchText: r.matchText,
                        accountId: r.accountId,
                        payee: r.payee,
                        bankAccountId: r.bankAccountId
                      }}
                      accounts={accounts}
                      categoryGroups={categoryGroups}
                      submitLabel="Save rule"
                      onSubmit={(input) => apply(window.juno.updateRule(r.id, { ...input, isActive: r.isActive }))}
                      onCancel={() => setEditing(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className={r.isActive ? '' : 'inactive'}>
                  <td>&ldquo;{r.matchText}&rdquo;</td>
                  <td>{nameOf(r.accountId)}</td>
                  <td>{r.payee || <span className="muted">(bank description)</span>}</td>
                  <td>{r.bankAccountId === null ? 'Any account' : nameOf(r.bankAccountId)}</td>
                  <td className="row-actions">
                    <button type="button" className="link-button" onClick={() => setEditing(r.id)}>
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        void apply(
                          window.juno.updateRule(r.id, {
                            matchText: r.matchText,
                            accountId: r.accountId,
                            payee: r.payee,
                            bankAccountId: r.bankAccountId,
                            isActive: !r.isActive
                          })
                        ).then((p) => p && setError(p))
                      }
                    >
                      {r.isActive ? 'Turn off' : 'Turn on'}
                    </button>{' '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void apply(window.juno.deleteRule(r.id))}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default RulesManager
