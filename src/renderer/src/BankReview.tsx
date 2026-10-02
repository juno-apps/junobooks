import { Fragment, useEffect, useState } from 'react'
import type { BankLine, ChartAccount } from '../../preload/types'
import { inOutWords, lineCategoryGroups } from '../../shared/bankImport'
import { formatCents } from '../../shared/money'
import { suggestMatchText } from '../../shared/rules'
import AccountCombobox from './AccountCombobox'
import RulesManager, { RuleForm } from './RulesManager'

interface Props {
  /** The account to show first. */
  initialAccountId: number | null
  onPosted: () => void
  onClose: () => void
}

interface Draft {
  accountId: number | null
  memo: string
  selected: boolean
  error?: string
}

/** Review imported lines: choose what each was for, then post them (or ignore ones already entered by hand). */
function BankReview({ initialAccountId, onPosted, onClose }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<ChartAccount[] | null>(null)
  const [counts, setCounts] = useState<{ accountId: number; count: number }[]>([])
  const [accountId, setAccountId] = useState<number | null>(initialAccountId)
  const [lines, setLines] = useState<BankLine[]>([])
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [ignored, setIgnored] = useState<BankLine[] | null>(null)
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  /** The line whose "Make a rule" form is open. */
  const [ruleFor, setRuleFor] = useState<number | null>(null)
  const [showRules, setShowRules] = useState(false)

  async function reload(acct: number | null = accountId): Promise<void> {
    const [chart, c] = await Promise.all([window.juno.getChart(), window.juno.reviewCounts()])
    setAccounts(chart ? chart.accounts : [])
    setCounts(c)
    const chosen = acct ?? c[0]?.accountId ?? null
    setAccountId(chosen)
    if (chosen === null) {
      setLines([])
      return
    }
    const r = await window.juno.linesToReview(chosen)
    if (!r.ok) {
      setMessage({ text: r.error, bad: true })
      return
    }
    setLines(r.value)
    setDrafts((prev) => {
      const next: Record<number, Draft> = {}
      for (const l of r.value) {
        const old = prev[l.id]
        // A rule fills in lines that have no account yet (including after a new rule is made).
        next[l.id] =
          old && (old.accountId !== null || !l.suggestion)
            ? old
            : {
                accountId: l.suggestion?.accountId ?? null,
                memo: old?.memo || l.suggestion?.payee || '',
                selected: old?.selected ?? false
              }
        delete next[l.id].error
      }
      return next
    })
    if (ignored !== null) {
      const ig = await window.juno.ignoredLines(chosen)
      if (ig.ok) setIgnored(ig.value)
    }
  }

  useEffect(() => {
    void reload(initialAccountId)
  }, [])

  if (!accounts) return <p>Loading imported lines…</p>

  const account = accounts.find((a) => a.id === accountId)
  const words = inOutWords(account)
  const nameOf = (id: number): string => accounts.find((a) => a.id === id)?.name ?? `Account ${id}`
  const edit = (id: number, patch: Partial<Draft>): void =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch, error: undefined } }))
  const selected = lines.filter((l) => drafts[l.id]?.selected)
  const allSelected = lines.length > 0 && selected.length === lines.length

  async function post(targets: BankLine[]): Promise<void> {
    const ready = targets.filter((l) => drafts[l.id]?.accountId)
    const missing = targets.length - ready.length
    if (ready.length === 0) {
      setMessage({ text: 'Choose what each line was for first (the account box on its row).', bad: true })
      return
    }
    setBusy(true)
    const r = await window.juno.postBankLines(
      ready.map((l) => ({ lineId: l.id, accountId: drafts[l.id].accountId!, memo: drafts[l.id].memo }))
    )
    setBusy(false)
    if (!r.ok) {
      setMessage({ text: r.error, bad: true })
      return
    }
    const failed = r.value.failed
    setMessage({
      text:
        `${r.value.posted.length} posted.` +
        (failed.length ? ` ${failed.length} couldn't be posted (see the red notes).` : '') +
        (missing ? ` ${missing} skipped because no account was chosen.` : ''),
      bad: failed.length > 0
    })
    await reload()
    if (failed.length)
      setDrafts((d) => {
        const next = { ...d }
        for (const f of failed) if (next[f.lineId]) next[f.lineId] = { ...next[f.lineId], error: f.error }
        return next
      })
    if (r.value.posted.length) onPosted()
  }

  async function ignore(targets: BankLine[]): Promise<void> {
    if (targets.length === 0) return
    const r = await window.juno.ignoreBankLines(targets.map((l) => l.id))
    if (!r.ok) setMessage({ text: r.error, bad: true })
    else
      setMessage({
        text: `${targets.length} set aside as ignored. Use "Show ignored lines" to bring any back.`,
        bad: false
      })
    await reload()
  }

  return (
    <section className="panel journal-entry bank-review">
      <div className="chart-header">
        <h2>Review imported lines</h2>
        <span>
          <button type="button" className="link-button" onClick={() => setShowRules((v) => !v)}>
            Categorization rules
          </button>{' '}
          ·{' '}
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        </span>
      </div>
      <p className="hint">
        For each line, choose what it was for and post it. Paying a credit card or moving money between your own
        accounts? Choose the other account under &ldquo;Transfers and payments&rdquo;. Already typed this one in by
        hand? Ignore it so it isn&rsquo;t counted twice.
      </p>

      {counts.length > 1 && (
        <div className="tabs review-accounts">
          {counts.map((c) => (
            <button
              key={c.accountId}
              type="button"
              className={c.accountId === accountId ? 'tab active' : 'tab'}
              onClick={() => {
                setMessage(null)
                void reload(c.accountId)
              }}
            >
              {nameOf(c.accountId)} ({c.count})
            </button>
          ))}
        </div>
      )}

      {showRules && (
        <RulesManager
          accounts={accounts}
          categoryGroups={lineCategoryGroups(accounts, -1, -1)}
          onChanged={() => void reload()}
          onClose={() => setShowRules(false)}
        />
      )}

      {account && (
        <h3>
          {account.number} {account.name}
        </h3>
      )}
      {lines.length === 0 ? (
        <p className="muted">Nothing waiting for review{account ? ' in this account' : ''}.</p>
      ) : (
        <>
          <table className="chart-table review-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all lines"
                    checked={allSelected}
                    onChange={(e) =>
                      setDrafts((d) =>
                        Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v, selected: e.target.checked }]))
                      )
                    }
                  />
                </th>
                <th>Date</th>
                <th>Bank description</th>
                <th className="amount">{words.in}</th>
                <th className="amount">{words.out}</th>
                <th>What was it for?</th>
                <th>Memo (optional)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const d = drafts[l.id] ?? { accountId: null, memo: '', selected: false }
                const fromRule = l.suggestion && d.accountId === l.suggestion.accountId ? l.suggestion.matchText : null
                return (
                  <Fragment key={l.id}>
                    <tr className={d.error ? 'review-row has-error' : 'review-row'}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select line ${i + 1}`}
                          checked={d.selected}
                          onChange={(e) => edit(l.id, { selected: e.target.checked })}
                        />
                      </td>
                      <td>{l.date}</td>
                      <td>
                        {l.description}
                        {l.entryVoided && (
                          <div className="account-description">Its entry was voided; post it again or ignore it.</div>
                        )}
                        {d.error && <div className="error">{d.error}</div>}
                      </td>
                      <td className="amount">{l.amountCents > 0 ? formatCents(l.amountCents) : ''}</td>
                      <td className="amount">{l.amountCents < 0 ? formatCents(-l.amountCents) : ''}</td>
                      <td className="review-account">
                        <AccountCombobox
                          groups={lineCategoryGroups(accounts, l.accountId, l.amountCents)}
                          value={d.accountId}
                          onChange={(id) => edit(l.id, { accountId: id })}
                          label={`Line ${i + 1} account`}
                        />
                        {fromRule && <div className="account-description">From rule &ldquo;{fromRule}&rdquo;</div>}
                      </td>
                      <td>
                        <input
                          value={d.memo}
                          placeholder={l.description}
                          aria-label={`Line ${i + 1} memo`}
                          onChange={(e) => edit(l.id, { memo: e.target.value })}
                        />
                      </td>
                      <td className="row-actions">
                        <button type="button" className="link-button" disabled={busy} onClick={() => void post([l])}>
                          Post
                        </button>{' '}
                        <button type="button" className="link-button" onClick={() => void ignore([l])}>
                          Ignore
                        </button>{' '}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setRuleFor(ruleFor === l.id ? null : l.id)}
                        >
                          Make a rule…
                        </button>
                      </td>
                    </tr>
                    {ruleFor === l.id && (
                      <tr className="rule-row">
                        <td colSpan={8}>
                          <RuleForm
                            initial={{
                              matchText: suggestMatchText(l.description),
                              accountId: d.accountId,
                              payee: d.memo,
                              bankAccountId: l.accountId
                            }}
                            accounts={accounts}
                            categoryGroups={lineCategoryGroups(accounts, l.accountId, l.amountCents)}
                            submitLabel="Save rule and fill in matching lines"
                            onSubmit={async (input) => {
                              const r = await window.juno.addRule(input)
                              if (!r.ok) return r.error
                              setRuleFor(null)
                              setMessage({
                                text: `Rule saved: lines containing "${input.matchText.trim()}" get ${nameOf(input.accountId!)}.`,
                                bad: false
                              })
                              await reload()
                              return null
                            }}
                            onCancel={() => setRuleFor(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          <div className="form-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || selected.length === 0}
              onClick={() => void post(selected)}
            >
              Post {selected.length || ''} selected
            </button>
            <button type="button" disabled={selected.length === 0} onClick={() => void ignore(selected)}>
              Ignore selected
            </button>
          </div>
        </>
      )}
      {message && <p className={message.bad ? 'error' : 'success'}>{message.text}</p>}

      {accountId !== null && (
        <div className="ignored-lines">
          <button
            type="button"
            className="link-button"
            onClick={async () => {
              if (ignored !== null) setIgnored(null)
              else {
                const r = await window.juno.ignoredLines(accountId)
                setIgnored(r.ok ? r.value : [])
              }
            }}
          >
            {ignored === null ? 'Show ignored lines' : 'Hide ignored lines'}
          </button>
          {ignored !== null &&
            (ignored.length === 0 ? (
              <p className="muted">No ignored lines in this account.</p>
            ) : (
              <ul>
                {ignored.map((l) => (
                  <li key={l.id}>
                    {l.date} · {l.description} · {l.amountCents > 0 ? words.in : words.out}{' '}
                    {formatCents(Math.abs(l.amountCents))}{' '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={async () => {
                        await window.juno.restoreBankLine(l.id)
                        await reload()
                        const r = await window.juno.ignoredLines(accountId)
                        setIgnored(r.ok ? r.value : [])
                      }}
                    >
                      Bring back
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}
    </section>
  )
}

export default BankReview
