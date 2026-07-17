/** Printable business documents — tax invoice, dispatch manifest, statement. */

import i18n from '../i18n'
import { billingAmounts } from '../store'
import { bahtText, bahtTextEn, money } from './money'
import type {
  BillingRecord, DeliveryLocation, Driver, PlanResult, Settings, TransportPartner, Truck,
} from '../types'

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const isTh = () => i18n.language === 'th'
const dt = (iso: string) =>
  new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(
    isTh() ? 'th-TH' : 'en-GB',
    { year: 'numeric', month: 'short', day: 'numeric' },
  )

/** Open a print window with an A4-styled document and auto-print. */
function openPrintDoc(title: string, inner: string) {
  const html = `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8">
  <title>${esc(title)}</title>
  <style>
    * { font-family: 'Noto Sans Thai', system-ui, sans-serif; box-sizing: border-box; }
    body { margin: 0; color: #0f172a; background: #f1f5f9; }
    .page { width: 210mm; min-height: 297mm; margin: 12px auto; background: #fff; padding: 18mm 16mm;
      box-shadow: 0 2px 12px rgba(0,0,0,.12); }
    .row { display: flex; justify-content: space-between; align-items: flex-start; }
    .brand { font-size: 20px; font-weight: 700; color: #1f63b8; }
    .muted { color: #64748b; font-size: 12px; line-height: 1.5; }
    .doc-title { text-align: right; }
    .doc-title h1 { margin: 0; font-size: 22px; letter-spacing: 1px; }
    .doc-title .sub { color: #64748b; font-size: 12px; }
    .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 12.5px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 18px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
    th { background: #1f63b8; color: #fff; padding: 8px 10px; text-align: left; font-weight: 600; }
    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
    td.r, th.r { text-align: right; }
    td.c, th.c { text-align: center; }
    tfoot td { border-bottom: none; }
    .totals { width: 46%; margin-left: auto; margin-top: 10px; font-size: 13px; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
    .totals .grand { border-top: 2px solid #0f172a; margin-top: 6px; padding-top: 8px; font-weight: 700; font-size: 15px; }
    .words { margin-top: 10px; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0;
      border-radius: 8px; font-size: 12.5px; }
    .sign { display: flex; justify-content: space-between; margin-top: 48px; font-size: 12px; }
    .sign div { border-top: 1px solid #0f172a; padding-top: 6px; width: 200px; text-align: center; }
    .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    .paid { background: #dcfce7; color: #166534; } .due { background: #fef9c3; color: #854d0e; }
    .over { background: #fee2e2; color: #991b1b; }
    @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; } .noprint { display: none; } }
    .bar { position: sticky; top: 0; text-align: center; padding: 8px; background: #0f172a; }
    .bar button { font: 600 13px sans-serif; padding: 8px 20px; border: 0; border-radius: 8px;
      background: #2a78d6; color: #fff; cursor: pointer; }
  </style></head><body>
    <div class="bar noprint"><button onclick="window.print()">${isTh() ? 'พิมพ์ / บันทึกเป็น PDF' : 'Print / Save as PDF'}</button></div>
    <div class="page">${inner}</div>
    <script>window.onload = () => setTimeout(() => window.print(), 350)</script>
  </body></html>`
  const w = window.open('', '_blank', 'width=920,height=900')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

function letterhead(s: Settings) {
  const t = i18n.t.bind(i18n)
  return `<div class="row">
    <div>
      <div class="brand">${esc(s.companyName)}</div>
      <div class="muted">${esc(s.companyAddress)}<br>${t('doc.taxId')}: ${esc(s.companyTaxId)}</div>
    </div>`
}

/* ------------------------------- Tax Invoice ------------------------------- */

export function printInvoice(b: BillingRecord, partner: TransportPartner | undefined, s: Settings) {
  const t = i18n.t.bind(i18n)
  const a = billingAmounts(b)
  const surcharge = b.subtotal * (b.fuelSurchargePct / 100)
  const words = isTh() ? bahtText(a.netPayable) : bahtTextEn(a.netPayable)

  const lines = [
    [`${t('doc.transportService')} — ${b.routesCount} ${t('payments.routes')} · ${money(b.distanceKm)} ${t('common.km')}`, money(b.subtotal)],
  ]
  if (surcharge > 0)
    lines.push([`${t('payments.fuelSurcharge')} (${b.fuelSurchargePct}%)`, money(surcharge)])

  const inner = `${letterhead(s)}
      <div class="doc-title">
        <h1>${t('doc.taxInvoice')}</h1>
        <div class="sub">${t('doc.originalCopy')}</div>
        <div class="muted">${t('payments.invoiceNo')}: <b>${esc(b.invoiceNo)}</b></div>
      </div>
    </div>
    <div class="grid2">
      <div class="box">
        <b>${t('doc.billTo')}</b><br>
        ${esc(partner?.name ?? '—')}<br>
        <span class="muted">${esc(partner?.contactPerson ?? '')} ${partner?.phone ? '· ' + esc(partner.phone) : ''}<br>${esc(partner?.email ?? '')}</span>
      </div>
      <div class="box">
        <div class="row"><span>${t('payments.billingDate')}</span><b>${dt(b.billingDate)}</b></div>
        <div class="row"><span>${t('payments.dueDate')}</span><b>${dt(b.dueDate)}</b></div>
        <div class="row"><span>${t('common.status')}</span><b>${t(`payments.statuses.${b.status}`)}</b></div>
      </div>
    </div>
    <table>
      <thead><tr><th>${t('doc.description')}</th><th class="r">${t('doc.amount')} (${t('common.baht')})</th></tr></thead>
      <tbody>${lines.map((l) => `<tr><td>${l[0]}</td><td class="r">${l[1]}</td></tr>`).join('')}</tbody>
    </table>
    <div class="totals">
      <div><span>${t('doc.subtotal')}</span><span>${money(a.base)}</span></div>
      <div><span>${t('payments.vat')} ${b.vatPct}%</span><span>${money(a.vat)}</span></div>
      <div><span>${t('payments.wht')} ${b.whtPct}%</span><span>− ${money(a.wht)}</span></div>
      <div class="grand"><span>${t('payments.netPayable')}</span><span>${money(a.netPayable)} ${t('common.baht')}</span></div>
    </div>
    <div class="words"><b>${t('doc.amountInWords')}:</b> ${esc(words)}</div>
    ${b.note ? `<div class="muted" style="margin-top:8px">${t('payments.note')}: ${esc(b.note)}</div>` : ''}
    <div class="sign"><div>${t('doc.authorizedBy')}</div><div>${t('doc.receivedBy')}</div></div>`

  openPrintDoc(`${t('doc.taxInvoice')} ${b.invoiceNo}`, inner)
}

/* --------------------------- Monthly Statement ----------------------------- */

export function printStatement(
  partner: TransportPartner,
  billings: BillingRecord[],
  monthLabel: string,
  s: Settings,
) {
  const t = i18n.t.bind(i18n)
  const today = new Date().toISOString().slice(0, 10)
  let totalNet = 0
  let outstanding = 0

  const rows = billings
    .sort((x, y) => x.billingDate.localeCompare(y.billingDate))
    .map((b) => {
      const a = billingAmounts(b)
      totalNet += a.netPayable
      const overdue = b.status !== 'paid' && b.dueDate < today
      if (b.status !== 'paid') outstanding += a.netPayable
      const cls = b.status === 'paid' ? 'paid' : overdue ? 'over' : 'due'
      const label = b.status === 'paid' ? t('payments.statuses.paid') : overdue ? t('payments.overdue') : t('payments.outstanding')
      return `<tr>
        <td>${esc(b.invoiceNo)}</td>
        <td>${dt(b.billingDate)}</td>
        <td>${dt(b.dueDate)}</td>
        <td class="r">${money(a.netPayable)}</td>
        <td class="c"><span class="pill ${cls}">${label}</span></td>
      </tr>`
    })
    .join('')

  const inner = `${letterhead(s)}
      <div class="doc-title">
        <h1>${t('doc.statement')}</h1>
        <div class="sub">${esc(monthLabel)}</div>
      </div>
    </div>
    <div class="grid2">
      <div class="box"><b>${t('doc.statementFor')}</b><br>${esc(partner.name)}<br>
        <span class="muted">${t('partners.creditDays')}: ${partner.creditDays} · ${esc(partner.email)}</span></div>
      <div class="box">
        <div class="row"><span>${t('doc.invoiceCount')}</span><b>${billings.length}</b></div>
        <div class="row"><span>${t('payments.totalBilled')}</span><b>${money(totalNet)} ${t('common.baht')}</b></div>
        <div class="row"><span>${t('payments.outstanding')}</span><b>${money(outstanding)} ${t('common.baht')}</b></div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th>${t('payments.invoiceNo')}</th><th>${t('payments.billingDate')}</th>
        <th>${t('payments.dueDate')}</th><th class="r">${t('payments.netPayable')}</th>
        <th class="c">${t('common.status')}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="3"><b>${t('common.total')}</b></td>
        <td class="r"><b>${money(totalNet)}</b></td><td></td>
      </tr></tfoot>
    </table>
    <div class="words"><b>${t('payments.outstanding')}:</b> ${money(outstanding)} ${t('common.baht')} — ${esc(isTh() ? bahtText(outstanding) : bahtTextEn(outstanding))}</div>`

  openPrintDoc(`${t('doc.statement')} — ${partner.name}`, inner)
}

/* --------------------------- Dispatch Manifest ----------------------------- */

interface ManifestCtx {
  trucks: Truck[]
  drivers: Driver[]
  partners: TransportPartner[]
  locations: DeliveryLocation[]
  settings: Settings
}

export function printManifest(plan: PlanResult, ctx: ManifestCtx) {
  const t = i18n.t.bind(i18n)
  const { settings: s } = ctx
  const truckById = new Map(ctx.trucks.map((x) => [x.id, x]))
  const partnerById = new Map(ctx.partners.map((x) => [x.id, x]))
  const driverByTruck = new Map(ctx.drivers.filter((d) => d.truckId).map((d) => [d.truckId as string, d]))

  let tKm = 0, tM3 = 0, tKg = 0, tCost = 0
  const rows = plan.routes
    .map((r) => {
      const truck = truckById.get(r.truckId)
      const partner = truck ? partnerById.get(truck.partnerId) : undefined
      const driver = driverByTruck.get(r.truckId)
      tKm += r.distanceKm; tM3 += r.totalM3; tKg += r.totalKg; tCost += r.cost
      return `<tr>
        <td><b>${esc(truck?.plateNumber ?? r.truckId)}</b><br><span class="muted">${t('planner.round')} ${r.round}</span></td>
        <td>${esc(driver ? (isTh() ? driver.nameTh || driver.name : driver.name) : '—')}<br><span class="muted">${esc(partner?.name ?? '')}</span></td>
        <td class="c">${r.stops.length}</td>
        <td class="r">${money(r.totalM3)}</td>
        <td class="r">${money(r.totalKg)}</td>
        <td class="r">${money(r.distanceKm)}</td>
        <td class="c">${t(`planner.statuses.${r.status ?? 'planned'}`)}</td>
      </tr>`
    })
    .join('')

  const inner = `${letterhead(s)}
      <div class="doc-title">
        <h1>${t('doc.manifest')}</h1>
        <div class="sub">${dt(plan.plannedAt.slice(0, 10))}</div>
        <div class="muted">${esc(s.depotName)}</div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th>${t('trucks.title')}</th><th>${t('trucks.driver')} / ${t('costs.partner')}</th>
        <th class="c">${t('planner.stops')}</th><th class="r">${t('common.m3')}</th>
        <th class="r">${t('common.kg')}</th><th class="r">${t('common.km')}</th>
        <th class="c">${t('planner.status')}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="2"><b>${t('common.total')}</b></td>
        <td class="c"><b>${plan.routes.reduce((n, r) => n + r.stops.length, 0)}</b></td>
        <td class="r"><b>${money(tM3)}</b></td>
        <td class="r"><b>${money(tKg)}</b></td>
        <td class="r"><b>${money(tKm)}</b></td>
        <td class="c"><b>${money(tCost)} ${t('common.baht')}</b></td>
      </tr></tfoot>
    </table>
    <div class="sign"><div>${t('doc.preparedBy')}</div><div>${t('doc.approvedBy')}</div></div>`

  openPrintDoc(t('doc.manifest'), inner)
}
