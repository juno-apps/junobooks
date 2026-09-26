import { useEffect, useState, type FormEvent } from 'react'
import type { CompanyHistory, CompanyProfile, EntityChangeResult } from '../../preload/types'
import {
  ENTITY_CHANGE_NOTE,
  ENTITY_TYPES,
  getEntityType,
  isEntityTypeId,
  TAX_FORM_LABELS,
  type EntityTypeId
} from '../../shared/entities'
import { localDateString } from '../../shared/dates'

interface Props {
  currentEntityType: string
  onChanged: (profile: CompanyProfile) => void
  onClose: () => void
}

function EntityTypeChange({ currentEntityType, onChanged, onClose }: Props): JSX.Element {
  const [history, setHistory] = useState<CompanyHistory | null>(null)
  const [entityType, setEntityType] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(localDateString())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [summary, setSummary] = useState<EntityChangeResult | null>(null)
  const [correcting, setCorrecting] = useState(false)
  const [correctTo, setCorrectTo] = useState('')
  const [correctError, setCorrectError] = useState<string | null>(null)

  useEffect(() => {
    void window.juno.getHistory().then(setHistory)
  }, [currentEntityType])

  async function remove(date: string, label: string): Promise<void> {
    if (!window.confirm(`Remove the change to ${label} starting ${date}? Accounts it added stay in the chart.`)) return
    setError(null)
    setSummary(null)
    const result = await window.juno.removeEntityTypeChange(date)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setHistory(await window.juno.getHistory())
    onChanged(result.value)
  }

  async function correct(): Promise<void> {
    setCorrectError(null)
    const result = await window.juno.correctStartingEntityType(correctTo)
    if (!result.ok) {
      setCorrectError(result.error)
      return
    }
    setCorrecting(false)
    setSummary(result.value)
    setHistory(await window.juno.getHistory())
    onChanged(result.value.profile)
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!isEntityTypeId(entityType)) {
      setError('Choose the new entity type.')
      return
    }
    setSaving(true)
    setError(null)
    setSummary(null)
    const result = await window.juno.changeEntityType({ entityType, effectiveDate })
    setSaving(false)
    if (result.ok) {
      setEntityType('')
      setSummary(result.value)
      onChanged(result.value.profile)
    } else {
      setError(result.error)
    }
  }

  const chosen = isEntityTypeId(entityType) ? getEntityType(entityType) : null

  return (
    <section className="panel">
      <h2>Change entity type</h2>
      {history && (
        <table className="chart-table history-table">
          <thead>
            <tr>
              <th>Starts</th>
              <th>Entity type</th>
              <th>Federal return</th>
            </tr>
          </thead>
          <tbody>
            {history.entityTypes.map((row, i) => {
              const type = getEntityType(row.value as EntityTypeId)
              return (
                <tr key={row.effectiveDate}>
                  <td>{row.effectiveDate}</td>
                  <td>
                    {type.label}
                    {i === 0 && !correcting && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            setCorrectTo('')
                            setCorrectError(null)
                            setCorrecting(true)
                          }}
                        >
                          Correct starting type
                        </button>
                      </>
                    )}
                    {i === 0 && correcting && (
                      <div className="form">
                        <select value={correctTo} onChange={(e) => setCorrectTo(e.target.value)}>
                          <option value="">Choose the right starting type…</option>
                          {ENTITY_TYPES.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <span className="hint">
                          Use this only if the type your books started with was entered wrong. It replaces the
                          starting type; it isn&rsquo;t a change during the year. Accounts already in the chart are
                          left alone.
                        </span>
                        {correctError && <p className="error">{correctError}</p>}
                        <div className="form-actions">
                          <button type="button" className="primary" onClick={() => void correct()} disabled={!correctTo}>
                            Save correction
                          </button>
                          <button type="button" onClick={() => setCorrecting(false)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {i > 0 && (
                      <>
                        {' '}
                        <button type="button" className="link-button" onClick={() => void remove(row.effectiveDate, type.label)}>
                          Remove
                        </button>
                        <div className="accountant-note">⚑ {ENTITY_CHANGE_NOTE}</div>
                      </>
                    )}
                  </td>
                  <td>{TAX_FORM_LABELS[type.taxForm]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {summary && <ChangeSummary result={summary} />}

      <form className="form" onSubmit={submit}>
        <label>
          New entity type
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">Choose…</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {chosen && (
            <span className="hint">
              {chosen.hint} Files {TAX_FORM_LABELS[chosen.taxForm]}.
            </span>
          )}
        </label>

        <label>
          Starts on
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          <span className="hint">
            The first day the new type applies. It can&rsquo;t be before your books start or in a closed period.
          </span>
        </label>

        <p className="accountant-note">⚑ {ENTITY_CHANGE_NOTE}</p>

        {error && <p className="error">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save change'}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </section>
  )
}

/** Says what the change did to the chart of accounts. */
function ChangeSummary({ result }: { result: EntityChangeResult }): JSX.Element {
  const { added, notAdded, covered } = result
  return (
    <div className="change-summary">
      <p>
        <strong>Saved.</strong>{' '}
        {added.length === 0
          ? 'No accounts needed to be added to the chart.'
          : `Added ${added.length} account${added.length === 1 ? '' : 's'} to the chart:`}
      </p>
      {added.length > 0 && (
        <ul>
          {added.map((a) => (
            <li key={a.number}>
              {a.number} {a.name}
              {a.number !== a.wantedNumber && ` (usual number ${a.wantedNumber} is already used by another account)`}
            </li>
          ))}
        </ul>
      )}
      {covered.length > 0 && (
        <>
          <p>Not added, because an account you already have does the same job:</p>
          <ul>
            {covered.map((c) => (
              <li key={c.number}>
                {c.name}: {c.by} ({c.number}) already covers it
              </li>
            ))}
          </ul>
        </>
      )}
      {notAdded.length > 0 && (
        <p className="error">
          Couldn&rsquo;t add (no free number in the range):{' '}
          {notAdded.map((a) => `${a.number} ${a.name}`).join(', ')}. Add {notAdded.length === 1 ? 'it' : 'them'} by hand
          from the chart screen.
        </p>
      )}
      <p className="hint">
        Existing accounts were left as they are. Old-type accounts (such as Owner&rsquo;s capital) stay so past records
        keep making sense; check with your accountant how equity should be moved over.
      </p>
    </div>
  )
}

export default EntityTypeChange
