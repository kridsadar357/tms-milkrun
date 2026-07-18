/** Milkrun trip pricing — detailed transporter rate card, with a simple fallback. */

import type { PlannedRoute, TransportPartner, Truck } from '../types'

/**
 * Cost of ONE trip of a route using the partner's rate card for the truck type:
 * labor (+ overtime past 8h) + fuel + km-allowance + drop points + trip/safety.
 * Excludes the per-day fixed cost and admin, which are applied once per day in
 * dailyRouteCost. Returns null if the partner has no rate card for the type.
 */
export function tripCost(route: PlannedRoute, truck: Truck, partner: TransportPartner | undefined): number | null {
  const card = partner?.costProfile?.[truck.type]
  if (!card) return null
  const hours = route.durationMinutes / 60
  const labor = Math.min(hours, 8) * card.laborPerHr + Math.max(0, hours - 8) * card.otPerHr
  const fuel = card.fuelKmPerL > 0 ? (route.distanceKm / card.fuelKmPerL) * card.fuelRatePerL : 0
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
