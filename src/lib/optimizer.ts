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

  // Construct one part per dynamic slot (time-window + capacity nearest-neighbour).
  const parts: DynPart[] = []
  for (const slot of slots) {
    if (remaining.size === 0) break
    const candidates = active.filter((l) => remaining.has(l.id))
    const { ordered } = twConstruct(candidates, slot.truck, depot, avgSpeedKmh, startMin, true, false)
    if (ordered.length === 0) continue
    ordered.forEach((l) => remaining.delete(l.id))
    parts.push({ truck: slot.truck, round: slot.round, locs: ordered })
  }

  // Inter-route local search: relocate / swap stops between dynamic routes to
  // cut total cost (and even out load), and reinsert any unassigned stops that
  // now fit — all while keeping capacity + time windows feasible.
  const unassignedLocs = [...remaining].map((id) => byId.get(id)).filter((l): l is DeliveryLocation => !!l)
  localSearch(parts, unassignedLocs, depot, avgSpeedKmh, startMin)
  remaining.clear()
  unassignedLocs.forEach((l) => remaining.add(l.id))

  const colorBase = lockedRoutes.length + fixedRoutes.length
  const newRoutes = parts
    .filter((p) => p.locs.length > 0)
    .map((p, idx) =>
      buildRoute(
        p.truck, p.round, twoOptTW(p.locs, depot, avgSpeedKmh, startMin),
        depot, avgSpeedKmh, colorBase + idx, startMin,
      ),
    )

  return {
    routes: [...lockedRoutes, ...fixedRoutes, ...newRoutes],
    unassignedLocationIds: [...remaining].filter((id) => byId.has(id)),
    plannedAt: new Date().toISOString(),
  }
}

/* --------------------- inter-route local search (VRP) --------------------- */

interface DynPart {
  truck: Truck
  round: number
  locs: DeliveryLocation[]
}

function routeDist(locs: DeliveryLocation[], depot: LatLng): number {
  let d = 0
  let prev: LatLng = depot
  for (const l of locs) {
    d += roadKm(prev, l)
    prev = l
  }
  return d + roadKm(prev, depot)
}
const loadM3 = (locs: DeliveryLocation[]) => locs.reduce((a, l) => a + l.demandM3, 0)
const loadKg = (locs: DeliveryLocation[]) => locs.reduce((a, l) => a + l.demandKg, 0)
const capFits = (truck: Truck, locs: DeliveryLocation[], extra: number, extraKg: number) =>
  loadM3(locs) + extra <= truck.capacityM3 && loadKg(locs) + extraKg <= truck.capacityKg

/** Best time-window-feasible position to insert `s` into `locs`, or null. */
function bestInsertion(
  locs: DeliveryLocation[],
  s: DeliveryLocation,
  depot: LatLng,
  speed: number,
  startMin: number,
): { pos: number; delta: number } | null {
  const base = routeDist(locs, depot)
  let best: { pos: number; delta: number } | null = null
  for (let pos = 0; pos <= locs.length; pos++) {
    const cand = [...locs.slice(0, pos), s, ...locs.slice(pos)]
    if (!tourFeasible(cand, depot, speed, startMin)) continue
    const delta = routeDist(cand, depot) - base
    if (!best || delta < best.delta) best = { pos, delta }
  }
  return best
}

/** One improving move (relocate → swap → reinsert). Returns true if applied. */
function oneMove(
  parts: DynPart[],
  unassigned: DeliveryLocation[],
  depot: LatLng,
  speed: number,
  startMin: number,
): boolean {
  const EPS = 1e-6
  // SWAP TRUCKS between two routes (heterogeneous fleet): keep each route's stops
  // but exchange the trucks so the cheaper cost/km serves the longer route.
  // Time windows are unaffected (sequence/timing unchanged). Rounds swap too so
  // the (truck, round) slots stay unique.
  for (let a = 0; a < parts.length; a++) {
    const A = parts[a]
    for (let b = a + 1; b < parts.length; b++) {
      const B = parts[b]
      if (A.truck.id === B.truck.id) continue
      if (loadM3(A.locs) > B.truck.capacityM3 + EPS || loadKg(A.locs) > B.truck.capacityKg + EPS) continue
      if (loadM3(B.locs) > A.truck.capacityM3 + EPS || loadKg(B.locs) > A.truck.capacityKg + EPS) continue
      const delta = (B.truck.costPerKm - A.truck.costPerKm) * (routeDist(A.locs, depot) - routeDist(B.locs, depot))
      if (delta < -EPS) {
        const tA = A.truck, rA = A.round
        A.truck = B.truck
        A.round = B.round
        B.truck = tA
        B.round = rA
        return true
      }
    }
  }
  // RELOCATE a stop from route A to a cheaper feasible position in route B.
  for (let a = 0; a < parts.length; a++) {
    const A = parts[a]
    for (let i = 0; i < A.locs.length; i++) {
      const s = A.locs[i]
      const aWithout = [...A.locs.slice(0, i), ...A.locs.slice(i + 1)]
      const aSaved = A.truck.costPerKm * (routeDist(A.locs, depot) - routeDist(aWithout, depot))
      for (let b = 0; b < parts.length; b++) {
        if (b === a) continue
        const B = parts[b]
        if (!capFits(B.truck, B.locs, s.demandM3, s.demandKg)) continue
        const ins = bestInsertion(B.locs, s, depot, speed, startMin)
        if (!ins) continue
        const bAdded = B.truck.costPerKm * ins.delta
        if (bAdded - aSaved < -EPS) {
          A.locs = aWithout
          B.locs = [...B.locs.slice(0, ins.pos), s, ...B.locs.slice(ins.pos)]
          return true
        }
      }
    }
  }
  // SWAP a stop of A with a stop of B if it lowers total cost.
  for (let a = 0; a < parts.length; a++) {
    const A = parts[a]
    for (let b = a + 1; b < parts.length; b++) {
      const B = parts[b]
      for (let i = 0; i < A.locs.length; i++) {
        const sA = A.locs[i]
        for (let j = 0; j < B.locs.length; j++) {
          const sB = B.locs[j]
          if (!capFits(A.truck, A.locs, sB.demandM3 - sA.demandM3, sB.demandKg - sA.demandKg)) continue
          if (!capFits(B.truck, B.locs, sA.demandM3 - sB.demandM3, sA.demandKg - sB.demandKg)) continue
          const aRem = A.locs.filter((_, k) => k !== i)
          const bRem = B.locs.filter((_, k) => k !== j)
          const insA = bestInsertion(aRem, sB, depot, speed, startMin)
          const insB = bestInsertion(bRem, sA, depot, speed, startMin)
          if (!insA || !insB) continue
          const aNew = [...aRem.slice(0, insA.pos), sB, ...aRem.slice(insA.pos)]
          const bNew = [...bRem.slice(0, insB.pos), sA, ...bRem.slice(insB.pos)]
          const delta =
            A.truck.costPerKm * (routeDist(aNew, depot) - routeDist(A.locs, depot)) +
            B.truck.costPerKm * (routeDist(bNew, depot) - routeDist(B.locs, depot))
          if (delta < -EPS) {
            A.locs = aNew
            B.locs = bNew
            return true
          }
        }
      }
    }
  }
  // REINSERT an unassigned stop into the cheapest feasible route.
  for (let u = 0; u < unassigned.length; u++) {
    const s = unassigned[u]
    let best: { part: DynPart; pos: number; cost: number } | null = null
    for (const p of parts) {
      if (!capFits(p.truck, p.locs, s.demandM3, s.demandKg)) continue
      const ins = bestInsertion(p.locs, s, depot, speed, startMin)
      if (!ins) continue
      const cost = p.truck.costPerKm * ins.delta
      if (!best || cost < best.cost) best = { part: p, pos: ins.pos, cost }
    }
    if (best) {
      best.part.locs = [...best.part.locs.slice(0, best.pos), s, ...best.part.locs.slice(best.pos)]
      unassigned.splice(u, 1)
      return true
    }
  }
  return false
}

function localSearch(
  parts: DynPart[],
  unassigned: DeliveryLocation[],
  depot: LatLng,
  speed: number,
  startMin: number,
) {
  let guard = 0
  while (oneMove(parts, unassigned, depot, speed, startMin) && guard++ < 2000) {
    /* keep improving */
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
