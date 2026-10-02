import { useEffect, useState } from 'react'

/**
 * The red message under a form, which goes away once its cause is fixed.
 * A problem found by the screen's own check is re-checked whenever the form
 * changes (cleared when fixed, replaced if a different problem remains). A
 * problem reported by the books on saving (e.g. a closed period) is cleared as
 * soon as anything in the form changes, since the screen can't re-check it.
 */
export function useFormError(
  recheck: () => string | null,
  deps: unknown[]
): { error: string | null; showCheck: (text: string) => void; showSave: (text: string) => void; clear: () => void } {
  const [error, setError] = useState<{ text: string; fromSave: boolean } | null>(null)

  useEffect(() => {
    setError((cur) => {
      if (!cur) return cur
      if (cur.fromSave) return null
      const text = recheck()
      return text ? { text, fromSave: false } : null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return {
    error: error?.text ?? null,
    showCheck: (text) => setError({ text, fromSave: false }),
    showSave: (text) => setError({ text, fromSave: true }),
    clear: () => setError(null)
  }
}
