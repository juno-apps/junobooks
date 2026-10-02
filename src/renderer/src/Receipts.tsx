import { useEffect, useState, type DragEvent } from 'react'
import type { Attachment, AttachResult } from '../../preload/types'
import { formatBytes } from '../../shared/attachments'

interface Props {
  entryId: number
  /** Called when the number of receipts changes, so lists can update their count. */
  onChanged?: () => void
  /** Just the "Attach receipt…" button and result line, no list (used right after posting). */
  compact?: boolean
}

/** Plain-English summary of what happened when files were attached. */
export function attachSummary(r: AttachResult): string {
  const parts: string[] = []
  if (r.added.length) parts.push(`${r.added.length} receipt${r.added.length === 1 ? '' : 's'} attached.`)
  for (const s of r.skipped) parts.push(`${s.name} ${s.reason}.`)
  return parts.join(' ')
}

/** Receipts attached to one entry: list, open, show in folder, remove, and attach by picker or drag and drop. */
function Receipts({ entryId, onChanged, compact = false }: Props): JSX.Element {
  const [items, setItems] = useState<Attachment[]>([])
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)
  const [removing, setRemoving] = useState<{ id: number; reason: string } | null>(null)
  const [dragging, setDragging] = useState(false)

  async function reload(): Promise<void> {
    const r = await window.juno.listAttachments(entryId)
    if (r.ok) setItems(r.value)
  }

  useEffect(() => {
    if (!compact) void reload()
  }, [entryId])

  async function finish(result: Awaited<ReturnType<typeof window.juno.addAttachments>>): Promise<void> {
    if (!result.ok) {
      setMessage({ text: result.error, bad: true })
      return
    }
    if (result.value.added.length === 0 && result.value.skipped.length === 0) return // picker cancelled
    setMessage({ text: attachSummary(result.value), bad: result.value.added.length === 0 })
    if (!compact) await reload()
    if (result.value.added.length) onChanged?.()
  }

  async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.juno.pathForFile(f)).filter(Boolean)
    if (paths.length) await finish(await window.juno.addAttachments(entryId, paths))
  }

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>): Promise<void> {
    const r = await fn()
    if (!r.ok) setMessage({ text: r.error ?? 'Something went wrong.', bad: true })
  }

  const attachButton = (
    <button type="button" onClick={async () => finish(await window.juno.pickAttachments(entryId))}>
      Attach receipt…
    </button>
  )

  if (compact) {
    return (
      <span className="receipts-compact">
        {attachButton}
        {message && <span className={message.bad ? 'error' : 'muted'}> {message.text}</span>}
      </span>
    )
  }

  return (
    <div
      className={dragging ? 'receipts dragging' : 'receipts'}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <h4>Receipts</h4>
      {items.length === 0 ? (
        <p className="muted">No receipts attached. Attach a file, or drag one here.</p>
      ) : (
        <ul className="receipt-list">
          {items.map((a) => (
            <li key={a.id}>
              <button type="button" className="link-button" onClick={() => act(() => window.juno.openAttachment(a.id))}>
                {a.storedPath.split('/').pop()}
              </button>
              <span className="muted">
                {' '}
                ({a.originalName}, {formatBytes(a.sizeBytes)})
              </span>{' '}
              <button type="button" className="link-button" onClick={() => act(() => window.juno.showAttachment(a.id))}>
                Show in folder
              </button>{' '}
              <button type="button" className="link-button" onClick={() => setRemoving({ id: a.id, reason: '' })}>
                Remove…
              </button>
              {removing?.id === a.id && (
                <form
                  className="form-row receipt-remove"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const r = await window.juno.removeAttachment(a.id, removing.reason)
                    if (!r.ok) {
                      setMessage({ text: r.error, bad: true })
                      return
                    }
                    setRemoving(null)
                    setMessage({ text: 'Receipt removed. The file was moved to receipts\\_removed in the company folder.', bad: false })
                    await reload()
                    onChanged?.()
                  }}
                >
                  <input
                    autoFocus
                    placeholder="Reason (optional), e.g. wrong file"
                    value={removing.reason}
                    onChange={(e) => setRemoving({ ...removing, reason: e.target.value })}
                  />
                  <button type="submit" className="danger">
                    Remove
                  </button>
                  <button type="button" onClick={() => setRemoving(null)}>
                    Cancel
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="form-actions">{attachButton}</div>
      {message && <p className={message.bad ? 'error' : 'success'}>{message.text}</p>}
    </div>
  )
}

export default Receipts
