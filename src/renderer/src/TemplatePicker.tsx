import { TEMPLATES } from '../../shared/templates'

interface Props {
  value: string
  onChange: (template: string) => void
}

/** The "starting chart of accounts" dropdown, used on the new-company form and the one-time setup. */
function TemplatePicker({ value, onChange }: Props): JSX.Element {
  const chosen = TEMPLATES.find((t) => t.id === value)
  return (
    <label>
      Starting chart of accounts
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {TEMPLATES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <span className="hint">
        {chosen ? chosen.hint : 'Pick the closest fit.'} You can add, rename, or hide accounts later.
      </span>
    </label>
  )
}

export default TemplatePicker
