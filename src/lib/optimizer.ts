/**
 * Milkrun auto-route engine.
 *
 * Capacity-constrained vehicle routing (CVRP) with multiple rounds per truck:
 *  1. Sweep clustering — stops sorted by bearing around the depot are grouped
 *     into trips that respect BOTH the m³ and kg capacity of the truck.
 *  2. Nearest-neighbour sequencing from the depot.
 *  3. 2-opt improvement until no swap shortens the tour.
 *
 * Distances use haversine × 1.3 winding factor; the Planner can afterwards
 * replace geometry/distance with Mapbox Directions data.
 */

import type { DeliveryLocation, PlannedRoute, PlanResult, Truck } from '../types'
import { bearingDeg, roadKm, type LatLng } from './geo'

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
}

/** A location is served on a day if it has no schedule, or lists that weekday. */
export function servesDay(loc: DeliveryLocation, day: number | undefined): boolean {
  if (day == null) return true
  const days = loc.deliveryDays ?? []
  return days.length === 0 || days.includes(day)
}

export function planRoutes({
  trucks,
  locations,
  depot,
  avgSpeedKmh,
  lockedRoutes = [],
  dayOfWeek,
}: PlanInput): PlanResult {
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

  // Sweep: order stops by polar angle around the depot.
  const swept = [...active].sort((a, b) => bearingDeg(depot, a) - bearingDeg(depot, b))

  const remaining = new Set(swept.map((l) => l.id))
  const byId = new Map(swept.map((l) => [l.id, l]))

  // Fixed trucks run their own preset cycle (cyclic rotation), consuming those
  // stops before the optimizer assigns the rest to dynamic trucks.
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
    const ordered = twoOpt(nearestNeighbour(stops, depot), depot)
    fixedRoutes.push(buildRoute(truck, 1, ordered, depot, avgSpeedKmh, lockedRoutes.length + fixedRoutes.length))
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
    const picked: DeliveryLocation[] = []
    let usedM3 = 0
    let usedKg = 0

    // Walk the sweep order from the first still-unassigned stop, taking every
    // stop that fits the remaining capacity (skips stops that don't fit so a
    // single oversized stop can't block the rest of the sector).
    for (const loc of swept) {
      if (!remaining.has(loc.id)) continue
      if (usedM3 + loc.demandM3 > truck.capacityM3 || usedKg + loc.demandKg > truck.capacityKg)
        continue
      picked.push(loc)
      usedM3 += loc.demandM3
      usedKg += loc.demandKg
    }

    if (picked.length === 0) continue
    picked.forEach((l) => remaining.delete(l.id))

    const ordered = twoOpt(nearestNeighbour(picked, depot), depot)
    // New routes get colours after the locked + fixed ones so nothing collides.
    newRoutes.push(buildRoute(truck, round, ordered, depot, avgSpeedKmh, colorBase + newRoutes.length))
  }

  return {
    routes: [...lockedRoutes, ...fixedRoutes, ...newRoutes],
    unassignedLocationIds: [...remaining].filter((id) => byId.has(id)),
    plannedAt: new Date().toISOString(),
  }
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
  const rebuilt = buildRoute(truck, base.round, orderedLocations, depot, avgSpeedKmh, base.colorIndex)
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

function nearestNeighbour(stops: DeliveryLocation[], depot: LatLng): DeliveryLocation[] {
  const pool = [...stops]
  const ordered: DeliveryLocation[] = []
  let cursor: LatLng = depot
  while (pool.length) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < pool.length; i++) {
      const d = roadKm(cursor, pool[i])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    const next = pool.splice(bestIdx, 1)[0]
    ordered.push(next)
    cursor = next
  }
  return ordered
}

/** Classic 2-opt on the depot → stops → depot tour. */
function twoOpt(stops: DeliveryLocation[], depot: LatLng): DeliveryLocation[] {
  if (stops.length < 3) return stops
  const tour = [...stops]
  const point = (i: number): LatLng => (i < 0 || i >= tour.length ? depot : tour[i])
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < tour.length - 1; i++) {
      for (let j = i + 1; j < tour.length; j++) {
        const before =
          roadKm(point(i - 1), point(i)) + roadKm(point(j), point(j + 1))
        const after =
          roadKm(point(i - 1), point(j)) + roadKm(point(i), point(j + 1))
        if (after + 1e-9 < before) {
          tour.splice(i, j - i + 1, ...tour.slice(i, j + 1).reverse())
          improved = true
        }
      }
    }
  }
  return tour
}

function buildRoute(
  truck: Truck,
  round: number,
  ordered: DeliveryLocation[],
  depot: LatLng,
  avgSpeedKmh: number,
  index: number,
): PlannedRoute {
  let distanceKm = 0
  let minutes = 0
  let totalM3 = 0
  let totalKg = 0
  let prev: LatLng = depot
  const stops = ordered.map((loc, i) => {
    const leg = roadKm(prev, loc)
    distanceKm += leg
    minutes += (leg / avgSpeedKmh) * 60 + loc.serviceMinutes
    totalM3 += loc.demandM3
    totalKg += loc.demandKg
    prev = loc
    return {
      locationId: loc.id,
      sequence: i + 1,
      distanceFromPrevKm: round2(leg),
      etaMinutes: Math.round(minutes),
    }
  })
  const back = roadKm(prev, depot)
  distanceKm += back
  minutes += (back / avgSpeedKmh) * 60

  return {
    id: `${truck.id}-r${round}`,
    truckId: truck.id,
    round,
    stops,
    totalM3: round2(totalM3),
    totalKg: round2(totalKg),
    distanceKm: round2(distanceKm),
    durationMinutes: Math.round(minutes),
    cost: round2(truck.fixedCostPerRound + truck.costPerKm * distanceKm),
    colorIndex: index % 8,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
