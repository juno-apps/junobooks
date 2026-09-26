import type { EntityTypeId } from './entities'
import type { AccountType, TaxCategoryKey } from './taxLines'

/**
 * Starting charts of accounts. A company's chart = the common accounts +
 * its industry template's extras + the equity/payroll accounts for its
 * entity type. Numbering: 1xxx assets, 2xxx liabilities, 3xxx equity,
 * 4xxx income, 5xxx cost of goods sold, 6xxx expenses.
 *
 * `accountantNote` marks a judgment call. The app shows it with a ⚑ and it
 * goes on the accountant package's "Notes for accountant" page.
 */

export type TemplateId = 'general' | 'product' | 'retail' | 'service'

export interface Template {
  id: TemplateId
  label: string
  hint: string
}

export const TEMPLATES: Template[] = [
  { id: 'general', label: 'General', hint: 'A basic chart for any business.' },
  { id: 'product', label: 'Product / manufacturing', hint: 'You make what you sell: materials, inventory, cost of goods sold.' },
  { id: 'retail', label: 'Retail / resale', hint: 'You buy finished goods and resell them.' },
  { id: 'service', label: 'Service', hint: 'You sell your time or skills; no inventory.' }
]

export function isTemplateId(value: string): value is TemplateId {
  return TEMPLATES.some((t) => t.id === value)
}

/** What an account is used for, beyond its type (e.g. which accounts are bank accounts). */
export type AccountSubtype =
  | '' | 'bank' | 'credit_card' | 'sales_tax' | 'payroll' | 'inventory'
  | 'fixed_asset' | 'contra' | 'cogs' | 'owner_draw' | 'opening_balance'

export type NormalBalance = 'debit' | 'credit'

export interface TemplateAccount {
  number: string
  name: string
  type: AccountType
  subtype: AccountSubtype
  /** Which side increases it. Usually follows the type; contra accounts are the exception. */
  normalBalance: NormalBalance
  taxCategory: TaxCategoryKey
  accountantNote: string
}

function acct(
  number: string,
  name: string,
  type: AccountType,
  taxCategory: TaxCategoryKey,
  opts: { subtype?: AccountSubtype; normal?: NormalBalance; note?: string } = {}
): TemplateAccount {
  const naturalSide: NormalBalance = type === 'asset' || type === 'expense' ? 'debit' : 'credit'
  return {
    number,
    name,
    type,
    subtype: opts.subtype ?? '',
    normalBalance: opts.normal ?? naturalSide,
    taxCategory,
    accountantNote: opts.note ?? ''
  }
}

const NOTE = {
  shipping:
    'Shipping charged to customers is recorded as sales (gross receipts). Confirm this is how you want it reported.',
  marketplaceFees:
    'Etsy/Amazon/payment processor fees are mapped to "Commissions and fees". Some preparers use "Other expenses" instead.',
  meals: 'Business meals are usually only 50% deductible. The full amount is recorded here; the limit is applied at tax time.',
  smallTools:
    'Tools and equipment are expensed here under the de minimis safe harbor (generally up to $2,500 per item, and it needs an annual election). Larger items should go to Equipment and be depreciated. Confirm the election.',
  inventory:
    'The inventory method (periodic count, FIFO, average, or expense-as-purchased) is still to be decided. See Phase 5.',
  materials:
    'Raw materials that become part of your products. On Schedule C this is "Materials and supplies" (line 38); on Form 1125-A it is included in Purchases. Confirm the treatment.',
  packaging: 'Product packaging is treated as a cost of goods sold. Some preparers expense it as supplies instead.',
  postage:
    'Shipping costs to send orders to customers. Mapped to "Other expenses"; confirm the line.',
  otherExpenses: 'Mapped to "Other expenses", which is itemized on the return. Confirm the category.',
  interestIncome: 'Interest income is usually reported separately from business income, not as sales.',
  officerComp:
    'S-corp and C-corp owners who work in the business must take a "reasonable" salary through payroll. Your accountant decides the amount.',
  llcStock:
    'An LLC taxed as an S-corp has membership interests, not stock. Your accountant decides how owner capital is shown on Schedule L.',
  openingBalance:
    'Temporary account used while entering opening balances. It should be zero once the opening balances are reviewed; your accountant will reclassify anything left.',
  partners: 'One capital, contribution, and distribution account is set up. Add one set per partner if your accountant wants them tracked separately.',
  corporateTax: 'C-corp federal income tax is not deductible on the return itself.'
}

const COMMON: TemplateAccount[] = [
  acct('1000', 'Checking account', 'asset', 'cash', { subtype: 'bank' }),
  acct('1010', 'Savings account', 'asset', 'cash', { subtype: 'bank' }),
  acct('1050', 'Petty cash', 'asset', 'cash'),
  acct('1100', 'Accounts receivable', 'asset', 'accounts_receivable'),
  acct('1500', 'Equipment', 'asset', 'fixed_assets', { subtype: 'fixed_asset' }),
  acct('1510', 'Accumulated depreciation', 'asset', 'accumulated_depreciation', { subtype: 'contra', normal: 'credit' }),
  acct('2000', 'Accounts payable', 'liability', 'accounts_payable'),
  acct('2100', 'Credit card', 'liability', 'other_current_liabilities', { subtype: 'credit_card' }),
  acct('2200', 'Sales tax payable', 'liability', 'other_current_liabilities', { subtype: 'sales_tax' }),
  acct('2500', 'Loans payable', 'liability', 'long_term_loans'),
  acct('3999', 'Opening balance equity', 'equity', 'opening_balance', { subtype: 'opening_balance', note: NOTE.openingBalance }),
  acct('4000', 'Sales', 'income', 'gross_receipts'),
  acct('4010', 'Shipping income', 'income', 'gross_receipts', { note: NOTE.shipping }),
  acct('4090', 'Refunds and returns', 'income', 'returns_allowances', { subtype: 'contra', normal: 'debit' }),
  acct('4900', 'Other income', 'income', 'other_income'),
  acct('4910', 'Interest income', 'income', 'interest_income', { note: NOTE.interestIncome }),
  acct('6000', 'Advertising and marketing', 'expense', 'advertising'),
  acct('6100', 'Marketplace and payment fees', 'expense', 'commissions_fees', { note: NOTE.marketplaceFees }),
  acct('6110', 'Bank fees', 'expense', 'other_expenses', { note: NOTE.otherExpenses }),
  acct('6150', 'Car and truck', 'expense', 'car_truck'),
  acct('6200', 'Contract labor', 'expense', 'contract_labor'),
  acct('6250', 'Depreciation', 'expense', 'depreciation'),
  acct('6300', 'Insurance', 'expense', 'insurance'),
  acct('6350', 'Interest expense', 'expense', 'interest_expense'),
  acct('6400', 'Legal and professional fees', 'expense', 'legal_professional'),
  acct('6450', 'Office expense', 'expense', 'office_expense'),
  acct('6460', 'Software and subscriptions', 'expense', 'office_expense'),
  acct('6550', 'Rent', 'expense', 'rent_property'),
  acct('6600', 'Repairs and maintenance', 'expense', 'repairs'),
  acct('6650', 'Supplies', 'expense', 'supplies'),
  acct('6700', 'Small tools and equipment', 'expense', 'supplies', { note: NOTE.smallTools }),
  acct('6750', 'Taxes and licenses', 'expense', 'taxes_licenses'),
  acct('6800', 'Travel', 'expense', 'travel'),
  acct('6850', 'Meals', 'expense', 'meals', { note: NOTE.meals }),
  acct('6900', 'Utilities and phone', 'expense', 'utilities'),
  acct('6950', 'Postage and shipping', 'expense', 'other_expenses', { note: NOTE.postage }),
  acct('6990', 'Other expenses', 'expense', 'other_expenses', { note: NOTE.otherExpenses }),
  acct('6995', 'Penalties and nondeductible', 'expense', 'nondeductible')
]

const BY_TEMPLATE: Record<TemplateId, TemplateAccount[]> = {
  general: [],
  product: [
    acct('1300', 'Inventory: raw materials', 'asset', 'inventory', { subtype: 'inventory', note: NOTE.inventory }),
    acct('1310', 'Inventory: finished goods', 'asset', 'inventory', { subtype: 'inventory', note: NOTE.inventory }),
    acct('5000', 'Materials', 'expense', 'cogs_materials', { subtype: 'cogs', note: NOTE.materials }),
    acct('5100', 'Production labor', 'expense', 'cogs_labor', { subtype: 'cogs' }),
    acct('5200', 'Outside production services', 'expense', 'cogs_other', { subtype: 'cogs' }),
    acct('5300', 'Packaging', 'expense', 'cogs_other', { subtype: 'cogs', note: NOTE.packaging })
  ],
  retail: [
    acct('1300', 'Inventory: merchandise', 'asset', 'inventory', { subtype: 'inventory', note: NOTE.inventory }),
    acct('5000', 'Merchandise purchases', 'expense', 'cogs_purchases', { subtype: 'cogs' }),
    acct('5100', 'Freight in', 'expense', 'cogs_other', { subtype: 'cogs' }),
    acct('5300', 'Packaging', 'expense', 'cogs_other', { subtype: 'cogs', note: NOTE.packaging })
  ],
  service: [
    acct('6960', 'Professional development', 'expense', 'other_expenses', { note: NOTE.otherExpenses }),
    acct('6970', 'Dues and memberships', 'expense', 'other_expenses', { note: NOTE.otherExpenses })
  ]
}

const PAYROLL: TemplateAccount[] = [
  acct('2300', 'Payroll liabilities', 'liability', 'other_current_liabilities', { subtype: 'payroll' }),
  acct('6010', 'Officer compensation', 'expense', 'officer_comp', { note: NOTE.officerComp }),
  acct('6020', 'Wages', 'expense', 'wages'),
  acct('6030', 'Payroll taxes', 'expense', 'taxes_licenses')
]

function corporateEquity(entity: EntityTypeId): TemplateAccount[] {
  const stockNote = entity === 'llc_s_corp' ? NOTE.llcStock : ''
  return [
    acct('2400', 'Loans from shareholders', 'liability', 'loans_from_owners'),
    acct('3000', entity === 'llc_s_corp' ? "Members' capital" : 'Common stock', 'equity', 'capital_stock', { note: stockNote }),
    acct('3100', 'Additional paid-in capital', 'equity', 'paid_in_capital'),
    acct('3300', 'Retained earnings', 'equity', 'retained_earnings')
  ]
}

function byEntity(entity: EntityTypeId): TemplateAccount[] {
  switch (entity) {
    case 'sole_prop':
    case 'smllc':
      return [
        acct('3000', "Owner's capital", 'equity', 'owner_equity'),
        acct('3100', 'Owner contributions', 'equity', 'owner_equity'),
        acct('3200', 'Owner draws', 'equity', 'distributions', { subtype: 'owner_draw', normal: 'debit' })
      ]
    case 'mmllc':
    case 'partnership':
      return [
        acct('2400', 'Loans from partners', 'liability', 'loans_from_owners'),
        acct('3000', "Partners' capital", 'equity', 'partners_capital', { note: NOTE.partners }),
        acct('3100', 'Partner contributions', 'equity', 'partners_capital'),
        acct('3200', 'Partner distributions', 'equity', 'distributions', { subtype: 'owner_draw', normal: 'debit' }),
        acct('6040', 'Guaranteed payments to partners', 'expense', 'guaranteed_payments')
      ]
    case 'llc_s_corp':
    case 's_corp':
      return [
        ...corporateEquity(entity),
        acct('3200', 'Shareholder distributions', 'equity', 'distributions', { subtype: 'owner_draw', normal: 'debit' }),
        ...PAYROLL
      ]
    case 'c_corp':
      return [
        ...corporateEquity(entity),
        acct('2600', 'Income taxes payable', 'liability', 'other_current_liabilities'),
        acct('3200', 'Dividends paid', 'equity', 'distributions', { subtype: 'owner_draw', normal: 'debit' }),
        ...PAYROLL,
        acct('6980', 'Federal income tax', 'expense', 'income_tax', { note: NOTE.corporateTax })
      ]
  }
}

/** The full starting chart for a template and entity type, sorted by number. */
export function buildChart(template: TemplateId, entity: EntityTypeId): TemplateAccount[] {
  return [...COMMON, ...BY_TEMPLATE[template], ...byEntity(entity)].sort((a, b) => a.number.localeCompare(b.number))
}
