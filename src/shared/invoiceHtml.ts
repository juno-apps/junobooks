import { formatQuantity } from './inventory'
import { formatCents } from './money'
import { formatRate, type BusinessDetails, type Customer, type Invoice } from './sales'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const lines = (s: string): string => esc(s).replace(/\r?\n/g, '<br>')

/** A printable invoice page (saved as PDF by the main process). */
export function invoiceHtml(
  inv: Invoice,
  business: BusinessDetails,
  customer: Pick<Customer, 'name' | 'email' | 'address'>
): string {
  const rows = inv.lines
    .map(
      (l) => `<tr><td>${esc(l.description)}</td><td class="n">${formatQuantity(l.quantityMilli)}</td>
        <td class="n">${formatCents(l.unitPriceCents)}</td><td class="n">${formatCents(l.amountCents)}</td></tr>`
    )
    .join('')
  const tax = inv.taxExempt
    ? `<tr><td colspan="3">Sales tax: exempt${inv.exemptReason ? ` (${esc(inv.exemptReason)})` : ''}</td><td class="n">${formatCents(0)}</td></tr>`
    : inv.taxCents
      ? `<tr><td colspan="3">Sales tax (${formatRate(inv.taxRateMilli)})</td><td class="n">${formatCents(inv.taxCents)}</td></tr>`
      : ''
  const paid = inv.paidCents
    ? `<tr><td colspan="3">Paid</td><td class="n">−${formatCents(inv.paidCents)}</td></tr>
       <tr class="total"><td colspan="3">Balance due</td><td class="n">${formatCents(inv.totalCents - inv.paidCents)}</td></tr>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(inv.number)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #222; margin: 40px; font-size: 13px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: 1px; }
  .top { display: flex; justify-content: space-between; margin-bottom: 28px; }
  .muted { color: #666; }
  .box { margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; border-bottom: 2px solid #333; padding: 6px 4px; font-size: 12px; }
  td { padding: 6px 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; }
  th.n { text-align: right; }
  tfoot td { border-bottom: none; }
  tr.total td { font-weight: 700; font-size: 15px; border-top: 2px solid #333; }
  .memo { margin-top: 24px; white-space: pre-wrap; }
  .void { color: #a12622; font-size: 20px; font-weight: 700; }
</style></head><body>
<div class="top">
  <div><h1>INVOICE</h1>${inv.status === 'void' ? '<div class="void">VOID</div>' : ''}
    <div><strong>${esc(business.name)}</strong></div>
    ${business.address ? `<div class="muted">${lines(business.address)}</div>` : ''}
    ${business.email ? `<div class="muted">${esc(business.email)}</div>` : ''}
    ${business.phone ? `<div class="muted">${esc(business.phone)}</div>` : ''}
  </div>
  <div class="n">
    <div>Invoice <strong>${esc(inv.number)}</strong></div>
    <div>Date: ${inv.issueDate}</div>
    <div>Due: ${inv.dueDate}</div>
  </div>
</div>
<div class="box"><div class="muted">Bill to</div><strong>${esc(customer.name)}</strong>
  ${customer.address ? `<div>${lines(customer.address)}</div>` : ''}${customer.email ? `<div>${esc(customer.email)}</div>` : ''}</div>
<table>
  <thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr><td colspan="3">Subtotal</td><td class="n">${formatCents(inv.subtotalCents)}</td></tr>
    ${tax}
    <tr class="total"><td colspan="3">Total</td><td class="n">${formatCents(inv.totalCents)}</td></tr>
    ${paid}
  </tfoot>
</table>
${inv.memo ? `<div class="memo">${lines(inv.memo)}</div>` : ''}
</body></html>`
}
