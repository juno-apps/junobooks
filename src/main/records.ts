import type Database from 'better-sqlite3'
import { isValidDate } from '../shared/dates'
import {
  homeOfficeSummary,
  necThresholdCents,
  type Contractor,
  type ContractorInput,
  type FixedAsset,
  type FixedAssetInput,
  type FixedAssetReport,
  type HomeOffice,
  type HomeOfficeSummary,
  type MileageReport,
  type MileageTrip,
  type NecReport,
  type TripInput
} from '../shared/records'
import { LedgerError } from './ledger'

/** Year-end records the accountant package needs. */

// ---- Contractors and the 1099-NEC list ---------------------------------------------------------------

export function listContractors(db: Database.Database): Contractor[] {
  return (
    db
      .prepare(
        `SELECT id, name, address, w9_on_file AS w9OnFile, tin_last4 AS tinLast4, match_text AS matchText, notes, is_active AS isActive
         FROM contractors ORDER BY lower(name)`
      )
      .all() as (Omit<Contractor, 'w9OnFile' | 'isActive'> & { w9OnFile: number; isActive: number })[]
  ).map((c) => ({ ...c, w9OnFile: !!c.w9OnFile, isActive: !!c.isActive }))
}

function checkContractor(c: ContractorInput): void {
  if (!c.name.trim()) throw new LedgerError('Enter the contractor’s name.')
  if (c.tinLast4 && !/^\d{4}$/.test(c.tinLast4))
    throw new LedgerError('Enter only the last four digits of their tax ID (or leave it blank).')
  if (c.matchText.trim().length > 0 && c.matchText.trim().length < 3)
    throw new LedgerError('Use at least three letters to find their payments.')
}

export function saveContractor(
  db: Database.Database,
  id: number | null,
  c: ContractorInput & { isActive?: boolean },
  now: Date = new Date()
): void {
  checkContractor(c)
  const match = c.matchText.trim() || c.name.trim()
  const stamp = now.toISOString()
  if (id === null) {
    db.prepare(
      `INSERT INTO contractors (name, address, w9_on_file, tin_last4, match_text, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(c.name.trim(), c.address.trim(), c.w9OnFile ? 1 : 0, c.tinLast4, match, c.notes.trim(), stamp, stamp)
  } else {
    db.prepare(
      `UPDATE contractors SET name = ?, address = ?, w9_on_file = ?, tin_last4 = ?, match_text = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?`
    ).run(
      c.name.trim(),
      c.address.trim(),
      c.w9OnFile ? 1 : 0,
      c.tinLast4,
      match,
      c.notes.trim(),
      c.isActive === false ? 0 : 1,
      stamp,
      id
    )
  }
}

/** Payments to contract-labor and professional-services accounts in a year, by contractor. Payments whose other side is a
 * credit card are shown but left out of the 1099-NEC amount (the card company reports them). */
export function necReport(db: Database.Database, year: number): NecReport {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const payments = db
    .prepare(
      `SELECT e.id AS entryId, e.entry_date AS date, e.memo, l.memo AS lineMemo, l.amount_cents AS cents,
         EXISTS (SELECT 1 FROM journal_lines o JOIN accounts oa ON oa.id = o.account_id
                 WHERE o.entry_id = e.id AND o.amount_cents < 0 AND oa.subtype = 'credit_card') AS byCard
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
       WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND a.tax_category IN ('contract_labor', 'legal_professional')
         AND l.amount_cents > 0
       ORDER BY e.entry_date, e.id`
    )
    .all(from, to) as { entryId: number; date: string; memo: string; lineMemo: string; cents: number; byCard: number }[]
  const contractors = listContractors(db)
  const threshold = necThresholdCents(year)
  const rows = new Map<number, NecReport['rows'][number]>()
  const unmatched: NecReport['unmatched'] = []
  for (const p of payments) {
    const text = `${p.memo} ${p.lineMemo}`.toLowerCase()
    const c = contractors
      .filter((x) => text.includes(x.matchText.toLowerCase()))
      .sort((a, b) => b.matchText.length - a.matchText.length)[0]
    if (!c) {
      unmatched.push({ entryId: p.entryId, date: p.date, memo: p.memo || p.lineMemo, cents: p.cents })
      continue
    }
    const r = rows.get(c.id) ?? {
      contractorId: c.id,
      name: c.name,
      w9OnFile: c.w9OnFile,
      tinLast4: c.tinLast4,
      paidCents: 0,
      paidByCardCents: 0,
      overThreshold: false,
      payments: []
    }
    if (p.byCard) r.paidByCardCents += p.cents
    else r.paidCents += p.cents
    r.payments.push({
      entryId: p.entryId,
      date: p.date,
      memo: p.memo || p.lineMemo,
      cents: p.cents,
      byCard: !!p.byCard
    })
    rows.set(c.id, r)
  }
  for (const r of rows.values()) r.overThreshold = r.paidCents >= threshold
  return {
    year,
    thresholdCents: threshold,
    rows: [...rows.values()].sort((a, b) => b.paidCents - a.paidCents),
    unmatched
  }
}

// ---- Fixed assets -------------------------------------------------------------------------------------

export function listFixedAssets(db: Database.Database): FixedAsset[] {
  return db
    .prepare(
      `SELECT f.id, f.name, f.account_id AS accountId, a.name AS accountName, f.in_service_date AS inServiceDate, f.cost_cents AS costCents,
         f.disposed_date AS disposedDate, f.notes
       FROM fixed_assets f LEFT JOIN accounts a ON a.id = f.account_id ORDER BY f.in_service_date, f.id`
    )
    .all() as FixedAsset[]
}

export function saveFixedAsset(
  db: Database.Database,
  id: number | null,
  f: FixedAssetInput,
  now: Date = new Date()
): void {
  if (!f.name.trim()) throw new LedgerError('Describe the asset, e.g. "Rolling mill".')
  if (!isValidDate(f.inServiceDate)) throw new LedgerError('Enter the date you started using it.')
  if (f.disposedDate && (!isValidDate(f.disposedDate) || f.disposedDate < f.inServiceDate))
    throw new LedgerError('The disposal date must be after it was placed in service.')
  if (!Number.isSafeInteger(f.costCents) || f.costCents < 0) throw new LedgerError('Enter what it cost.')
  const stamp = now.toISOString()
  if (id === null) {
    db.prepare(
      `INSERT INTO fixed_assets (name, account_id, in_service_date, cost_cents, disposed_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(f.name.trim(), f.accountId, f.inServiceDate, f.costCents, f.disposedDate, f.notes.trim(), stamp, stamp)
  } else {
    db.prepare(
      `UPDATE fixed_assets SET name = ?, account_id = ?, in_service_date = ?, cost_cents = ?, disposed_date = ?, notes = ?, updated_at = ? WHERE id = ?`
    ).run(f.name.trim(), f.accountId, f.inServiceDate, f.costCents, f.disposedDate, f.notes.trim(), stamp, id)
  }
}

export function fixedAssetReport(db: Database.Database, year: number): FixedAssetReport {
  const end = `${year}-12-31`
  const start = `${year}-01-01`
  const assets = listFixedAssets(db)
    .filter((a) => a.inServiceDate <= end && (!a.disposedDate || a.disposedDate >= start))
    .map((a) => ({
      ...a,
      placedThisYear: a.inServiceDate >= start,
      disposedThisYear: !!a.disposedDate && a.disposedDate <= end
    }))
  const books = (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id WHERE a.subtype = 'fixed_asset' AND e.status = 'posted' AND e.entry_date <= ?`
      )
      .get(end) as { c: number }
  ).c
  return {
    year,
    assets,
    totalCostCents: assets.filter((a) => !a.disposedThisYear).reduce((s, a) => s + a.costCents, 0),
    booksCents: books
  }
}

// ---- Mileage --------------------------------------------------------------------------------------------

export function addTrip(db: Database.Database, t: TripInput, now: Date = new Date()): void {
  if (!isValidDate(t.date)) throw new LedgerError('Enter the date of the trip.')
  if (!Number.isSafeInteger(t.milesTenths) || t.milesTenths <= 0) throw new LedgerError('Enter the miles driven.')
  if (!t.purpose.trim()) throw new LedgerError('Enter the business purpose (the IRS asks for it).')
  db.prepare(
    'INSERT INTO mileage_trips (trip_date, miles_tenths, purpose, from_place, to_place, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(t.date, t.milesTenths, t.purpose.trim(), t.fromPlace.trim(), t.toPlace.trim(), now.toISOString())
}

export function removeTrip(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM mileage_trips WHERE id = ?').run(id)
}

export function setMileageRate(
  db: Database.Database,
  year: number,
  rateTenthCents: number | null,
  now: Date = new Date()
): void {
  if (rateTenthCents === null) {
    db.prepare('DELETE FROM mileage_rates WHERE year = ?').run(year)
    return
  }
  if (!Number.isSafeInteger(rateTenthCents) || rateTenthCents < 0 || rateTenthCents > 5000)
    throw new LedgerError('Enter the rate in cents per mile, e.g. 70.')
  db.prepare(
    'INSERT INTO mileage_rates (year, rate_tenth_cents, updated_at) VALUES (?, ?, ?) ON CONFLICT (year) DO UPDATE SET rate_tenth_cents = excluded.rate_tenth_cents, updated_at = excluded.updated_at'
  ).run(year, rateTenthCents, now.toISOString())
}

export function mileageReport(db: Database.Database, year: number): MileageReport {
  const trips = db
    .prepare(
      `SELECT id, trip_date AS date, miles_tenths AS milesTenths, purpose, from_place AS fromPlace, to_place AS toPlace
       FROM mileage_trips WHERE trip_date BETWEEN ? AND ? ORDER BY trip_date, id`
    )
    .all(`${year}-01-01`, `${year}-12-31`) as MileageTrip[]
  const rate =
    (
      db.prepare('SELECT rate_tenth_cents AS r FROM mileage_rates WHERE year = ?').get(year) as
        { r: number } | undefined
    )?.r ?? null
  const total = trips.reduce((s, t) => s + t.milesTenths, 0)
  // tenths of a mile × tenths of a cent = hundredths of a cent → ÷ 100, rounded
  return {
    year,
    trips,
    totalTenths: total,
    rateTenthCents: rate,
    amountCents: rate === null ? null : Math.round((total * rate) / 100)
  }
}

// ---- Home office ---------------------------------------------------------------------------------------

export function getHomeOffice(db: Database.Database, year: number): HomeOfficeSummary {
  const r = db
    .prepare(
      `SELECT year, office_sqft AS officeSqft, home_sqft AS homeSqft, rent_cents AS rentCents, mortgage_interest_cents AS mortgageInterestCents,
         property_tax_cents AS propertyTaxCents, utilities_cents AS utilitiesCents, insurance_cents AS insuranceCents,
         repairs_cents AS repairsCents, other_cents AS otherCents, notes FROM home_office WHERE year = ?`
    )
    .get(year) as HomeOffice | undefined
  return homeOfficeSummary(r ?? null)
}

export function saveHomeOffice(db: Database.Database, h: HomeOffice, now: Date = new Date()): void {
  if (!Number.isInteger(h.officeSqft) || !Number.isInteger(h.homeSqft) || h.officeSqft < 0 || h.homeSqft < 0) {
    throw new LedgerError('Enter the square feet as whole numbers.')
  }
  if (h.officeSqft > h.homeSqft) throw new LedgerError('The office can’t be bigger than the whole home.')
  const money = [
    h.rentCents,
    h.mortgageInterestCents,
    h.propertyTaxCents,
    h.utilitiesCents,
    h.insuranceCents,
    h.repairsCents,
    h.otherCents
  ]
  if (money.some((m) => !Number.isSafeInteger(m) || m < 0))
    throw new LedgerError('Home expenses must be amounts of zero or more.')
  db.prepare(
    `INSERT INTO home_office (year, office_sqft, home_sqft, rent_cents, mortgage_interest_cents, property_tax_cents, utilities_cents,
       insurance_cents, repairs_cents, other_cents, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (year) DO UPDATE SET office_sqft = excluded.office_sqft, home_sqft = excluded.home_sqft, rent_cents = excluded.rent_cents,
       mortgage_interest_cents = excluded.mortgage_interest_cents, property_tax_cents = excluded.property_tax_cents,
       utilities_cents = excluded.utilities_cents, insurance_cents = excluded.insurance_cents, repairs_cents = excluded.repairs_cents,
       other_cents = excluded.other_cents, notes = excluded.notes, updated_at = excluded.updated_at`
  ).run(h.year, h.officeSqft, h.homeSqft, ...money, h.notes.trim(), now.toISOString())
}
