import { useEffect, useState, type FormEvent } from 'react'
import type { CompanyHistory, CompanyProfile } from '../../preload/types'
import { localDateString } from '../../shared/dates'
import { getStateName, HOME_STATE_CHANGE_NOTE, US_STATES } from '../../shared/states'

interface Props {
  currentState: string
  onChanged: (profile: CompanyProfile) => void
  onClose: () => void
}

function StateSelect(props: {
  value: string
  onChange: (code: string) => void
  placeholder: string
}): JSX.Element {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{props.placeholder}</option>
      {US_STATES.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name}
        </option>
      ))}
    </select>
  )
}

function HomeStateChange({ currentState, onChanged, onClose }: Props): JSX.Element {
  const [history, setHistory] = useState<CompanyHistory | null>(null)
  const [stateCode, setStateCode] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(localDateString())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState(false)
  const [correctTo, setCorrectTo] = useState('')
  const [correctError, setCorrectError] = useState<string | null>(null)

  useEffect(() => {
    void window.juno.getHistory().then(setHistory)
  }, [currentState])

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!stateCode) {
      setError('Choose the new home state.')
      return
    }
    setSaving(true)
    setError(null)
    setSaved(null)
    const result = await window.juno.changeHomeState({ stateCode, effectiveDate })
    setSaving(false)
    if (result.ok) {
      setSaved(`Saved: ${getStateName(stateCode)} from ${effectiveDate}.`)
      setStateCode('')
      setHistory(await window.juno.getHistory())
      onChanged(result.value)
    } else {
      setError(result.error)
    }
  }

  async function correct(): Promise<void> {
    setCorrectError(null)
    const result = await window.juno.correctStartingHomeState(correctTo)
    if (!result.ok) {
      setCorrectError(result.error)
      return
    }
    setCorrecting(false)
    setSaved(`Saved: the books started in ${getStateName(correctTo)}.`)
    setHistory(await window.juno.getHistory())
    onChanged(result.value)
  }

  async function remove(date: string, label: string): Promise<void> {
    if (!window.confirm(`Remove the change to ${label} starting ${date}?`)) return
    setError(null)
    setSaved(null)
    const result = await window.juno.removeHomeStateChange(date)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setHistory(await window.juno.getHistory())
    onChanged(result.value)
  }

  return (
    <section className="panel">
      <h2>Change home state</h2>
      {history && (
        <table className="chart-table history-table">
          <thead>
            <tr>
              <th>Starts</th>
              <th>Home state</th>
            </tr>
          </thead>
          <tbody>
            {history.homeStates.map((row, i) => (
              <tr key={row.effectiveDate}>
                <td>{row.effectiveDate}</td>
                <td>
                  {getStateName(row.value)}
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
                        Correct starting state
                      </button>
                    </>
                  )}
                  {i === 0 && correcting && (
                    <div className="form">
                      <StateSelect value={correctTo} onChange={setCorrectTo} placeholder="Choose the right starting state…" />
                      <span className="hint">
                        Use this only if the state your books started with was entered wrong. It isn&rsquo;t a move
                        during the year.
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
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void remove(row.effectiveDate, getStateName(row.value))}
                      >
                        Remove
                      </button>
                      <div className="accountant-note">⚑ {HOME_STATE_CHANGE_NOTE}</div>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {saved && (
        <div className="change-summary">
          <p>
            <strong>{saved}</strong>
          </p>
          <p className="hint">Sales tax rates by state and date are set up in a later phase.</p>
        </div>
      )}

      <form className="form" onSubmit={submit}>
        <label>
          New home state
          <StateSelect value={stateCode} onChange={setStateCode} placeholder="Choose…" />
        </label>

        <label>
          Starts on
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          <span className="hint">
            The first day the new state applies. It can&rsquo;t be before your books start or in a closed period.
          </span>
        </label>

        <p className="accountant-note">⚑ {HOME_STATE_CHANGE_NOTE}</p>

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

export default HomeStateChange
