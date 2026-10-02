import type Database from 'better-sqlite3'
import {
  effectiveSubtype,
  normalBalanceFor,
  SYSTEM_SUBTYPES,
  validateAccountInput,
  type AccountInput
} from '../shared/accounts'
import type { EntityTypeId } from '../shared/entities'
import { formatCents } from '../shared/money'
import { getTaxCategory, type AccountType } from '../shared/taxLines'
import { buildChart, NOTE, type AccountSubtype, type NormalBalance, type TemplateId } from '../shared/templates'

/**
 * Adding, editing, deactivating and deleting accounts. Every rule is checked
 * here first (plain-English errors); the rules that protect posted history
 * are also enforced by database triggers (migrations v2 and v5).
 */

export class AccountError extends Error {}

/** The company's template and current entity type, used to decide accountant notes. */
export interface ChartContext {
  template: TemplateId | null
  entity: EntityTypeId
}

interface AccountRow {
  id: number
  number: string
  name: string
  type: AccountType
  subtype: AccountSubtype
  normal_balance: NormalBalance
  is_active: number
  tax_category: string | null
  accountant_note: string
  parent_id: number | null
}

function getRow(db: Database.Database, id: number): AccountRow {
  const row = db
    .prepare(
      `SELECT id, number, name, type, subtype, normal_balance, is_active, tax_category, accountant_note, parent_id
       FROM accounts WHERE id = ?`
    )
    .get(id) as AccountRow | undefined
  if (!row) throw new AccountError("That account doesn't exist.")
  return row
}

/** used = appears in any entry (even a draft); posted = appears in a posted or voided entry. */
export function accountUsage(db: Database.Database, id: number): { used: boolean; posted: boolean } {
  const used = db.prepare('SELECT 1 FROM journal_lines WHERE account_id = ? LIMIT 1').get(id) !== undefined
  const posted =
    db
      .prepare(
        `SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_id = ? AND e.status <> 'draft' LIMIT 1`
      )
      .get(id) !== undefined
  return { used, posted }
}

function assertUnique(db: Database.Database, number: string, name: string, exceptId: number): void {
  const byNumber = db.prepare('SELECT name FROM accounts WHERE number = ? AND id <> ?').get(number, exceptId) as
    { name: string } | undefined
  if (byNumber) throw new AccountError(`Account number ${number} is already used by "${byNumber.name}".`)
  const byName = db
    .prepare('SELECT number FROM accounts WHERE lower(name) = lower(?) AND id <> ?')
    .get(name, exceptId) as { number: string } | undefined
  if (byName) throw new AccountError(`There's already an account named "${name}" (number ${byName.number}).`)
}

function categoryLabel(key: string | null): string {
  return (key && getTaxCategory(key)?.label) || 'none'
}

/** The accountant note for an account whose tax category is being set.
 * The template's own choice keeps the template's note; anything else is flagged. */
function noteForCategory(ctx: ChartContext, number: string, category: string, oldCategory: string | null): string {
  const fromTemplate = ctx.template ? buildChart(ctx.template, ctx.entity).find((a) => a.number === number) : undefined
  if (fromTemplate && fromTemplate.taxCategory === category) return fromTemplate.accountantNote
  if (oldCategory === null) return category === 'other_expenses' ? NOTE.otherExpenses : ''
  return `The tax category was changed from "${categoryLabel(oldCategory)}" to "${categoryLabel(category)}". Confirm this is right.`
}

/** The id of a top-level account with this number and type, to place a new account under (or null). */
export function parentFor(db: Database.Database, number: string | undefined, type: AccountType): number | null {
  if (!number) return null
  const r = db
    .prepare('SELECT id FROM accounts WHERE number = ? AND type = ? AND parent_id IS NULL')
    .get(number, type) as { id: number } | undefined
  return r?.id ?? null
}

/** A parent must exist, have the same type, be top level itself, and not be the account; an account that has
 * sub-accounts can't become one. */
function checkParent(
  db: Database.Database,
  id: number | null,
  parentId: number | null | undefined,
  type: AccountType
): void {
  if (parentId === null || parentId === undefined) return
  if (parentId === id) throw new AccountError("An account can't be a sub-account of itself.")
  const p = db.prepare('SELECT type, parent_id FROM accounts WHERE id = ?').get(parentId) as
    { type: AccountType; parent_id: number | null } | undefined
  if (!p) throw new AccountError("That parent account doesn't exist.")
  if (p.type !== type) throw new AccountError('A sub-account must be the same type as the account it sits under.')
  if (p.parent_id !== null)
    throw new AccountError('Sub-accounts go one level deep: choose a top-level account as the parent.')
  if (id !== null && db.prepare('SELECT 1 FROM accounts WHERE parent_id = ? LIMIT 1').get(id)) {
    throw new AccountError("This account has sub-accounts of its own, so it can't sit under another account.")
  }
}

function checkInput(input: AccountInput): { number: string; name: string; description: string } {
  const problem = validateAccountInput(input)
  if (problem) throw new AccountError(problem)
  return { number: input.number.trim(), name: input.name.trim(), description: input.description.trim() }
}

/** Adds an account. Returns its id. */
export function addAccount(db: Database.Database, input: AccountInput, ctx: ChartContext, now = new Date()): number {
  const { number, name, description } = checkInput(input)
  if (SYSTEM_SUBTYPES.includes(input.subtype)) throw new AccountError('Choose what kind of account this is.')
  assertUnique(db, number, name, -1)
  checkParent(db, null, input.parentId, input.type)
  const subtype = effectiveSubtype(input.type, input.subtype, input.taxCategory)
  const stamp = now.toISOString()
  return Number(
    db
      .prepare(
        `INSERT INTO accounts (number, name, type, subtype, normal_balance, tax_category, accountant_note, description,
           parent_id, created_at, updated_at)
         VALUES (@number, @name, @type, @subtype, @normal, @category, @note, @description, @parent, @stamp, @stamp)`
      )
      .run({
        number,
        name,
        type: input.type,
        subtype,
        normal: normalBalanceFor(input.type, subtype),
        category: input.taxCategory,
        note: noteForCategory(ctx, number, input.taxCategory, null),
        description,
        parent: input.parentId ?? null,
        stamp
      }).lastInsertRowid
  )
}

/** Edits an account. Renaming, renumbering and changing the tax category are always allowed;
 * type and debit/credit side are locked once the account has posted entries. */
export function updateAccount(
  db: Database.Database,
  id: number,
  input: AccountInput,
  ctx: ChartContext,
  now = new Date()
): void {
  const old = getRow(db, id)
  const { number, name, description } = checkInput(input)
  const isSystem = SYSTEM_SUBTYPES.includes(old.subtype)
  if (isSystem && input.type !== old.type) {
    throw new AccountError("JunoBooks uses this account for a special purpose, so its type can't be changed.")
  }
  if (!isSystem && SYSTEM_SUBTYPES.includes(input.subtype))
    throw new AccountError('Choose what kind of account this is.')
  assertUnique(db, number, name, id)
  checkParent(db, id, input.parentId, input.type)
  if (input.type !== old.type && input.parentId === undefined && old.parent_id !== null) {
    throw new AccountError('Take this account out from under its parent before changing its type.')
  }
  if (input.type !== old.type && db.prepare('SELECT 1 FROM accounts WHERE parent_id = ? LIMIT 1').get(id)) {
    throw new AccountError("This account has sub-accounts, so its type can't change.")
  }

  const subtype = isSystem ? old.subtype : effectiveSubtype(input.type, input.subtype, input.taxCategory)
  const normal = normalBalanceFor(input.type, subtype)
  if ((input.type !== old.type || normal !== old.normal_balance) && accountUsage(db, id).posted) {
    throw new AccountError(
      "This account has posted entries, so its type and kind can't be changed. You can still rename it or change its tax category."
    )
  }
  const note =
    input.taxCategory === old.tax_category
      ? old.accountant_note
      : noteForCategory(ctx, number, input.taxCategory, old.tax_category)

  db.prepare(
    `UPDATE accounts SET number = @number, name = @name, type = @type, subtype = @subtype, normal_balance = @normal,
       tax_category = @category, accountant_note = @note, description = @description,
       parent_id = CASE WHEN @keepParent = 1 THEN parent_id ELSE @parent END, updated_at = @stamp
     WHERE id = @id`
  ).run({
    id,
    number,
    name,
    type: input.type,
    subtype,
    normal,
    category: input.taxCategory,
    note,
    description,
    keepParent: input.parentId === undefined ? 1 : 0,
    parent: input.parentId ?? null,
    stamp: now.toISOString()
  })
}

/** Deactivates or reactivates an account. Deactivating needs a zero balance (all posted entries, any date). */
export function setAccountActive(db: Database.Database, id: number, active: boolean, now = new Date()): void {
  const old = getRow(db, id)
  if ((old.is_active === 1) === active) return
  if (!active) {
    const raw = (
      db
        .prepare(
          `SELECT COALESCE(SUM(l.amount_cents), 0) AS cents
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           WHERE l.account_id = ? AND e.status = 'posted'`
        )
        .get(id) as { cents: number }
    ).cents
    if (raw !== 0) {
      const shown = old.normal_balance === 'credit' ? -raw : raw
      throw new AccountError(
        `Account ${old.number} ${old.name} still has a balance of ${formatCents(shown)}. ` +
          'Move it to another account with a journal entry, then deactivate it.'
      )
    }
  }
  db.prepare('UPDATE accounts SET is_active = ?, updated_at = ? WHERE id = ?').run(
    active ? 1 : 0,
    now.toISOString(),
    id
  )
}

/** Deletes an account that has never been used. Used accounts must be deactivated instead. */
export function deleteAccount(db: Database.Database, id: number): void {
  const old = getRow(db, id)
  if (accountUsage(db, id).used) {
    throw new AccountError(
      `Account ${old.number} ${old.name} has been used in entries, so it can't be deleted. Deactivate it instead.`
    )
  }
  if (SYSTEM_SUBTYPES.includes(old.subtype)) {
    throw new AccountError("JunoBooks uses this account for a special purpose, so it can't be deleted.")
  }
  if (db.prepare('SELECT 1 FROM accounts WHERE parent_id = ? LIMIT 1').get(id)) {
    throw new AccountError("Other accounts sit under this one, so it can't be deleted.")
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
