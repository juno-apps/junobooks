import { useEffect, useState } from 'react'
import { accountLabel, filterGroups, type AccountGroup } from '../../shared/everyday'

interface Props {
  groups: AccountGroup[]
  value: number | null
  onChange: (id: number | null) => void
  label: string
}

/**
 * A dropdown you can type into to narrow the choices. Only an account that
 * exists can be chosen: text that doesn't match one is thrown away when you
 * leave the box.
 */
function AccountCombobox({ groups, value, onChange, label }: Props): JSX.Element {
  const all = groups.flatMap((g) => g.accounts)
  const selected = all.find((a) => a.id === value) ?? null
  const [text, setText] = useState(selected ? accountLabel(selected) : '')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  // The chosen account can also change from outside (e.g. a rule fills it in): show it.
  useEffect(() => {
    if (!open) setText(selected ? accountLabel(selected) : '')
  }, [value])

  // Only narrow once something has been typed; opening an untouched box shows everything.
  const typed = selected && text === accountLabel(selected) ? '' : text
  const shown = filterGroups(groups, typed)
  const flat = shown.flatMap((g) => g.accounts)

  function choose(id: number): void {
    const a = all.find((x) => x.id === id)!
    setText(accountLabel(a))
    setOpen(false)
    onChange(id)
  }

  function settle(): void {
    setOpen(false)
    if (!text.trim()) {
      setText('')
      if (value !== null) onChange(null)
      return
    }
    if (selected && text === accountLabel(selected)) return
    // Text that fits exactly one account picks it; anything else goes back to what was chosen.
    if (flat.length === 1) choose(flat[0].id)
    else setText(selected ? accountLabel(selected) : '')
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((h) => (flat.length === 0 ? 0 : (h + step + flat.length) % flat.length))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault() // choosing an account must not post the form
      if (flat[highlight]) choose(flat[highlight].id)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      setText(selected ? accountLabel(selected) : '')
    }
  }

  let index = -1
  return (
    <div className="combobox">
      <input
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        autoComplete="off"
        value={text}
        placeholder="Choose…"
        onFocus={(e) => {
          setOpen(true)
          e.target.select()
        }}
        onBlur={settle}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="combobox-list" role="listbox">
          {flat.length === 0 && <li className="combobox-empty">No matching account</li>}
          {shown.map((g) => (
            <li key={g.title} role="presentation">
              <div className="combobox-group">{g.title}</div>
              <ul>
                {g.accounts.map((a) => {
                  index += 1
                  const i = index
                  return (
                    <li
                      key={a.id}
                      role="option"
                      aria-selected={a.id === value}
                      className={i === highlight ? 'combobox-option active' : 'combobox-option'}
                      // mousedown, not click: the box's blur would otherwise close the list first
                      onMouseDown={(e) => {
                        e.preventDefault()
                        choose(a.id)
                      }}
                      onMouseEnter={() => setHighlight(i)}
                    >
                      {accountLabel(a)}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default AccountCombobox
