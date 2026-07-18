/** Styled multi-sheet Excel export (exceljs). */

import ExcelJS from 'exceljs'
import i18n from '../i18n'
import { billingAmounts } from '../store'
import { planCostByPartner, routeCostBreakdown } from './cost'
import type {
  BillingRecord, DeliveryLocation, PlanResult, TransportPartner, Truck,
} from '../types'

interface ExportData {
  partners: TransportPartner[]
  trucks: Truck[]
  locations: DeliveryLocation[]
  plan: PlanResult | null
  depotName: string
}

const BRAND = 'FF2A78D6'
const t = (key: string) => i18n.t(key)

const INT = '#,##0'
const DEC = '#,##0.00'

function addTable(
  ws: ExcelJS.Worksheet,
  headers: { label: string; width?: number; numFmt?: string }[],
  rows: (string | number | null)[][],
) {
  const headerRow = ws.addRow(headers.map((h) => h.label))
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
    cell.alignment = { vertical: 'middle' }
    cell.border = { bottom: { style: 'thin' } }
  })
  headers.forEach((h, i) => {
    const col = ws.getColumn(i + 1)
    col.width = h.width ?? 18
    if (h.numFmt) col.numFmt = h.numFmt
  })
  for (const r of rows) {
    const row = ws.addRow(r)
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } } }
    })
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

function boldTotalRow(ws: ExcelJS.Worksheet, values: (string | number | null)[]) {
  const row = ws.addRow(values)
  row.eachCell((cell) => {
    cell.font = { bold: true }
    cell.border = { top: { style: 'thin' } }
  })
}

export async function exportToExcel(data: ExportData) {
  const { partners, trucks, locations, plan } = data
  const wb = new ExcelJS.Workbook()
  wb.creator = 'TMS Milkrun'
  wb.created = new Date()

  const partnerById = new Map(partners.map((p) => [p.id, p]))
  const truckById = new Map(trucks.map((tr) => [tr.id, tr]))
  const locById = new Map(locations.map((l) => [l.id, l]))
  const isTh = i18n.language === 'th'
  const locName = (l?: DeliveryLocation) => (isTh ? l?.nameTh || l?.name : l?.name) ?? '—'

  /* ---- Summary ---- */
  if (plan) {
    const ws = wb.addWorksheet(t('dashboard.title'))
    const routes = plan.routes
    const totalCost = routes.reduce((s, r) => s + r.cost, 0)
    ws.addRow([t('app.title'), data.depotName])
    ws.getRow(1).font = { bold: true, size: 14 }
    ws.addRow([t('planner.plannedAt'), new Date(plan.plannedAt).toLocaleString()])
    ws.addRow([])
    const kpis: [string, number, string?][] = [
      [t('dashboard.kpiRoutes'), routes.length],
      [`${t('dashboard.kpiDistance')} (${t('common.km')})`, routes.reduce((s, r) => s + r.distanceKm, 0), DEC],
      [`${t('planner.volume')} (${t('common.m3')})`, routes.reduce((s, r) => s + r.totalM3, 0), DEC],
      [`${t('planner.weight')} (${t('common.kg')})`, routes.reduce((s, r) => s + r.totalKg, 0), INT],
      [`${t('costs.dailyTotal')} (${t('common.baht')})`, totalCost, INT],
      [`${t('costs.monthlyEstimate')} (${t('common.baht')})`, totalCost * 22, INT],
    ]
    for (const [label, value, fmt] of kpis) {
      const row = ws.addRow([label, value])
      row.getCell(1).font = { bold: true }
      if (fmt) row.getCell(2).numFmt = fmt
    }
    ws.getColumn(1).width = 34
    ws.getColumn(2).width = 24
  }

  /* ---- Routes (stop level) ---- */
  if (plan && plan.routes.length > 0) {
    const ws = wb.addWorksheet(t('planner.routes'))
    addTable(
      ws,
      [
        { label: t('costs.truck'), width: 16 },
        { label: t('planner.round'), width: 8 },
        { label: t('costs.partner'), width: 26 },
        { label: t('planner.seq'), width: 6 },
        { label: t('locations.code'), width: 10 },
        { label: t('locations.title'), width: 36 },
        { label: `${t('locations.demandM3')}`, width: 14, numFmt: DEC },
        { label: `${t('locations.demandKg')}`, width: 14, numFmt: INT },
        { label: `+${t('common.km')}`, width: 10, numFmt: DEC },
        { label: `${t('planner.eta')} (${t('common.min')})`, width: 12, numFmt: INT },
      ],
      plan.routes.flatMap((r) => {
        const truck = truckById.get(r.truckId)
        const partner = truck ? partnerById.get(truck.partnerId) : undefined
        return r.stops.map((s) => {
          const loc = locById.get(s.locationId)
          return [
            truck?.plateNumber ?? r.truckId,
            r.round,
            partner?.name ?? '—',
            s.sequence,
            loc?.code ?? '—',
            locName(loc),
            loc?.demandM3 ?? 0,
            loc?.demandKg ?? 0,
            s.distanceFromPrevKm,
            s.etaMinutes,
          ]
        })
      }),
    )
  }

  /* ---- Cost summary (route level, with partner/truck columns) ---- */
  if (plan && plan.routes.length > 0) {
    const ws = wb.addWorksheet(t('costs.title'))
    const plantName = (r: PlanResult['routes'][number]) => {
      const first = locById.get(r.stops[0]?.locationId)
      return first?.deliveryPlantId ? (locById.get(first.deliveryPlantId)?.code ?? '') : ''
    }
    const rows = plan.routes.map((r) => {
      const truck = truckById.get(r.truckId)
      const partner = truck ? partnerById.get(truck.partnerId) : undefined
      const bd = truck ? routeCostBreakdown(r, truck, partner) : { fixed: 0, variable: r.cost, total: r.cost }
      return [
        truck?.plateNumber ?? r.truckId,
        plantName(r),
        r.roundsPerDay ?? 1,
        partner?.name ?? '—',
        r.stops.length,
        r.distanceKm,
        r.durationMinutes,
        r.totalM3,
        r.totalKg,
        bd.fixed,
        bd.variable,
        bd.total,
      ]
    })
    addTable(
      ws,
      [
        { label: t('costs.truck'), width: 16 },
        { label: t('locations.deliveryPlant'), width: 12 },
        { label: t('planner.roundsPerDayShort'), width: 8, numFmt: INT },
        { label: t('costs.partner'), width: 24 },
        { label: t('planner.stops'), width: 8 },
        { label: `${t('planner.distance')} (${t('common.km')})`, width: 13, numFmt: DEC },
        { label: `${t('planner.duration')} (${t('common.min')})`, width: 13, numFmt: INT },
        { label: t('common.m3'), width: 10, numFmt: DEC },
        { label: t('common.kg'), width: 12, numFmt: INT },
        { label: `${t('costs.fixed')} (${t('common.baht')})`, width: 15, numFmt: INT },
        { label: `${t('costs.variable')} (${t('common.baht')})`, width: 15, numFmt: DEC },
        { label: `${t('costs.totalCost')} (${t('common.baht')})`, width: 16, numFmt: DEC },
      ],
      rows,
    )
    const sum = (i: number) => rows.reduce((s, r) => s + (r[i] as number), 0)
    boldTotalRow(ws, [t('common.total'), null, null, null, sum(4), sum(5), sum(6), sum(7), sum(8), sum(9), sum(10), sum(11)])
  }

  /* ---- Transporter comparison (plan priced under each rate card) ---- */
  const comparison = plan ? planCostByPartner(plan.routes, truckById, partners) : []
  if (comparison.length > 1) {
    const ws = wb.addWorksheet(t('costs.compareTitle'))
    const cheapest = comparison[0].total
    addTable(
      ws,
      [
        { label: t('costs.partner'), width: 28 },
        { label: `${t('costs.dailyTotal')} (${t('common.baht')})`, width: 18, numFmt: DEC },
        { label: `${t('costs.monthlyEstimate')} (${t('common.baht')})`, width: 22, numFmt: INT },
        { label: `${t('costs.vsCheapest')} (${t('common.baht')})`, width: 16, numFmt: DEC },
        { label: '%', width: 10, numFmt: DEC },
      ],
      comparison.map((c, i) => [
        c.partner.name + (i === 0 ? ` — ${t('costs.best')}` : ''),
        c.total,
        c.total * 22,
        i === 0 ? 0 : c.total - cheapest,
        i === 0 ? 0 : Math.round((c.total / cheapest - 1) * 1000) / 10,
      ]),
    )
  }

  /* ---- Master data ---- */
  addTable(
    wb.addWorksheet(t('locations.title')),
    [
      { label: t('locations.code'), width: 10 },
      { label: t('locations.name'), width: 36 },
      { label: t('locations.nameTh'), width: 36 },
      { label: t('locations.kind'), width: 14 },
      { label: t('locations.lat'), width: 12, numFmt: '0.000000' },
      { label: t('locations.lng'), width: 12, numFmt: '0.000000' },
      { label: t('locations.demandM3'), width: 16, numFmt: DEC },
      { label: t('locations.demandKg'), width: 16, numFmt: INT },
      { label: t('locations.serviceMinutes'), width: 16, numFmt: INT },
      { label: t('common.status'), width: 10 },
    ],
    locations.map((l) => [
      l.code, l.name, l.nameTh, t(`locations.kinds.${l.kind}`), l.lat, l.lng,
      l.demandM3, l.demandKg, l.serviceMinutes,
      l.active ? t('common.active') : t('common.inactive'),
    ]),
  )

  addTable(
    wb.addWorksheet(t('trucks.title')),
    [
      { label: t('trucks.plate'), width: 16 },
      { label: t('trucks.type'), width: 10 },
      { label: t('trucks.partner'), width: 26 },
      { label: t('trucks.capacityM3'), width: 14, numFmt: DEC },
      { label: t('trucks.capacityKg'), width: 14, numFmt: INT },
      { label: t('trucks.roundsPerDay'), width: 12, numFmt: INT },
      { label: t('trucks.fixedCost'), width: 20, numFmt: INT },
      { label: t('trucks.costPerKm'), width: 16, numFmt: DEC },
      { label: t('common.status'), width: 10 },
    ],
    trucks.map((tr) => [
      tr.plateNumber, tr.type, partnerById.get(tr.partnerId)?.name ?? '—',
      tr.capacityM3, tr.capacityKg, tr.roundsPerDay, tr.fixedCostPerRound, tr.costPerKm,
      tr.active ? t('common.active') : t('common.inactive'),
    ]),
  )

  addTable(
    wb.addWorksheet(t('partners.title')),
    [
      { label: t('partners.code'), width: 10 },
      { label: t('partners.name'), width: 30 },
      { label: t('partners.contact'), width: 20 },
      { label: t('partners.phone'), width: 16 },
      { label: t('partners.email'), width: 30 },
      { label: t('common.status'), width: 10 },
    ],
    partners.map((p) => [
      p.code, p.name, p.contactPerson, p.phone, p.email,
      p.active ? t('common.active') : t('common.inactive'),
    ]),
  )

  await download(wb, `tms-milkrun-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/** Billing & payments export — one row per invoice with tax breakdown. */
export async function exportBillingsToExcel(
  billings: BillingRecord[],
  partners: TransportPartner[],
) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'TMS Milkrun'
  wb.created = new Date()
  const partnerById = new Map(partners.map((p) => [p.id, p]))

  const ws = wb.addWorksheet(t('payments.title'))
  const rows = [...billings]
    .sort((a, b) => a.billingDate.localeCompare(b.billingDate))
    .map((b) => {
      const a = billingAmounts(b)
      return [
        b.invoiceNo,
        partnerById.get(b.partnerId)?.name ?? '—',
        b.billingDate,
        b.dueDate,
        b.routesCount,
        b.distanceKm,
        b.subtotal,
        b.fuelSurchargePct / 100,
        a.vat,
        a.wht,
        a.netPayable,
        t(`payments.statuses.${b.status}`),
        b.paidDate ?? '',
        b.note,
      ]
    })
  addTable(
    ws,
    [
      { label: t('payments.invoiceNo'), width: 20 },
      { label: t('payments.partner'), width: 28 },
      { label: t('payments.billingDate'), width: 13 },
      { label: t('payments.dueDate'), width: 13 },
      { label: t('payments.routes'), width: 8 },
      { label: `${t('planner.distance')} (${t('common.km')})`, width: 13, numFmt: DEC },
      { label: `${t('payments.subtotal')} (${t('common.baht')})`, width: 16, numFmt: DEC },
      { label: t('payments.fuelSurcharge'), width: 14, numFmt: '0.0%' },
      { label: `${t('payments.vat')} 7% (${t('common.baht')})`, width: 14, numFmt: DEC },
      { label: `${t('payments.wht')} 1% (${t('common.baht')})`, width: 14, numFmt: DEC },
      { label: `${t('payments.netPayable')} (${t('common.baht')})`, width: 18, numFmt: DEC },
      { label: t('common.status'), width: 12 },
      { label: t('payments.paidDate'), width: 13 },
      { label: t('payments.note'), width: 24 },
    ],
    rows,
  )
  boldTotalRow(ws, [
    t('common.total'), null, null, null,
    rows.reduce((s, r) => s + (r[4] as number), 0),
    rows.reduce((s, r) => s + (r[5] as number), 0),
    rows.reduce((s, r) => s + (r[6] as number), 0),
    null,
    rows.reduce((s, r) => s + (r[8] as number), 0),
    rows.reduce((s, r) => s + (r[9] as number), 0),
    rows.reduce((s, r) => s + (r[10] as number), 0),
  ])

  await download(wb, `tms-billing-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

async function download(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
