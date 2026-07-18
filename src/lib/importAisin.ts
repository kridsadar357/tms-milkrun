/**
 * Import an Aisin milkrun planning workbook (.xlsx) into app master data.
 *
 * Reads three sheets — `Data` (supplier→plant lanes), `Location` (codes + lat/long),
 * and `Cost` (transporter rate cards) — and produces plants, supplier stops,
 * a 6W/10W fleet, and transporter partners with rate cards, ready to load. Sheet
 * and column layout match the reference workbook; unknown extras are ignored.
 */

import ExcelJS from 'exceljs'
import type { DeliveryLocation, RateCard, TransportPartner, Truck } from '../types'

export interface ImportResult {
  partners: TransportPartner[]
  trucks: Truck[]
  locations: DeliveryLocation[]
  warnings: string[]
}

const cell = (c: ExcelJS.Cell): string => {
  const v = c.value as unknown
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; hyperlink?: string }
    return String(o.text ?? o.result ?? o.hyperlink ?? '')
  }
  return String(v)
}
const num = (c: ExcelJS.Cell) => Number(cell(c).replace(/,/g, '')) || 0

/** Rows of a sheet as cell-getter objects `c1..cN`, starting at `headerRows+1`. */
function rows(ws: ExcelJS.Worksheet, headerRows: number) {
  const out: Record<string, ExcelJS.Cell>[] = []
  for (let r = headerRows + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const o: Record<string, ExcelJS.Cell> = {}
    for (let c = 1; c <= ws.columnCount; c++) o['c' + c] = row.getCell(c)
    out.push(o)
  }
  return out
}

/** '20:00-05:00' → ['20:00','05:00'] with single-digit hours zero-padded. */
function splitWindow(s: string): [string, string] {
  const pad = (x: string) => x.trim().replace(/^(\d):/, '0$1:')
  const [a = '', b = ''] = s.split('-')
  return [pad(a), pad(b)]
}

export async function parseAisinWorkbook(buffer: ArrayBuffer): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const warnings: string[] = []
  const get = (name: string) => wb.worksheets.find((w) => w.name.trim().toLowerCase() === name)
  const dataWs = get('data')
  const locWs = get('location')
  const costWs = get('cost')
  if (!dataWs || !locWs) throw new Error('Workbook must contain "Data" and "Location" sheets.')

  // Location coordinates by code.
  const coordByCode: Record<string, { lat: number; lng: number; name: string }> = {}
  for (const o of rows(locWs, 1)) {
    const code = cell(o.c1).trim()
    if (!code) continue
    const [lat, lng] = cell(o.c4).split(',').map((s) => parseFloat(s.trim()))
    if (Number.isFinite(lat) && Number.isFinite(lng) && !coordByCode[code]) {
      coordByCode[code] = { lat, lng, name: cell(o.c2).trim() || code }
    }
  }
  const coord = (code: string) => coordByCode[code] ?? coordByCode[code + ' CHEM']

  // Rate cards from the Cost sheet (data starts at row 3): partner × truck type.
  const profiles: Record<string, Record<string, RateCard>> = {}
  if (costWs) {
    for (const o of rows(costWs, 2)) {
      const p = cell(o.c1).trim()
      const type = cell(o.c2).trim()
      // Only real transporter × truck-type rows (skip notes like "Example: Day Shift").
      if (!p || !/^\d+\s*w(j)?$|^trailer$/i.test(type)) continue
      ;(profiles[p] ??= {})[type] = {
        laborPerHr: num(o.c3), otPerHr: num(o.c5), dropCost: num(o.c7),
        allowancePerKm: num(o.c8), tripSafety: num(o.c9),
        fuelKmPerL: num(o.c10) || 4.5, fuelRatePerL: num(o.c12) || 31.73,
        otherPerDay: Math.round(num(o.c13) * 100) / 100, adminPct: num(o.c14),
        nightLaborPerHr: num(o.c4) || num(o.c3), nightOtPerHr: num(o.c6) || num(o.c5),
        nightFuelKmPerL: num(o.c11) || num(o.c10) || 4.5,
      }
    }
  }

  // Lanes → plants + supplier stops.
  const lanes = rows(dataWs, 1).filter((o) => cell(o.c2).trim())
  const plantCodes = [...new Set(lanes.map((o) => cell(o.c14).trim()).filter(Boolean))]
  const plants: DeliveryLocation[] = plantCodes.map((code) => {
    const c = coord(code)
    if (!c) warnings.push(`No coordinates for plant "${code}"`)
    return {
      id: 'plant-' + code, code, name: c?.name ?? code, nameTh: code, kind: 'plant',
      zone: 'AISIN Plant', lat: c?.lat ?? 0, lng: c?.lng ?? 0, demandM3: 0, demandKg: 0,
      serviceMinutes: 0, windowStart: '', windowEnd: '', deliveryDays: [], active: true, roundsPerDay: 1,
    }
  })
  const suppliers: DeliveryLocation[] = lanes.map((o, i) => {
    const sup = cell(o.c2).trim()
    const plant = cell(o.c14).trim()
    const c = coord(sup)
    if (!c) warnings.push(`No coordinates for supplier "${sup}"`)
    const [nStart, nEnd] = splitWindow(cell(o.c4))
    return {
      id: 'ai' + (i + 1),
      code: sup.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() + '-' + (i + 1),
      name: `${sup} → ${plant}`, nameTh: `${sup} → ${plant}`, kind: 'supplier', zone: plant,
      lat: c?.lat ?? 0, lng: c?.lng ?? 0, demandM3: num(o.c10), demandKg: num(o.c12),
      serviceMinutes: num(o.c5) || 30, windowStart: '08:00', windowEnd: '17:00',
      windowStartNight: nStart, windowEndNight: nEnd, deliveryDays: [], active: true,
      roundsPerDay: Math.max(1, num(o.c7) || 1), deliveryPlantId: 'plant-' + plant,
    }
  })

  // Transporters (partners) with their rate cards; fleet is assigned to the first.
  const primary = Object.keys(profiles)[0]
  const partners: TransportPartner[] = Object.keys(profiles).length
    ? Object.entries(profiles).map(([name, costProfile]) => ({
        id: name.toLowerCase().replace(/[^a-z0-9]/g, ''), code: name.toUpperCase().slice(0, 4),
        name: name + ' Logistics', contactPerson: '', phone: '', email: '', active: true,
        ratePerKm: 0, ratePerTrip: 0, minCharge: 0, creditDays: 30,
        bankName: '', bankAccountNo: '', bankAccountName: name + ' Logistics', costProfile,
      }))
    : [{
        id: 'carrier', code: 'CAR', name: 'Carrier', contactPerson: '', phone: '', email: '',
        active: true, ratePerKm: 0, ratePerTrip: 0, minCharge: 0, creditDays: 30,
        bankName: '', bankAccountNo: '', bankAccountName: 'Carrier',
      }]
  const partnerId = primary ? primary.toLowerCase().replace(/[^a-z0-9]/g, '') : 'carrier'
  const card6 = primary ? profiles[primary]['6W'] : undefined
  const card10 = primary ? profiles[primary]['10W'] : undefined
  const perKm = (c?: RateCard) => (c && c.fuelKmPerL ? Math.round((c.fuelRatePerL / c.fuelKmPerL + c.allowancePerKm) * 100) / 100 : 8)

  const trucks: Truck[] = []
  for (let i = 1; i <= 10; i++)
    trucks.push({ id: '6W-' + i, plateNumber: `6W-${String(i).padStart(2, '0')}`, type: '6W', partnerId, capacityM3: 35.37, capacityKg: 5000, roundsPerDay: 1, fixedCostPerRound: 500, costPerKm: perKm(card6), active: true, assignmentMode: 'dynamic', fixedStops: [] })
  for (let i = 1; i <= 2; i++)
    trucks.push({ id: '10W-' + i, plateNumber: `10W-${String(i).padStart(2, '0')}`, type: '10W', partnerId, capacityM3: 35.37, capacityKg: 14000, roundsPerDay: 1, fixedCostPerRound: 700, costPerKm: perKm(card10), active: true, assignmentMode: 'dynamic', fixedStops: [] })

  return { partners, trucks, locations: [...plants, ...suppliers], warnings }
}
