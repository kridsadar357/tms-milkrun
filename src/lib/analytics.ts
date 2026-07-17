/** Milkrun analytics — computes the KPI dashboard from the current plan + data. */

import { estimateCo2Kg, podDelayMinutes } from '../types'
import type {
  AuditEntry, DeliveryLocation, Incident, PlanResult, PodRecord, Product, Settings, Truck,
} from '../types'

export interface TruckRow {
  truckId: string
  plate: string
  mode: 'fixed' | 'dynamic'
  routes: number
  stops: number
  distanceKm: number
  cost: number
  utilM3: number // %
  utilKg: number // %
}

export interface MilkrunStats {
  hasPlan: boolean
  routeCount: number
  // Milkrun principle KPIs
  cyclicRotationPct: number // share of routes run by fixed (cyclic) trucks
  avgLeadTimeMin: number
  maxLeadTimeMin: number
  loadingEfficiencyPct: number // weighted volume utilization
  co2Kg: number
  // 1. Truck routing
  perTruck: TruckRow[]
  fixedRoutes: number
  dynamicRoutes: number
  // 2. Time windows
  windowStops: number
  withinWindow: number
  windowCompliancePct: number
  podEarly: number
  podOnTime: number
  podLate: number
  // 3. Load optimization
  routeUtil: { label: string; m3Pct: number; kgPct: number }[]
  avgUtilM3: number
  avgUtilKg: number
  // 4. Returnable packaging
  returnableSkus: number
  oneWaySkus: number
  returnablePct: number
  palletsWooden: number
  palletsPlastic: number
  palletsNone: number
  // 5. Flexibility & communication
  podDelivered: number
  podTotal: number
  podCompletionPct: number
  podFailed: number
  incidentsOpen: number
  incidentsHigh: number
  changes: number
}

interface Ctx {
  plan: PlanResult | null
  trucks: Truck[]
  locations: DeliveryLocation[]
  products: Product[]
  pods: PodRecord[]
  incidents: Incident[]
  audit: AuditEntry[]
  settings: Settings
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
const r1 = (n: number) => Math.round(n * 10) / 10

export function computeMilkrunStats(ctx: Ctx): MilkrunStats {
  const { plan, trucks, locations, products, pods, incidents } = ctx
  const routes = plan?.routes ?? []
  const truckById = new Map(trucks.map((t) => [t.id, t]))
  const locById = new Map(locations.map((l) => [l.id, l]))
  const podById = new Map(pods.map((p) => [p.id, p]))

  const isFixed = (t?: Truck) => t?.assignmentMode === 'fixed'

  // ---- 1. Truck routing ----
  const perTruckMap = new Map<string, TruckRow>()
  let fixedRoutes = 0
  for (const r of routes) {
    const truck = truckById.get(r.truckId)
    if (isFixed(truck)) fixedRoutes++
    const row =
      perTruckMap.get(r.truckId) ??
      {
        truckId: r.truckId,
        plate: truck?.plateNumber ?? r.truckId,
        mode: isFixed(truck) ? 'fixed' : 'dynamic',
        routes: 0,
        stops: 0,
        distanceKm: 0,
        cost: 0,
        utilM3: 0,
        utilKg: 0,
      }
    row.routes += 1
    row.stops += r.stops.length
    row.distanceKm += r.distanceKm
    row.cost += r.cost
    if (truck) {
      row.utilM3 = Math.max(row.utilM3, pct(r.totalM3, truck.capacityM3))
      row.utilKg = Math.max(row.utilKg, pct(r.totalKg, truck.capacityKg))
    }
    perTruckMap.set(r.truckId, row)
  }
  const perTruck = [...perTruckMap.values()].map((row) => ({
    ...row,
    distanceKm: r1(row.distanceKm),
    cost: Math.round(row.cost),
  }))

  // ---- 2. Time windows ----
  let windowStops = 0
  let withinWindow = 0
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  for (const r of routes) {
    const start = toMin(r.startTime || '08:00')
    for (const s of r.stops) {
      const loc = locById.get(s.locationId)
      if (!loc?.windowStart || !loc?.windowEnd) continue
      windowStops++
      const arrive = start + s.etaMinutes
      if (arrive >= toMin(loc.windowStart) && arrive <= toMin(loc.windowEnd)) withinWindow++
    }
  }
  let podEarly = 0
  let podOnTime = 0
  let podLate = 0
  for (const r of routes) {
    for (const s of r.stops) {
      const pod = podById.get(`${r.id}:${s.locationId}`)
      if (!pod?.arrival) continue
      const d = podDelayMinutes(r, s.etaMinutes, pod.arrival)
      if (d == null) continue
      if (d > 5) podLate++
      else if (d < -5) podEarly++
      else podOnTime++
    }
  }

  // ---- 3. Load optimization ----
  const routeUtil = routes.map((r) => {
    const t = truckById.get(r.truckId)
    return {
      label: `${t?.plateNumber ?? r.truckId} · R${r.round}`,
      m3Pct: t ? pct(r.totalM3, t.capacityM3) : 0,
      kgPct: t ? pct(r.totalKg, t.capacityKg) : 0,
    }
  })
  const avgUtilM3 = routeUtil.length ? Math.round(routeUtil.reduce((a, r) => a + r.m3Pct, 0) / routeUtil.length) : 0
  const avgUtilKg = routeUtil.length ? Math.round(routeUtil.reduce((a, r) => a + r.kgPct, 0) / routeUtil.length) : 0

  // ---- 4. Returnable packaging (from product pallet types) ----
  const planLocIds = new Set(routes.flatMap((r) => r.stops.map((s) => s.locationId)))
  const planProducts = products.filter((p) => p.active && planLocIds.has(p.supplierId))
  let palletsWooden = 0
  let palletsPlastic = 0
  let palletsNone = 0
  for (const p of planProducts) {
    if (p.palletType === 'wooden') palletsWooden++
    else if (p.palletType === 'plastic') palletsPlastic++
    else palletsNone++
  }
  const returnableSkus = palletsWooden + palletsPlastic
  const oneWaySkus = palletsNone

  // ---- 5. Flexibility & communication ----
  const podTotal = routes.reduce((n, r) => n + r.stops.length, 0)
  const podDelivered = pods.filter((p) => p.status === 'delivered').length
  const podFailed = pods.filter((p) => p.status === 'failed').length
  const incidentsOpen = incidents.filter((i) => !i.resolved).length
  const incidentsHigh = incidents.filter((i) => !i.resolved && i.severity === 'high').length
  const changes = ctx.audit.length

  // ---- Milkrun principle KPIs ----
  const avgLeadTimeMin = routes.length ? Math.round(routes.reduce((a, r) => a + r.durationMinutes, 0) / routes.length) : 0
  const maxLeadTimeMin = routes.reduce((a, r) => Math.max(a, r.durationMinutes), 0)
  const co2Kg = r1(routes.reduce((a, r) => a + estimateCo2Kg(r.distanceKm, ctx.settings), 0))

  return {
    hasPlan: routes.length > 0,
    routeCount: routes.length,
    cyclicRotationPct: pct(fixedRoutes, routes.length),
    avgLeadTimeMin,
    maxLeadTimeMin,
    loadingEfficiencyPct: avgUtilM3,
    co2Kg,
    perTruck,
    fixedRoutes,
    dynamicRoutes: routes.length - fixedRoutes,
    windowStops,
    withinWindow,
    windowCompliancePct: pct(withinWindow, windowStops),
    podEarly,
    podOnTime,
    podLate,
    routeUtil,
    avgUtilM3,
    avgUtilKg,
    returnableSkus,
    oneWaySkus,
    returnablePct: pct(returnableSkus, returnableSkus + oneWaySkus),
    palletsWooden,
    palletsPlastic,
    palletsNone,
    podDelivered,
    podTotal,
    podCompletionPct: pct(podDelivered, podTotal),
    podFailed,
    incidentsOpen,
    incidentsHigh,
    changes,
  }
}
