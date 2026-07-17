/** Printable driver route sheet — opens a clean print window for one route. */

import i18n from '../i18n'
import type { DeliveryLocation, Driver, PlannedRoute, TransportPartner, Truck } from '../types'

interface SheetInput {
  route: PlannedRoute
  truck?: Truck
  driver?: Driver
  partner?: TransportPartner
  depotName: string
  locById: Map<string, DeliveryLocation>
}

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Minutes-from-start → clock time, given the route's planned departure. */
function clock(startTime: string, addMinutes: number): string {
  const [h, m] = (startTime || '08:00').split(':').map(Number)
  const total = h * 60 + m + addMinutes
  const hh = Math.floor((total % 1440) / 60)
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function printRouteSheet({ route, truck, driver, partner, depotName, locById }: SheetInput) {
  const t = i18n.t.bind(i18n)
  const isTh = i18n.language === 'th'
  const name = (l?: DeliveryLocation) => (l ? (isTh ? l.nameTh || l.name : l.name) : '—')
  const start = route.startTime || '08:00'

  const rows = route.stops
    .map((s) => {
      const l = locById.get(s.locationId)
      const win = l?.windowStart && l?.windowEnd ? `${l.windowStart}–${l.windowEnd}` : ''
      return `<tr>
        <td class="c">${s.sequence}</td>
        <td>${esc(l?.code ?? '')}<br><span class="muted">${esc(name(l))}</span></td>
        <td class="c">${l?.demandM3 ?? 0} ${t('common.m3')}<br>${(l?.demandKg ?? 0).toLocaleString()} ${t('common.kg')}</td>
        <td class="c">${clock(start, s.etaMinutes)}<br><span class="muted">${win}</span></td>
        <td class="sig"></td>
      </tr>`
    })
    .join('')

  const html = `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8">
  <title>${t('ops.routeSheet')} — ${esc(truck?.plateNumber ?? route.truckId)}</title>
  <style>
    * { font-family: 'Noto Sans Thai', system-ui, sans-serif; }
    body { margin: 24px; color: #0f172a; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sub { color: #64748b; font-size: 13px; margin-bottom: 16px; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 16px; font-size: 13px;
      border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
    .meta b { display: block; color: #64748b; font-weight: 500; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; background: #2a78d6; color: #fff; padding: 8px; font-weight: 600; }
    td { padding: 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    td.c { text-align: center; white-space: nowrap; }
    .muted { color: #64748b; font-size: 11px; }
    .sig { width: 120px; border-bottom: 1px dashed #94a3b8; }
    .foot { margin-top: 24px; display: flex; justify-content: space-between; font-size: 13px; }
    .foot div { border-top: 1px solid #0f172a; padding-top: 6px; width: 200px; text-align: center; }
    @media print { body { margin: 0; } }
  </style></head><body>
    <h1>${t('ops.routeSheet')}</h1>
    <div class="sub">${esc(depotName)} · ${t('planner.round')} ${route.round}</div>
    <div class="meta">
      <div><b>${t('trucks.plate')}</b>${esc(truck?.plateNumber ?? route.truckId)}</div>
      <div><b>${t('trucks.driver')}</b>${esc(driver ? (isTh ? driver.nameTh || driver.name : driver.name) : '—')}</div>
      <div><b>${t('costs.partner')}</b>${esc(partner?.name ?? '—')}</div>
      <div><b>${t('ops.startTime')}</b>${esc(start)}</div>
      <div><b>${t('planner.distance')}</b>${route.distanceKm} ${t('common.km')}</div>
      <div><b>${t('planner.duration')}</b>${route.durationMinutes} ${t('common.min')}</div>
      <div><b>${t('planner.volume')}</b>${route.totalM3} ${t('common.m3')}</div>
      <div><b>${t('planner.weight')}</b>${route.totalKg.toLocaleString()} ${t('common.kg')}</div>
    </div>
    <table>
      <thead><tr>
        <th>${t('planner.seq')}</th><th>${t('locations.title')}</th>
        <th>${t('planner.volume')}/${t('planner.weight')}</th>
        <th>${t('planner.eta')} / ${t('locations.window')}</th>
        <th>${t('pod.receivedBy')}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="foot">
      <div>${t('trucks.driver')}</div>
      <div>${t('planner.depot')}</div>
    </div>
    <script>window.onload = () => { window.print() }</script>
  </body></html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  w.document.write(html)
  w.document.close()
}
