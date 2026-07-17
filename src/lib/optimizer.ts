/**
 * Milkrun auto-route engine — capacity + time-window vehicle routing (VRPTW).
 *
 *  1. Fixed trucks first run their preset cyclic route (cyclic rotation).
 *  2. Dynamic trucks are filled by a time-window + capacity nearest-neighbour:
 *     a stop is taken only if it FITS (m³ and kg) AND can be reached within its
 *     delivery window (the truck waits if early; rejects if it would arrive too
 *     late). Stops with no window are unconstrained in time.
 *  3. A time-window-feasible 2-opt shortens each tour without breaking windows.
 *
 * Arrival times run from the planned depot departure (settings.planStartTime).
 * Distances use haversine × 1.3; the Planner can re-snap to Mapbox roads after.
 */

import type { DeliveryLocation, PlannedRoute, PlanResult, RouteStop, Truck } from '../types'
import { roadKm, type LatLng } from './geo'

interface TripSlot {
  truck: Truck
  round: number
}

export interface PlanInput {
  trucks: Truck[]
  locations: DeliveryLocation[]
  depot: LatLng
  avgSpeedKmh: number
  /** Routes the planner should keep as-is; their stops are not re-optimized. */
  lockedRoutes?: PlannedRoute[]
  /** Weekday (0=Sun..6=Sat) to plan; only stops scheduled for it are included. */
  dayOfWeek?: number
  /** Depot departure clock 'HH:MM' (default 08:00) — the basis for time windows. */
  planStartTime?: string
}

/** A location is served on a day if it has no schedule, or lists that weekday. */
export function servesDay(loc: DeliveryLocation, day: number | undefined): boolean {
  if (day == null) return true
  const days = loc.deliveryDays ?? []
  return days.length === 0 || days.includes(day)
}

/* --------------------------- time-window helpers -------------------------- */

export function hmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const minToHm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`
}
const winStart = (l: DeliveryLocation) => (l.windowStart ? hmToMin(l.windowStart) : null)
const winEnd = (l: DeliveryLocation) => (l.windowEnd ? hmToMin(l.windowEnd) : null)
const travelMin = (a: LatLng, b: LatLng, speed: number) => (roadKm(a, b) / speed) * 60

/** True if visiting `tour` from `startMin` reaches every stop within its window. */
function tourFeasible(tour: DeliveryLocation[], depot: LatLng, speed: number, startMin: number): boolean {
  let clock = startMin
  let cursor: LatLng = depot
  for (const loc of tour) {
    let arrive = clock + travelMin(cursor, loc, speed)
    const ws = winStart(loc)
    if (ws != null && arrive < ws) arrive = ws
    const we = winEnd(loc)
    if (we != null && arrive > we + 1e-6) return false
    clock = arrive + loc.serviceMinutes
    cursor = loc
  }
  return true
}

export function planRoutes({
  trucks,
  locations,
  depot,
  avgSpeedKmh,
  lockedRoutes = [],
  dayOfWeek,
  planStartTime = '08:00',
}: PlanInput): PlanResult {
  const startMin = hmToMin(planStartTime)
  // Locked routes hold their stops and their truck/round slot.
  const lockedLocIds = new Set(lockedRoutes.flatMap((r) => r.stops.map((s) => s.locationId)))
  const usedSlots = new Set(lockedRoutes.map((r) => `${r.truckId}-r${r.round}`))

  const active = locations.filter(
    (l) =>
      l.active &&
      (l.demandM3 > 0 || l.demandKg > 0) &&
      !lockedLocIds.has(l.id) &&
      servesDay(l, dayOfWeek),
  )

  const remaining = new Set(active.map((l) => l.id))
  const byId = new Map(active.map((l) => [l.id, l]))

  // Fixed trucks run their own preset cycle (cyclic rotation). Their stops are
  // committed even if capacity/window is exceeded — the schedule flags any late
  // arrival — so the optimizer sequences them time-window-aware and keeps all.
  const fixedRoutes: PlannedRoute[] = []
  const fixedTruckIds = new Set<string>()
  for (const truck of trucks.filter(
    (t) => t.active && t.assignmentMode === 'fixed' && (t.fixedStops?.length ?? 0) > 0,
  )) {
    fixedTruckIds.add(truck.id)
    if (usedSlots.has(`${truck.id}-r1`)) continue // its cycle is already a locked route
    const stops = (truck.fixedStops ?? [])
      .map((id) => byId.get(id))
      .filter((l): l is DeliveryLocation => !!l && remaining.has(l.id))
    if (stops.length === 0) continue
    stops.forEach((l) => remaining.delete(l.id))
    const ordered = twConstruct(stops, truck, depot, avgSpeedKmh, startMin, false, true).ordered
    fixedRoutes.push(buildRoute(truck, 1, ordered, depot, avgSpeedKmh, lockedRoutes.length + fixedRoutes.length, startMin))
  }

  // One slot per DYNAMIC truck round, biggest trucks first.
  const slots: TripSlot[] = trucks
    .filter((t) => t.active && !fixedTruckIds.has(t.id))
    .flatMap((t) => Array.from({ length: Math.max(1, t.roundsPerDay) }, (_, i) => ({ truck: t, round: i + 1 })))
    .filter((s) => !usedSlots.has(`${s.truck.id}-r${s.round}`))
    .sort((a, b) => b.truck.capacityM3 - a.truck.capacityM3 || a.round - b.round)

  const newRoutes: PlannedRoute[] = []
  const colorBase = lockedRoutes.length + fixedRoutes.length

  for (const slot of slots) {
    if (remaining.size === 0) break
    const { truck, round } = slot
    const candidates = active.filter((l) => remaining.has(l.id))
    // Time-window + capacity nearest-neighbour: only stops that fit AND arrive
    // within their window are taken; the rest stay for other trucks / unassigned.
    const { ordered } = twConstruct(candidates, truck, depot, avgSpeedKmh, startMin, true, false)
    if (ordered.length === 0) continue
    ordered.forEach((l) => remaining.delete(l.id))
    const seq = twoOptTW(ordered, depot, avgSpeedKmh, startMin)
    newRoutes.push(buildRoute(truck, round, seq, depot, avgSpeedKmh, colorBase + newRoutes.length, startMin))
  }

  return {
    routes: [...lockedRoutes, ...fixedRoutes, ...newRoutes],
    unassignedLocationIds: [...remaining].filter((id) => byId.has(id)),
    plannedAt: new Date().toISOString(),
  }
}

/**
 * Greedy nearest-neighbour construction with capacity + time windows.
 *  - respectCapacity: skip stops that would exceed m³/kg (dynamic trucks).
 *  - allowLate: keep going even if a stop can only be reached after its window
 *    (fixed cyclic routes), preferring the least-late nearest stop.
 * Returns the built order and any stops that couldn't be placed.
 */
function twConstruct(
  candidates: DeliveryLocation[],
  truck: Truck,
  depot: LatLng,
  speed: number,
  startMin: number,
  respectCapacity: boolean,
  allowLate: boolean,
): { ordered: DeliveryLocation[]; leftover: DeliveryLocation[] } {
  const pool = [...candidates]
  const ordered: DeliveryLocation[] = []
  let usedM3 = 0
  let usedKg = 0
  let clock = startMin
  let cursor: LatLng = depot

  for (;;) {
    let bestIdx = -1
    let bestDist = Infinity
    let bestLate = Infinity
    for (let i = 0; i < pool.length; i++) {
      const loc = pool[i]
      if (respectCapacity && (usedM3 + loc.demandM3 > truck.capacityM3 || usedKg + loc.demandKg > truck.capacityKg)) continue
      let arrive = clock + travelMin(cursor, loc, speed)
      const ws = winStart(loc)
      if (ws != null && arrive < ws) arrive = ws
      const we = winEnd(loc)
      const late = we != null ? Math.max(0, arrive - we) : 0
      if (late > 1e-6 && !allowLate) continue // infeasible for a dynamic truck
      const dist = roadKm(cursor, loc)
      // Fixed routes prefer the least-late then nearest; dynamic prefer nearest.
      if (allowLate ? late < bestLate - 1e-6 || (Math.abs(late - bestLate) < 1e-6 && dist < bestDist) : dist < bestDist) {
        bestLate = late
        bestDist = dist
        bestIdx = i
      }
    }
    if (bestIdx === -1) break
    const loc = pool.splice(bestIdx, 1)[0]
    let arrive = clock + travelMin(cursor, loc, speed)
    const ws = winStart(loc)
    if (ws != null && arrive < ws) arrive = ws
    ordered.push(loc)
    usedM3 += loc.demandM3
    usedKg += loc.demandKg
    clock = arrive + loc.serviceMinutes
    cursor = loc
  }
  return { ordered, leftover: pool }
}

/** 2-opt that only accepts a shorter tour when it stays time-window feasible. */
function twoOptTW(stops: DeliveryLocation[], depot: LatLng, speed: number, startMin: number): DeliveryLocation[] {
  if (stops.length < 3) return stops
  let tour = [...stops]
  const point = (i: number): LatLng => (i < 0 || i >= tour.length ? depot : tour[i])
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < tour.length - 1; i++) {
      for (let j = i + 1; j < tour.length; j++) {
        const before = roadKm(point(i - 1), point(i)) + roadKm(point(j), point(j + 1))
        const after = roadKm(point(i - 1), point(j)) + roadKm(point(i), point(j + 1))
        if (after + 1e-9 < before) {
          const cand = [...tour]
          cand.splice(i, j - i + 1, ...tour.slice(i, j + 1).reverse())
          if (tourFeasible(cand, depot, speed, startMin)) {
            tour = cand
            improved = true
          }
        }
      }
    }
  }
  return tour
}

/**
 * Recompute a route's metrics from a manually edited, ordered stop list
 * (reorder or reassignment). Keeps the route's identity fields; clears
 * geometry so the Planner re-snaps it to roads.
 */
export function rebuildRoute(
  base: PlannedRoute,
  orderedLocations: DeliveryLocation[],
  truck: Truck,
  depot: LatLng,
  avgSpeedKmh: number,
): PlannedRoute {
  const rebuilt = buildRoute(
    truck, base.round, orderedLocations, depot, avgSpeedKmh, base.colorIndex,
    hmToMin(base.startTime ?? '08:00'),
  )
  return {
    ...rebuilt,
    id: base.id,
    colorIndex: base.colorIndex,
    status: base.status,
    startTime: base.startTime,
    locked: base.locked,
    geometry: undefined,
  }
}

function buildRoute(
  truck: Truck,
  round: number,
  ordered: DeliveryLocation[],
  depot: LatLng,
  avgSpeedKmh: number,
  index: number,
  startMin = 480, // 08:00
): PlannedRoute {
  let distanceKm = 0
  let totalM3 = 0
  let totalKg = 0
  let clock = startMin // arrival clock, running from the depot departure
  let prev: LatLng = depot
  const stops: RouteStop[] = ordered.map((loc, i) => {
    const leg = roadKm(prev, loc)
    distanceKm += leg
    let arrive = clock + (leg / avgSpeedKmh) * 60
    const ws = winStart(loc)
    if (ws != null && arrive < ws) arrive = ws // wait for the window to open
    const we = winEnd(loc)
    const lateBy = we != null ? Math.max(0, Math.round(arrive - we)) : 0
    totalM3 += loc.demandM3
    totalKg += loc.demandKg
    clock = arrive + loc.serviceMinutes
    prev = loc
    return {
      locationId: loc.id,
      sequence: i + 1,
      distanceFromPrevKm: round2(leg),
      etaMinutes: Math.round(arrive - startMin), // from start, includes waiting
      ...(lateBy > 0 ? { lateBy } : {}),
    }
  })
  const back = roadKm(prev, depot)
  distanceKm += back
  const durationMinutes = Math.round(clock + (back / avgSpeedKmh) * 60 - startMin)

  return {
    id: `${truck.id}-r${round}`,
    truckId: truck.id,
    round,
    stops,
    totalM3: round2(totalM3),
    totalKg: round2(totalKg),
    distanceKm: round2(distanceKm),
    durationMinutes,
    cost: round2(truck.fixedCostPerRound + truck.costPerKm * distanceKm),
    colorIndex: index % 8,
    startTime: minToHm(startMin),
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
