import { useState, type FormEvent } from 'react'
import type { CompanyProfile, NewCompanyInput } from '../../preload/types'
import { validateNewCompany } from '../../shared/company'
import { ENTITY_TYPES, getEntityType, isEntityTypeId, TAX_FORM_LABELS } from '../../shared/entities'
import { DEFAULT_STATE, US_STATES } from '../../shared/states'
import TemplatePicker from './TemplatePicker'

interface Props {
  isFirst: boolean
  onCreated: (profile: CompanyProfile) => void
  onCancel?: () => void
}

function NewCompanyForm({ isFirst, onCreated, onCancel }: Props): JSX.Element {
  const [input, setInput] = useState<NewCompanyInput>({
    name: '',
    entityType: '',
    homeState: DEFAULT_STATE,
    booksStartDate: `${new Date().getFullYear()}-01-01`,
    template: ''
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function set<K extends keyof NewCompanyInput>(key: K, value: NewCompanyInput[K]): void {
    setInput((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const problem = validateNewCompany(input)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    const result = await window.juno.createCompany(input)
    setSaving(false)
    if (result.ok) onCreated(result.value)
    else setError(result.error)
  }

  const entity = isEntityTypeId(input.entityType) ? getEntityType(input.entityType) : null

  return (
    <section className="panel">
      <h1>{isFirst ? 'Welcome to JunoBooks' : 'New company'}</h1>
      {isFirst && <p>Start by setting up your first company.</p>}
      <form className="form" onSubmit={submit}>
        <label>
          Company name
          <input value={input.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </label>

        <label>
          Entity type
          <select value={input.entityType} onChange={(e) => set('entityType', e.target.value)}>
            <option value="">Choose…</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {entity && (
            <span className="hint">
              {entity.hint} Files {TAX_FORM_LABELS[entity.taxForm]}.
            </span>
          )}
        </label>

        <label>
          Home state
          <select value={input.homeState} onChange={(e) => set('homeState', e.target.value)}>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="hint">You can change this later if the business moves.</span>
        </label>

        <label>
          Books start date
          <input type="date" value={input.booksStartDate} onChange={(e) => set('booksStartDate', e.target.value)} />
          <span className="hint">The first day these books cover, usually January 1.</span>
        </label>

        <TemplatePicker value={input.template} onChange={(t) => set('template', t)} />

        {error && <p className="error">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create company'}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  )
}

export default NewCompanyForm
