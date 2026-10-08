// C1: Contacts screen: add and edit a supplier, customers listed alongside, filters and inactive.
import { launch, createCompany, shot, check, done } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)

// A customer added the usual way (Invoices → Customers) shows up in Contacts.
await page.getByRole('button', { name: 'Invoices', exact: true }).click()
await page.getByRole('button', { name: /^Customers/ }).click()
await page.getByLabel('Customer name').fill('Bead Shop')
await page.getByRole('button', { name: 'Add customer' }).click()
await page.getByText('Customer added.').waitFor()
await page.getByRole('button', { name: 'Close' }).first().click()

await page.getByRole('button', { name: 'Contacts', exact: true }).click()
await page.getByRole('heading', { name: 'Contacts' }).waitFor()
check((await page.locator('.contact-list').innerText()).includes('Bead Shop'), 'customer shows in Contacts')

// Refused: no name
await page.getByRole('button', { name: 'Add a supplier' }).click()
await page.getByRole('button', { name: 'Add supplier' }).click()
check(await page.getByText('Enter the company’s name.').isVisible(), 'a supplier needs a name')

await page.getByLabel('Company name').fill('Hoover & Strong')
await page.getByLabel('Kind').selectOption('metal_dealer')
await page.getByLabel('Contact person').fill('Pat')
await page.getByLabel('Phone').fill('800-555-0199')
await page.getByLabel('Email', { exact: true }).fill('orders@example.com')
await page.getByLabel('Payment terms (days)').fill('30')
const box = page.getByRole('combobox', { name: 'What you usually buy from them' })
await box.click()
await box.fill('Materials')
await page.locator('.combobox-option', { hasText: 'Materials' }).first().click()
await shot(page, 'contacts-form')
await page.getByRole('button', { name: 'Add supplier' }).click()
await page.getByText('Hoover & Strong saved.').waitFor()
const list = await page.locator('.contact-list').innerText()
check(/Hoover & Strong\s+Refiner or metal dealer\s+Pat/.test(list), 'supplier listed with kind and contact')
check(list.indexOf('Bead Shop') < list.indexOf('Hoover'), 'list sorted by name')

// Duplicate name refused
await page.getByRole('button', { name: 'Add a supplier' }).click()
await page.getByLabel('Company name').fill('hoover & strong')
await page.getByRole('button', { name: 'Add supplier' }).click()
check(await page.getByText('There is already a supplier called hoover & strong.').isVisible(), 'duplicate name refused')
await page.getByRole('button', { name: 'Cancel' }).click()

// Filter and find
await page.getByRole('button', { name: /^Suppliers \(1\)/ }).click()
check(!(await page.locator('.contact-list').innerText()).includes('Bead Shop'), 'Suppliers filter hides customers')
await page.getByRole('button', { name: 'All', exact: true }).click()
await page.getByLabel('Find a contact').fill('555-0199')
check((await page.locator('.contact-list tbody tr').count()) === 1, 'find by phone')
await page.getByLabel('Find a contact').fill('')

// Edit: terms kept, mark inactive, then it hides until "Show inactive"
await page.locator('.contact-list tr', { hasText: 'Hoover' }).getByRole('button', { name: 'Edit' }).click()
check((await page.getByLabel('Payment terms (days)').inputValue()) === '30', 'edit form shows saved terms')
check(
  (await page.getByRole('combobox', { name: 'What you usually buy from them' }).inputValue()).includes('Materials'),
  'edit form shows saved account'
)
await page.getByLabel(/^Active/).uncheck()
await page.getByRole('button', { name: 'Save supplier' }).click()
await page.getByText('Hoover & Strong saved.').waitFor()
check(!(await page.locator('.contact-list').innerText()).includes('Hoover'), 'inactive supplier hidden')
await page.getByLabel(/Show 1 inactive/).check()
check((await page.locator('.contact-list').innerText()).includes('Hoover & Strong (inactive)'), 'shown when asked')
await shot(page, 'contacts-list')

// Customer row opens Invoices
await page.locator('.contact-list tr', { hasText: 'Bead Shop' }).getByRole('button', { name: 'Open in Invoices' }).click()
await page.getByRole('heading', { name: 'Sales and invoices' }).waitFor()
check(true, 'customer link opens Invoices')

await app.close()
done(errors)
