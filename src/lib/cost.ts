/** Milkrun trip pricing — detailed transporter rate card, with a simple fallback. */

import type { PlannedRoute, RateCard, Shift, TransportPartner, Truck } from '../types'

/** Effective labor / OT / fuel-economy for the given shift (night falls back to day). */
function shiftRates(card: RateCard, shift: Shift) {
  return shift === 'night'
    ? {
        laborPerHr: card.nightLaborPerHr ?? card.laborPerHr,
        otPerHr: card.nightOtPerHr ?? card.otPerHr,
        fuelKmPerL: card.nightFuelKmPerL ?? card.fuelKmPerL,
      }
    : { laborPerHr: card.laborPerHr, otPerHr: card.otPerHr, fuelKmPerL: card.fuelKmPerL }
}

const routeShift = (route: PlannedRoute): Shift => route.shift ?? 'day'

/**
 * Price a whole plan under each transporter that has a rate card, keeping each
 * route on its own truck type — a like-for-like "who is cheapest" comparison.
 * Returns rows sorted cheapest-first (partners with no rate card are skipped).
 */
export function planCostByPartner(
  routes: PlannedRoute[],
  truckById: Map<string, Truck>,
  partners: TransportPartner[],
): { partner: TransportPartner; total: number }[] {
  return partners
    .filter((p) => p.costProfile && Object.keys(p.costProfile).length > 0)
    .map((partner) => ({
      partner,
      total: routes.reduce((sum, r) => {
        const truck = truckById.get(r.truckId)
        return truck ? sum + dailyRouteCost(r, truck, partner) : sum
      }, 0),
    }))
    .sort((a, b) => a.total - b.total)
}

/**
 * Cost of ONE trip of a route using the partner's rate card for the truck type:
 * labor (+ overtime past 8h) + fuel + km-allowance + drop points + trip/safety.
 * Excludes the per-day fixed cost and admin, applied once/day in dailyRouteCost.
 * Returns null if the partner has no rate card for the type.
 */
export function tripCost(route: PlannedRoute, truck: Truck, partner: TransportPartner | undefined): number | null {
  const card = partner?.costProfile?.[truck.type]
  if (!card) return null
  const r = shiftRates(card, routeShift(route))
  const hours = route.durationMinutes / 60
  const labor = Math.min(hours, 8) * r.laborPerHr + Math.max(0, hours - 8) * r.otPerHr
  const fuel = r.fuelKmPerL > 0 ? (route.distanceKm / r.fuelKmPerL) * card.fuelRatePerL : 0
  const allowance = route.distanceKm * card.allowancePerKm
  const drops = route.stops.length * card.dropCost
  return labor + fuel + allowance + drops + card.tripSafety
}

/**
 * Full daily cost of a route. With a rate card:
 *   (rounds × tripCost + otherPerDay) × (1 + adminPct).
 * Without one, falls back to the simple model: rounds × (fixedCostPerRound +
 * costPerKm × distanceKm) — i.e. the optimizer's own per-trip cost × rounds.
 */
export function dailyRouteCost(route: PlannedRoute, truck: Truck, partner: TransportPartner | undefined): number {
  const rounds = Math.max(1, route.roundsPerDay ?? 1)
  const trip = tripCost(route, truck, partner)
  if (trip == null) {
    return rounds * (truck.fixedCostPerRound + truck.costPerKm * route.distanceKm)
  }
  const card = partner!.costProfile![truck.type]
  return (rounds * trip + card.otherPerDay) * (1 + card.adminPct)
}

/**
 * Split a route's daily cost into fixed vs variable (distance/stop-driven), for
 * the Cost Summary. With a rate card: variable = fuel + km-allowance + drops;
 * fixed = labor + trip fee + daily other. Admin is spread across both. Without a
 * rate card: fixed = rounds × fixedCostPerRound, variable = rounds × km cost.
 * fixed + variable always equals dailyRouteCost.
 */
export function routeCostBreakdown(
  route: PlannedRoute,
  truck: Truck,
  partner: TransportPartner | undefined,
): { fixed: number; variable: number; total: number } {
  const rounds = Math.max(1, route.roundsPerDay ?? 1)
  const card = partner?.costProfile?.[truck.type]
  if (!card) {
    const fixed = rounds * truck.fixedCostPerRound
    const variable = rounds * truck.costPerKm * route.distanceKm
    return { fixed, variable, total: fixed + variable }
  }
  const r = shiftRates(card, routeShift(route))
  const hours = route.durationMinutes / 60
  const labor = Math.min(hours, 8) * r.laborPerHr + Math.max(0, hours - 8) * r.otPerHr
  const fuel = r.fuelKmPerL > 0 ? (route.distanceKm / r.fuelKmPerL) * card.fuelRatePerL : 0
  const variableTrip = fuel + route.distanceKm * card.allowancePerKm + route.stops.length * card.dropCost
  const fixedTrip = labor + card.tripSafety
  const m = 1 + card.adminPct
  const fixed = (rounds * fixedTrip + card.otherPerDay) * m
  const variable = rounds * variableTrip * m
  return { fixed, variable, total: fixed + variable }
}
