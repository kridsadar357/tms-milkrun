/** Mapbox Directions API — snap a planned route to real roads. */

import type { DeliveryLocation, PlannedRoute } from '../types'
import type { LatLng } from './geo'

interface DirectionsResult {
  geometry: [number, number][]
  distanceKm: number
  durationMinutes: number
}

/**
 * Fetch road geometry for depot → stops → depot.
 * Mapbox Directions accepts max 25 waypoints per request; longer routes are
 * chunked and stitched together.
 */
export async function fetchRoadRoute(
  token: string,
  depot: LatLng,
  stops: DeliveryLocation[],
): Promise<DirectionsResult | null> {
  const coords: [number, number][] = [
    [depot.lng, depot.lat],
    ...stops.map((s) => [s.lng, s.lat] as [number, number]),
    [depot.lng, depot.lat],
  ]

  const chunks: [number, number][][] = []
  for (let i = 0; i < coords.length - 1; i += 24) {
    chunks.push(coords.slice(i, Math.min(i + 25, coords.length)))
  }

  const geometry: [number, number][] = []
  let meters = 0
  let seconds = 0

  for (const chunk of chunks) {
    if (chunk.length < 2) continue
    const path = chunk.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${path}?geometries=geojson&overview=full&access_token=${token}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const route = data.routes?.[0]
    if (!route) return null
    geometry.push(...(route.geometry.coordinates as [number, number][]))
    meters += route.distance
    seconds += route.duration
  }

  return {
    geometry,
    distanceKm: Math.round((meters / 1000) * 100) / 100,
    durationMinutes: Math.round(seconds / 60),
  }
}

/** Re-price a route after Directions returned real distance/duration. */
export function applyRoadData(
  route: PlannedRoute,
  road: DirectionsResult,
  serviceMinutes: number,
  fixedCostPerRound: number,
  costPerKm: number,
): PlannedRoute {
  return {
    ...route,
    geometry: road.geometry,
    distanceKm: road.distanceKm,
    durationMinutes: road.durationMinutes + serviceMinutes,
    cost: Math.round((fixedCostPerRound + costPerKm * road.distanceKm) * 100) / 100,
  }
}
