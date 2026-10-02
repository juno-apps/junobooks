import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invoiceHtml } from '../shared/invoiceHtml'
import { agingBucket, invoiceTotals, parseRate, type InvoiceInput } from '../shared/sales'
import { createCompany, openCompany, type CompanyBooks } from './companyStore'

let root: string
let books: CompanyBooks
const num = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.id
const bal = (n: string): number => books.chart().accounts.find((a) => a.number === n)!.balanceCents

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'junobooks-sales-'))
  books = openCompany(
    root,
    createCompany(root, {
      name: 'S',
      entityType: 'smllc',
      homeState: 'CA',
      booksStartDate: '2026-01-01',
      template: 'product'
    })
  )
})
afterEach(() => {
  books.close()
  rmSync(root, { recursive: true, force: true })
})

function customer(name = 'Bloom Boutique', isWholesale = false): number {
  return books
    .addCustomer({
      name,
      email: 'shop@example.com',
      phone: '',
      address: '1 Main St\nOakland CA',
      notes: '',
      isWholesale
    })
    .find((c) => c.name === name)!.id
}

function draft(customerId: number, over: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    number: books.nextInvoiceNumber(),
    customerId,
    issueDate: '2026-03-01',
    dueDate: '2026-03-31',
    memo: 'Thank you!',
    taxRateMilli: 7250,
    taxExempt: false,
    exemptReason: '',
    lines: [
      { description: 'Silver hoops', quantityMilli: 3000, unitPriceCents: 4500, accountId: num('4000'), taxable: true },
      { description: 'Shipping', quantityMilli: 1000, unitPriceCents: 1000, accountId: num('4010'), taxable: false }
    ],
    ...over
  }
}

describe('pure helpers', () => {
  it('rates, totals, aging buckets', () => {
    expect(parseRate('7.25')).toBe(7250)
    expect(parseRate('7.25%')).toBe(7250)
    expect(parseRate('101')).toBeNull()
    const t = invoiceTotals({ lines: draft(1).lines, taxRateMilli: 7250, taxExempt: false })
    expect(t).toMatchObject({ subtotalCents: 14500, taxableCents: 13500, taxCents: 979, totalCents: 15479 })
    expect(invoiceTotals({ lines: draft(1).lines, taxRateMilli: 7250, taxExempt: true }).taxCents).toBe(0)
    expect(agingBucket('2026-03-31', '2026-03-31')).toBe('currentCents')
    expect(agingBucket('2026-03-31', '2026-04-15')).toBe('days1to30')
    expect(agingBucket('2026-03-31', '2026-07-30')).toBe('over90')
  })
})

describe('customers and resale certificates', () => {
  it('adds customers and validates email', () => {
    customer()
    expect(() =>
      books.addCustomer({ name: 'X', email: 'nope', phone: '', address: '', notes: '', isWholesale: false })
    ).toThrow(/email/)
    expect(() =>
      books.addCustomer({ name: ' ', email: '', phone: '', address: '', notes: '', isWholesale: false })
    ).toThrow(/name/)
  })

  it('keeps certificates with a copy of the file, and knows when they are valid', () => {
    const c = customer('Gem Wholesale', true)
    const f = join(root, 'cert.pdf')
    writeFileSync(f, 'CDTFA-230')
    const certs = books.addCertificate({
      customerId: c,
      certNumber: 'SR AB 123-456',
      stateCode: 'CA',
      issuedDate: '2025-06-01',
      expiresDate: '2026-05-31',
      notes: '',
      filePath: f
    })
    expect(certs[0].storedPath).toBe('resale-certificates/Gem-Wholesale_SR-AB-123-456.pdf')
    expect(existsSync(books.certificateFile(certs[0].id))).toBe(true)
    expect(books.validCertificate(c, '2026-03-01')?.certNumber).toBe('SR AB 123-456')
    expect(books.validCertificate(c, '2026-06-01')).toBeNull()
    books.removeCertificate(certs[0].id, c)
    expect(books.certificates(c)).toEqual([])
    expect(() => books.db.prepare('DELETE FROM resale_certificates').run()).toThrow(/kept on record/)
  })
})

describe('invoices', () => {
  it('drafts change freely and post nothing; finalizing posts receivable, income and sales tax', () => {
    const c = customer()
    let inv = books.saveInvoiceDraft(null, draft(c))
    expect(inv).toMatchObject({ number: '1001', status: 'draft', totalCents: 15479, entryId: null })
    inv = books.saveInvoiceDraft(inv.id, { ...draft(c), number: '1001', memo: 'Changed' })
    expect(inv.memo).toBe('Changed')
    expect(books.entries()).toEqual([])
    inv = books.finalizeInvoice(inv.id)
    expect(inv).toMatchObject({ status: 'open', openCents: 15479 })
    expect(bal('1100')).toBe(15479)
    expect(bal('4000')).toBe(13500)
    expect(bal('4010')).toBe(1000)
    expect(bal('2200')).toBe(979)
    expect(() => books.saveInvoiceDraft(inv.id, draft(c))).toThrow(/can’t be changed/)
    expect(() => books.db.prepare('UPDATE invoices SET total_cents = 1 WHERE id = ?').run(inv.id)).toThrow(
      /can't be changed/
    )
    expect(() => books.db.prepare('DELETE FROM invoice_lines').run()).toThrow(/can't be changed/)
    expect(books.nextInvoiceNumber()).toBe('1002')
  })

  it('refuses duplicate numbers, missing accounts, and lines without a description', () => {
    const c = customer()
    books.saveInvoiceDraft(null, draft(c))
    expect(() => books.saveInvoiceDraft(null, { ...draft(c), number: '1001' })).toThrow(/already used/)
    expect(() =>
      books.saveInvoiceDraft(null, draft(c, { lines: [{ ...draft(c).lines[0], accountId: num('5000') }] }))
    ).toThrow(/income account/)
    expect(() =>
      books.saveInvoiceDraft(null, draft(c, { lines: [{ ...draft(c).lines[0], description: ' ' }] }))
    ).toThrow(/describe/)
    expect(() => books.saveInvoiceDraft(null, draft(c, { dueDate: '2026-02-01' }))).toThrow(/before the invoice date/)
  })

  it('a tax-exempt wholesale invoice posts no sales tax', () => {
    const c = customer('Gem Wholesale', true)
    const inv = books.finalizeInvoice(
      books.saveInvoiceDraft(null, draft(c, { taxExempt: true, exemptReason: 'Resale certificate SR 1 (CA)' })).id
    )
    expect(inv.taxCents).toBe(0)
    expect(bal('2200')).toBe(0)
  })

  it('voids an unpaid invoice (entry voided), deletes drafts only', () => {
    const c = customer()
    const d = books.saveInvoiceDraft(null, draft(c))
    const inv = books.finalizeInvoice(d.id)
    expect(() => books.deleteInvoiceDraft(inv.id)).toThrow(/Only a draft/)
    expect(() => books.voidInvoice(inv.id, '')).toThrow(/reason/)
    const v = books.voidInvoice(inv.id, 'Wrong customer')
    expect(v.status).toBe('void')
    expect(bal('1100')).toBe(0)
    const d2 = books.saveInvoiceDraft(null, draft(c))
    books.deleteInvoiceDraft(d2.id)
    expect(books.invoices().map((i) => i.number)).toEqual(['1001'])
  })

  it('makes printable HTML', () => {
    const c = customer()
    const inv = books.finalizeInvoice(books.saveInvoiceDraft(null, draft(c)).id)
    books.setBusinessDetails({ address: '9 Studio Way', email: 'hi@juno.example', phone: '555-0100' })
    const html = invoiceHtml(inv, books.businessDetails(), books.customers()[0])
    expect(html).toContain('Invoice <strong>1001</strong>')
    expect(html).toContain('Sales tax (7.25%)')
    expect(html).toContain('$154.79')
    expect(html).toContain('9 Studio Way')
  })
})

describe('payments', () => {
  it('applies a payment to invoices, posts it, and updates open balances and aging', () => {
    const c = customer()
    const a = books.finalizeInvoice(books.saveInvoiceDraft(null, draft(c)).id)
    const b = books.finalizeInvoice(
      books.saveInvoiceDraft(null, draft(c, { number: '1002', issueDate: '2026-01-10', dueDate: '2026-02-09' })).id
    )
    expect(books.aging('2026-04-15')).toEqual([
      expect.objectContaining({ days1to30: 15479, days61to90: 15479, totalCents: 30958 })
    ])
    books.recordPayment({
      customerId: c,
      date: '2026-04-15',
      amountCents: 20000,
      depositAccountId: num('1000'),
      method: 'Check',
      reference: '#552',
      applications: [
        { invoiceId: b.id, amountCents: 15479 },
        { invoiceId: a.id, amountCents: 4521 }
      ]
    })
    expect(books.invoice(b.id).status).toBe('paid')
    expect(books.invoice(a.id).openCents).toBe(10958)
    expect(books.customers()[0].openCents).toBe(10958)
    expect(bal('1000')).toBe(20000)
    expect(bal('1100')).toBe(10958)
    expect(() => books.voidInvoice(a.id, 'x')).toThrow(/Void those payments first/)
  })

  it('refuses mismatched or excessive applications, and voiding a payment reopens the invoice', () => {
    const c = customer()
    const a = books.finalizeInvoice(books.saveInvoiceDraft(null, draft(c)).id)
    const base = { customerId: c, date: '2026-04-01', depositAccountId: num('1000'), method: '', reference: '' }
    expect(() =>
      books.recordPayment({ ...base, amountCents: 100, applications: [{ invoiceId: a.id, amountCents: 50 }] })
    ).toThrow(/add up/)
    expect(() =>
      books.recordPayment({ ...base, amountCents: 99999, applications: [{ invoiceId: a.id, amountCents: 99999 }] })
    ).toThrow(/more than is still owed/)
    const other = customer('Other')
    expect(() =>
      books.recordPayment({
        ...base,
        customerId: other,
        amountCents: 100,
        applications: [{ invoiceId: a.id, amountCents: 100 }]
      })
    ).toThrow(/another customer/)
    const [p] = books.recordPayment({
      ...base,
      amountCents: 15479,
      applications: [{ invoiceId: a.id, amountCents: 15479 }]
    })
    expect(books.invoice(a.id).status).toBe('paid')
    books.voidPayment(p.id, 'Check bounced')
    expect(books.invoice(a.id).status).toBe('open')
    expect(bal('1000')).toBe(0)
    expect(() => books.db.prepare('DELETE FROM payments').run()).toThrow(/kept on record/)
  })
})
