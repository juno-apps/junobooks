import type Database from 'better-sqlite3'
import { findRule, validateRule, type CategorizationRule, type RuleInput } from '../shared/rules'
import { LedgerError } from './ledger'

/** Categorization rules for imported lines (table categorization_rules, audited). */

export function listRules(db: Database.Database): CategorizationRule[] {
  return (
    db
      .prepare(
        `SELECT id, match_text AS matchText, account_id AS accountId, payee, bank_account_id AS bankAccountId, is_active AS isActive
         FROM categorization_rules ORDER BY lower(match_text), id`
      )
      .all() as (Omit<CategorizationRule, 'isActive'> & { isActive: number })[]
  ).map((r) => ({ ...r, isActive: !!r.isActive }))
}

function check(db: Database.Database, input: RuleInput): void {
  const problem = validateRule(input)
  if (problem) throw new LedgerError(problem)
  const acct = db.prepare('SELECT is_active FROM accounts WHERE id = ?')
  const a = acct.get(input.accountId) as { is_active: number } | undefined
  if (!a) throw new LedgerError('That account no longer exists.')
  if (!a.is_active) throw new LedgerError('That account is inactive.')
  if (input.bankAccountId !== null && !acct.get(input.bankAccountId))
    throw new LedgerError('That bank account no longer exists.')
}

export function addRule(db: Database.Database, input: RuleInput, now: Date = new Date()): number {
  check(db, input)
  const stamp = now.toISOString()
  return Number(
    db
      .prepare(
        `INSERT INTO categorization_rules (match_text, account_id, payee, bank_account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.matchText.trim(), input.accountId, input.payee.trim(), input.bankAccountId, stamp, stamp)
      .lastInsertRowid
  )
}

export function updateRule(
  db: Database.Database,
  id: number,
  input: RuleInput & { isActive: boolean },
  now: Date = new Date()
): void {
  check(db, input)
  const r = db
    .prepare(
      `UPDATE categorization_rules SET match_text = ?, account_id = ?, payee = ?, bank_account_id = ?, is_active = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.matchText.trim(),
      input.accountId,
      input.payee.trim(),
      input.bankAccountId,
      input.isActive ? 1 : 0,
      now.toISOString(),
      id
    )
  if (r.changes === 0) throw new LedgerError('That rule no longer exists.')
}

/** Rules are settings, not records, so they can be deleted (the audit log keeps what they were). */
export function deleteRule(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM categorization_rules WHERE id = ?').run(id)
}

/** A rule matcher over the current rules and active accounts. */
export function ruleMatcher(
  db: Database.Database
): (line: { description: string; accountId: number }) => CategorizationRule | null {
  const rules = listRules(db)
  const active = new Set(
    (db.prepare('SELECT id FROM accounts WHERE is_active = 1').all() as { id: number }[]).map((r) => r.id)
  )
  return (line) => findRule(rules, line, (id) => active.has(id))
}
