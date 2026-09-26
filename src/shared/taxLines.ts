import type { TaxForm } from './entities'

/**
 * Tax-line mapping. Each account carries one stable tax *category* (e.g.
 * 'advertising'). A per-tax-year table translates each category into the
 * line on each federal return, so a change in IRS line numbers only needs a
 * new year's table and never touches accounts or old years.
 *
 * Line numbers were checked against the 2025 IRS forms (Schedule C,
 * 1065, 1120-S, 1120, and Form 1125-A Rev. 11-2024).
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export type TaxCategoryKey =
  // income
  | 'gross_receipts' | 'returns_allowances' | 'other_income' | 'interest_income'
  // cost of goods sold
  | 'cogs_purchases' | 'cogs_materials' | 'cogs_labor' | 'cogs_other'
  // expenses
  | 'advertising' | 'car_truck' | 'commissions_fees' | 'contract_labor' | 'depreciation'
  | 'employee_benefits' | 'insurance' | 'interest_expense' | 'legal_professional' | 'office_expense'
  | 'retirement_plans' | 'rent_equipment' | 'rent_property' | 'repairs' | 'supplies'
  | 'taxes_licenses' | 'travel' | 'meals' | 'utilities' | 'wages' | 'officer_comp'
  | 'guaranteed_payments' | 'bad_debts' | 'other_expenses' | 'nondeductible' | 'income_tax'
  // assets
  | 'cash' | 'accounts_receivable' | 'inventory' | 'other_current_assets' | 'loans_to_owners'
  | 'fixed_assets' | 'accumulated_depreciation' | 'other_assets'
  // liabilities
  | 'accounts_payable' | 'short_term_loans' | 'other_current_liabilities' | 'loans_from_owners'
  | 'long_term_loans' | 'other_liabilities'
  // equity
  | 'owner_equity' | 'partners_capital' | 'capital_stock' | 'paid_in_capital'
  | 'retained_earnings' | 'distributions' | 'opening_balance'

export interface TaxCategory {
  key: TaxCategoryKey
  label: string
  /** The account type this category belongs to. */
  accountType: AccountType
}

/** `ref` is where it goes on the form; null means it isn't reported on that form, and `label` says why. */
export interface TaxLine {
  ref: string | null
  label: string
}

type FormTable = Record<TaxCategoryKey, TaxLine>

const c = (key: TaxCategoryKey, label: string, accountType: AccountType): TaxCategory => ({ key, label, accountType })

export const TAX_CATEGORIES: TaxCategory[] = [
  c('gross_receipts', 'Gross receipts or sales', 'income'),
  c('returns_allowances', 'Returns and allowances', 'income'),
  c('other_income', 'Other income', 'income'),
  c('interest_income', 'Interest income', 'income'),
  c('cogs_purchases', 'Cost of goods sold: purchases', 'expense'),
  c('cogs_materials', 'Cost of goods sold: materials and supplies', 'expense'),
  c('cogs_labor', 'Cost of goods sold: labor', 'expense'),
  c('cogs_other', 'Cost of goods sold: other costs', 'expense'),
  c('advertising', 'Advertising', 'expense'),
  c('car_truck', 'Car and truck expenses', 'expense'),
  c('commissions_fees', 'Commissions and fees', 'expense'),
  c('contract_labor', 'Contract labor', 'expense'),
  c('depreciation', 'Depreciation', 'expense'),
  c('employee_benefits', 'Employee benefit programs', 'expense'),
  c('insurance', 'Insurance', 'expense'),
  c('interest_expense', 'Interest expense', 'expense'),
  c('legal_professional', 'Legal and professional services', 'expense'),
  c('office_expense', 'Office expense', 'expense'),
  c('retirement_plans', 'Pension and profit-sharing plans', 'expense'),
  c('rent_equipment', 'Rent: vehicles, machinery, equipment', 'expense'),
  c('rent_property', 'Rent: other business property', 'expense'),
  c('repairs', 'Repairs and maintenance', 'expense'),
  c('supplies', 'Supplies', 'expense'),
  c('taxes_licenses', 'Taxes and licenses', 'expense'),
  c('travel', 'Travel', 'expense'),
  c('meals', 'Meals', 'expense'),
  c('utilities', 'Utilities', 'expense'),
  c('wages', 'Salaries and wages', 'expense'),
  c('officer_comp', 'Compensation of officers', 'expense'),
  c('guaranteed_payments', 'Guaranteed payments to partners', 'expense'),
  c('bad_debts', 'Bad debts', 'expense'),
  c('other_expenses', 'Other expenses', 'expense'),
  c('nondeductible', 'Nondeductible expenses', 'expense'),
  c('income_tax', 'Federal income tax', 'expense'),
  c('cash', 'Cash', 'asset'),
  c('accounts_receivable', 'Accounts receivable', 'asset'),
  c('inventory', 'Inventory', 'asset'),
  c('other_current_assets', 'Other current assets', 'asset'),
  c('loans_to_owners', 'Loans to owners', 'asset'),
  c('fixed_assets', 'Buildings and other depreciable assets', 'asset'),
  c('accumulated_depreciation', 'Accumulated depreciation', 'asset'),
  c('other_assets', 'Other assets', 'asset'),
  c('accounts_payable', 'Accounts payable', 'liability'),
  c('short_term_loans', 'Loans payable in less than 1 year', 'liability'),
  c('other_current_liabilities', 'Other current liabilities', 'liability'),
  c('loans_from_owners', 'Loans from owners', 'liability'),
  c('long_term_loans', 'Loans payable in 1 year or more', 'liability'),
  c('other_liabilities', 'Other liabilities', 'liability'),
  c('owner_equity', "Owner's equity", 'equity'),
  c('partners_capital', "Partners' capital", 'equity'),
  c('capital_stock', 'Capital stock', 'equity'),
  c('paid_in_capital', 'Additional paid-in capital', 'equity'),
  c('retained_earnings', 'Retained earnings', 'equity'),
  c('distributions', 'Distributions', 'equity'),
  c('opening_balance', 'Opening balance equity', 'equity')
]

export function getTaxCategory(key: string): TaxCategory | undefined {
  return TAX_CATEGORIES.find((t) => t.key === key)
}

const on = (ref: string, label: string): TaxLine => ({ ref, label })
const not = (label: string): TaxLine => ({ ref: null, label })

const NO_BALANCE_SHEET = not('Not on Schedule C (it has no balance sheet)')
const NOT_DEDUCTIBLE = not('Not deductible. Your accountant reports it separately.')

const SCHEDULE_C_2025: FormTable = {
  gross_receipts: on('Line 1', 'Gross receipts or sales'),
  returns_allowances: on('Line 2', 'Returns and allowances'),
  other_income: on('Line 6', 'Other income'),
  interest_income: not('Usually not on Schedule C. Reported on Schedule B (Form 1040).'),
  cogs_purchases: on('Part III, line 36', 'Purchases'),
  cogs_materials: on('Part III, line 38', 'Materials and supplies'),
  cogs_labor: on('Part III, line 37', 'Cost of labor'),
  cogs_other: on('Part III, line 39', 'Other costs'),
  advertising: on('Line 8', 'Advertising'),
  car_truck: on('Line 9', 'Car and truck expenses'),
  commissions_fees: on('Line 10', 'Commissions and fees'),
  contract_labor: on('Line 11', 'Contract labor'),
  depreciation: on('Line 13', 'Depreciation and section 179'),
  employee_benefits: on('Line 14', 'Employee benefit programs'),
  insurance: on('Line 15', 'Insurance (other than health)'),
  interest_expense: on('Line 16b', 'Interest: other'),
  legal_professional: on('Line 17', 'Legal and professional services'),
  office_expense: on('Line 18', 'Office expense'),
  retirement_plans: on('Line 19', 'Pension and profit-sharing plans'),
  rent_equipment: on('Line 20a', 'Rent: vehicles, machinery, equipment'),
  rent_property: on('Line 20b', 'Rent: other business property'),
  repairs: on('Line 21', 'Repairs and maintenance'),
  supplies: on('Line 22', 'Supplies'),
  taxes_licenses: on('Line 23', 'Taxes and licenses'),
  travel: on('Line 24a', 'Travel'),
  meals: on('Line 24b', 'Deductible meals'),
  utilities: on('Line 25', 'Utilities'),
  wages: on('Line 26', 'Wages'),
  officer_comp: not('Not on Schedule C (a sole owner has no officer salary)'),
  guaranteed_payments: not('Not on Schedule C'),
  bad_debts: on('Line 27b', 'Other expenses (Part V)'),
  other_expenses: on('Line 27b', 'Other expenses (Part V)'),
  nondeductible: NOT_DEDUCTIBLE,
  income_tax: not('Not deductible (personal income tax)'),
  cash: NO_BALANCE_SHEET,
  accounts_receivable: NO_BALANCE_SHEET,
  inventory: on('Part III, lines 35 and 41', 'Inventory at beginning and end of year'),
  other_current_assets: NO_BALANCE_SHEET,
  loans_to_owners: NO_BALANCE_SHEET,
  fixed_assets: not('Not on Schedule C. Depreciation is figured on Form 4562.'),
  accumulated_depreciation: NO_BALANCE_SHEET,
  other_assets: NO_BALANCE_SHEET,
  accounts_payable: NO_BALANCE_SHEET,
  short_term_loans: NO_BALANCE_SHEET,
  other_current_liabilities: NO_BALANCE_SHEET,
  loans_from_owners: NO_BALANCE_SHEET,
  long_term_loans: NO_BALANCE_SHEET,
  other_liabilities: NO_BALANCE_SHEET,
  owner_equity: not('Not on Schedule C (owner money in or out is not income or expense)'),
  partners_capital: NO_BALANCE_SHEET,
  capital_stock: NO_BALANCE_SHEET,
  paid_in_capital: NO_BALANCE_SHEET,
  retained_earnings: NO_BALANCE_SHEET,
  distributions: not('Not on Schedule C (owner draws are not an expense)'),
  opening_balance: NO_BALANCE_SHEET
}

const OTHER_DEDUCTIONS_1065 = on('Line 21', 'Other deductions')

const FORM_1065_2025: FormTable = {
  gross_receipts: on('Line 1a', 'Gross receipts or sales'),
  returns_allowances: on('Line 1b', 'Returns and allowances'),
  other_income: on('Line 7', 'Other income'),
  interest_income: on('Schedule K, line 5', 'Interest income'),
  cogs_purchases: on('Form 1125-A, line 2', 'Purchases'),
  cogs_materials: on('Form 1125-A, line 2', 'Purchases'),
  cogs_labor: on('Form 1125-A, line 3', 'Cost of labor'),
  cogs_other: on('Form 1125-A, line 5', 'Other costs'),
  advertising: OTHER_DEDUCTIONS_1065,
  car_truck: OTHER_DEDUCTIONS_1065,
  commissions_fees: OTHER_DEDUCTIONS_1065,
  contract_labor: OTHER_DEDUCTIONS_1065,
  depreciation: on('Line 16a', 'Depreciation'),
  employee_benefits: on('Line 19', 'Employee benefit programs'),
  insurance: OTHER_DEDUCTIONS_1065,
  interest_expense: on('Line 15', 'Interest'),
  legal_professional: OTHER_DEDUCTIONS_1065,
  office_expense: OTHER_DEDUCTIONS_1065,
  retirement_plans: on('Line 18', 'Retirement plans'),
  rent_equipment: on('Line 13', 'Rent'),
  rent_property: on('Line 13', 'Rent'),
  repairs: on('Line 11', 'Repairs and maintenance'),
  supplies: OTHER_DEDUCTIONS_1065,
  taxes_licenses: on('Line 14', 'Taxes and licenses'),
  travel: OTHER_DEDUCTIONS_1065,
  meals: OTHER_DEDUCTIONS_1065,
  utilities: OTHER_DEDUCTIONS_1065,
  wages: on('Line 9', 'Salaries and wages (other than to partners)'),
  officer_comp: not('Not on Form 1065 (partners are paid by guaranteed payments, line 10)'),
  guaranteed_payments: on('Line 10', 'Guaranteed payments to partners'),
  bad_debts: on('Line 12', 'Bad debts'),
  other_expenses: OTHER_DEDUCTIONS_1065,
  nondeductible: NOT_DEDUCTIBLE,
  income_tax: not('Not deductible (partnerships don’t pay federal income tax)'),
  cash: on('Schedule L, line 1', 'Cash'),
  accounts_receivable: on('Schedule L, line 2a', 'Trade notes and accounts receivable'),
  inventory: on('Schedule L, line 3', 'Inventories'),
  other_current_assets: on('Schedule L, line 6', 'Other current assets'),
  loans_to_owners: on('Schedule L, line 7a', 'Loans to partners'),
  fixed_assets: on('Schedule L, line 9a', 'Buildings and other depreciable assets'),
  accumulated_depreciation: on('Schedule L, line 9b', 'Less accumulated depreciation'),
  other_assets: on('Schedule L, line 13', 'Other assets'),
  accounts_payable: on('Schedule L, line 15', 'Accounts payable'),
  short_term_loans: on('Schedule L, line 16', 'Mortgages, notes, bonds payable in less than 1 year'),
  other_current_liabilities: on('Schedule L, line 17', 'Other current liabilities'),
  loans_from_owners: on('Schedule L, line 19a', 'Loans from partners'),
  long_term_loans: on('Schedule L, line 19b', 'Mortgages, notes, bonds payable in 1 year or more'),
  other_liabilities: on('Schedule L, line 20', 'Other liabilities'),
  owner_equity: on('Schedule L, line 21', "Partners' capital accounts"),
  partners_capital: on('Schedule L, line 21', "Partners' capital accounts"),
  capital_stock: on('Schedule L, line 21', "Partners' capital accounts"),
  paid_in_capital: on('Schedule L, line 21', "Partners' capital accounts"),
  retained_earnings: on('Schedule L, line 21', "Partners' capital accounts"),
  distributions: on('Schedule M-2, line 6a', 'Distributions: cash'),
  opening_balance: on('Schedule L, line 21', "Partners' capital accounts")
}

/** Balance sheet and most deductions are numbered the same on 1120-S and 1120; page 1 differs. */
function corporateBalanceSheet(): Pick<
  FormTable,
  | 'cash' | 'accounts_receivable' | 'inventory' | 'other_current_assets' | 'loans_to_owners'
  | 'fixed_assets' | 'accumulated_depreciation' | 'other_assets' | 'accounts_payable'
  | 'short_term_loans' | 'other_current_liabilities' | 'loans_from_owners' | 'long_term_loans'
  | 'other_liabilities' | 'paid_in_capital'
> {
  return {
    cash: on('Schedule L, line 1', 'Cash'),
    accounts_receivable: on('Schedule L, line 2a', 'Trade notes and accounts receivable'),
    inventory: on('Schedule L, line 3', 'Inventories'),
    other_current_assets: on('Schedule L, line 6', 'Other current assets'),
    loans_to_owners: on('Schedule L, line 7', 'Loans to shareholders'),
    fixed_assets: on('Schedule L, line 10a', 'Buildings and other depreciable assets'),
    accumulated_depreciation: on('Schedule L, line 10b', 'Less accumulated depreciation'),
    other_assets: on('Schedule L, line 14', 'Other assets'),
    accounts_payable: on('Schedule L, line 16', 'Accounts payable'),
    short_term_loans: on('Schedule L, line 17', 'Mortgages, notes, bonds payable in less than 1 year'),
    other_current_liabilities: on('Schedule L, line 18', 'Other current liabilities'),
    loans_from_owners: on('Schedule L, line 19', 'Loans from shareholders'),
    long_term_loans: on('Schedule L, line 20', 'Mortgages, notes, bonds payable in 1 year or more'),
    other_liabilities: on('Schedule L, line 21', 'Other liabilities'),
    paid_in_capital: on('Schedule L, line 23', 'Additional paid-in capital')
  }
}

const OTHER_DEDUCTIONS_1120S = on('Line 20', 'Other deductions')

const FORM_1120S_2025: FormTable = {
  gross_receipts: on('Line 1a', 'Gross receipts or sales'),
  returns_allowances: on('Line 1b', 'Returns and allowances'),
  other_income: on('Line 5', 'Other income'),
  interest_income: on('Schedule K, line 4', 'Interest income'),
  cogs_purchases: on('Form 1125-A, line 2', 'Purchases'),
  cogs_materials: on('Form 1125-A, line 2', 'Purchases'),
  cogs_labor: on('Form 1125-A, line 3', 'Cost of labor'),
  cogs_other: on('Form 1125-A, line 5', 'Other costs'),
  advertising: on('Line 16', 'Advertising'),
  car_truck: OTHER_DEDUCTIONS_1120S,
  commissions_fees: OTHER_DEDUCTIONS_1120S,
  contract_labor: OTHER_DEDUCTIONS_1120S,
  depreciation: on('Line 14', 'Depreciation'),
  employee_benefits: on('Line 18', 'Employee benefit programs'),
  insurance: OTHER_DEDUCTIONS_1120S,
  interest_expense: on('Line 13', 'Interest'),
  legal_professional: OTHER_DEDUCTIONS_1120S,
  office_expense: OTHER_DEDUCTIONS_1120S,
  retirement_plans: on('Line 17', 'Pension, profit-sharing, etc., plans'),
  rent_equipment: on('Line 11', 'Rents'),
  rent_property: on('Line 11', 'Rents'),
  repairs: on('Line 9', 'Repairs and maintenance'),
  supplies: OTHER_DEDUCTIONS_1120S,
  taxes_licenses: on('Line 12', 'Taxes and licenses'),
  travel: OTHER_DEDUCTIONS_1120S,
  meals: OTHER_DEDUCTIONS_1120S,
  utilities: OTHER_DEDUCTIONS_1120S,
  wages: on('Line 8', 'Salaries and wages'),
  officer_comp: on('Line 7', 'Compensation of officers'),
  guaranteed_payments: not('Not on Form 1120-S (partnerships only)'),
  bad_debts: on('Line 10', 'Bad debts'),
  other_expenses: OTHER_DEDUCTIONS_1120S,
  nondeductible: NOT_DEDUCTIBLE,
  income_tax: not('Not deductible (S-corps generally don’t pay federal income tax)'),
  ...corporateBalanceSheet(),
  owner_equity: on('Schedule L, line 24', 'Retained earnings'),
  partners_capital: on('Schedule L, line 24', 'Retained earnings'),
  capital_stock: on('Schedule L, line 22', 'Capital stock'),
  retained_earnings: on('Schedule L, line 24', 'Retained earnings'),
  distributions: on('Schedule M-2, line 7', 'Distributions'),
  opening_balance: on('Schedule L, line 24', 'Retained earnings')
}

const OTHER_DEDUCTIONS_1120 = on('Line 26', 'Other deductions')

const FORM_1120_2025: FormTable = {
  gross_receipts: on('Line 1a', 'Gross receipts or sales'),
  returns_allowances: on('Line 1b', 'Returns and allowances'),
  other_income: on('Line 10', 'Other income'),
  interest_income: on('Line 5', 'Interest'),
  cogs_purchases: on('Form 1125-A, line 2', 'Purchases'),
  cogs_materials: on('Form 1125-A, line 2', 'Purchases'),
  cogs_labor: on('Form 1125-A, line 3', 'Cost of labor'),
  cogs_other: on('Form 1125-A, line 5', 'Other costs'),
  advertising: on('Line 22', 'Advertising'),
  car_truck: OTHER_DEDUCTIONS_1120,
  commissions_fees: OTHER_DEDUCTIONS_1120,
  contract_labor: OTHER_DEDUCTIONS_1120,
  depreciation: on('Line 20', 'Depreciation'),
  employee_benefits: on('Line 24', 'Employee benefit programs'),
  insurance: OTHER_DEDUCTIONS_1120,
  interest_expense: on('Line 18', 'Interest'),
  legal_professional: OTHER_DEDUCTIONS_1120,
  office_expense: OTHER_DEDUCTIONS_1120,
  retirement_plans: on('Line 23', 'Pension, profit-sharing, etc., plans'),
  rent_equipment: on('Line 16', 'Rents'),
  rent_property: on('Line 16', 'Rents'),
  repairs: on('Line 14', 'Repairs and maintenance'),
  supplies: OTHER_DEDUCTIONS_1120,
  taxes_licenses: on('Line 17', 'Taxes and licenses'),
  travel: OTHER_DEDUCTIONS_1120,
  meals: OTHER_DEDUCTIONS_1120,
  utilities: OTHER_DEDUCTIONS_1120,
  wages: on('Line 13', 'Salaries and wages'),
  officer_comp: on('Line 12', 'Compensation of officers'),
  guaranteed_payments: not('Not on Form 1120 (partnerships only)'),
  bad_debts: on('Line 15', 'Bad debts'),
  other_expenses: OTHER_DEDUCTIONS_1120,
  nondeductible: NOT_DEDUCTIBLE,
  income_tax: not('Not deductible (Schedule M-1, line 2)'),
  ...corporateBalanceSheet(),
  owner_equity: on('Schedule L, line 25', 'Retained earnings: unappropriated'),
  partners_capital: on('Schedule L, line 25', 'Retained earnings: unappropriated'),
  capital_stock: on('Schedule L, line 22b', 'Capital stock: common stock'),
  retained_earnings: on('Schedule L, line 25', 'Retained earnings: unappropriated'),
  distributions: on('Schedule M-2, line 5a', 'Distributions: cash'),
  opening_balance: on('Schedule L, line 25', 'Retained earnings: unappropriated')
}

export const TAX_LINE_TABLES: { year: number; forms: Record<TaxForm, FormTable> }[] = [
  { year: 2025, forms: { schedule_c: SCHEDULE_C_2025, '1065': FORM_1065_2025, '1120s': FORM_1120S_2025, '1120': FORM_1120_2025 } }
]

/** The table for `year`, or the latest earlier one (the IRS publishes forms late in the year). */
export function taxTableFor(year: number): { year: number; forms: Record<TaxForm, FormTable> } {
  const sorted = [...TAX_LINE_TABLES].sort((a, b) => b.year - a.year)
  return sorted.find((t) => t.year <= year) ?? sorted[sorted.length - 1]
}

export function getTaxLine(category: TaxCategoryKey, form: TaxForm, year: number): TaxLine {
  return taxTableFor(year).forms[form][category]
}
