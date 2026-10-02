import { formatCents } from './money'
import type { AccountantNote } from './pkg'
import type { BalanceSheet, ProfitAndLoss } from './reports'
import type { ChannelSales, CogsSchedule } from './reportsExtra'
import type { TieOutRow } from './form1099k'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface SummaryData {
  companyName: string
  year: number
  entityLabel: string
  formLabel: string
  prepared: string
  pl: ProfitAndLoss
  bs: BalanceSheet
  channels: ChannelSales
  cogs: CogsSchedule
  tieOut: TieOutRow[]
  notes: AccountantNote[]
}

/** The one-page-plus summary saved as PDF in the accountant package. */
export function summaryHtml(d: SummaryData): string {
  const t = d.pl.columns.length - 1
  const row = (label: string, cents: number, strong = false): string =>
    `<tr${strong ? ' class="strong"' : ''}><td>${esc(label)}</td><td class="n">${formatCents(cents)}</td></tr>`
  const checks = d.notes.filter((n) => n.kind === 'check')
  const infos = d.notes.filter((n) => n.kind === 'note')
  const noteList = (list: AccountantNote[]): string =>
    list.length
      ? `<ul>${list.map((n) => `<li><strong>${esc(n.area)}:</strong> ${esc(n.text)}</li>`).join('')}</ul>`
      : '<p class="muted">None.</p>'
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.companyName)} ${d.year}</title><style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #222; margin: 36px; font-size: 12px; }
  h1 { font-size: 22px; margin: 0; } h2 { font-size: 15px; margin: 22px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  .muted { color: #666; } table { border-collapse: collapse; width: 100%; } td, th { padding: 3px 4px; text-align: left; }
  .n { text-align: right; white-space: nowrap; } tr.strong td { font-weight: 700; border-top: 1px solid #999; }
  .cols { display: flex; gap: 28px; } .cols > div { flex: 1; } li { margin: 2px 0; } .page { page-break-before: always; }
</style></head><body>
<h1>${esc(d.companyName)}: ${d.year} year-end summary</h1>
<div class="muted">${esc(d.entityLabel)} · ${esc(d.formLabel)} · prepared ${d.prepared} by JunoBooks</div>
<div class="cols">
  <div><h2>Profit and loss</h2><table>
    ${row('Income', d.pl.income.total[t])}${row('Cost of goods sold', d.pl.cogs.total[t])}${row('Gross profit', d.pl.grossProfit[t], true)}
    ${row('Expenses', d.pl.expenses.total[t])}${row('Net income', d.pl.netIncome[t], true)}
  </table></div>
  <div><h2>Balance sheet at ${d.bs.asOf}</h2><table>
    ${row('Assets', d.bs.assets.total[0], true)}${row('Liabilities', d.bs.liabilities.total[0])}${row('Equity', d.bs.equity.total[0])}
    ${row('Profit not yet closed into equity', d.bs.currentYearProfit + d.bs.priorYearsProfit)}
    ${row('Liabilities and equity', d.bs.totalLiabilitiesAndEquity, true)}
  </table><div class="muted">${d.bs.balanced ? 'Balanced.' : 'NOT BALANCED.'}</div></div>
</div>
<div class="cols">
  <div><h2>Sales by channel</h2><table>
    ${d.channels.channels.map((c) => row(c.name, c.netCents)).join('')}${row('Total (net of refunds)', d.channels.totalNetCents, true)}
  </table></div>
  <div><h2>Cost of goods sold</h2><table>
    ${row('Beginning inventory', d.cogs.beginningCents)}${row('Purchases, labor, materials, other', d.cogs.purchasesCents + d.cogs.laborCents + d.cogs.materialsCents + d.cogs.otherCents)}
    ${row('Ending inventory', d.cogs.endingCents)}${row('Cost of goods sold', d.cogs.cogsCents, true)}
  </table><div class="muted">Filed inventory method: ${esc(d.cogs.filedMethod ?? 'not chosen')}.</div></div>
</div>
<h2>1099-K tie-out</h2><table><tr><th>Platform</th><th class="n">Imported gross</th><th class="n">1099-K box 1a</th><th class="n">Difference</th></tr>
${d.tieOut
  .filter((r) => r.importedCents !== 0 || r.formCents !== null)
  .map(
    (r) =>
      `<tr><td>${esc(r.platform)}</td><td class="n">${r.imported ? formatCents(r.importedCents) : '—'}</td><td class="n">${r.formCents === null ? 'not entered' : formatCents(r.formCents)}</td><td class="n">${r.differenceCents === null ? '' : formatCents(r.differenceCents)}</td></tr>`
  )
  .join('')}</table>
<div class="page"><h1>Notes for the accountant</h1>
<h2>To check (${checks.length})</h2>${noteList(checks)}
<h2>For your information (${infos.length})</h2>${noteList(infos)}
<p class="muted">The workbook in this package has every report in full, one tab each.</p></div>
</body></html>`
}
