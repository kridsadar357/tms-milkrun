/** Mapbox Matrix API — real road-distance matrix for the route optimizer. */

import type { LatLng } from './geo'
import { roadKm } from './geo'
import type { DistanceMatrix } from './optimizer'

/**
 * Build an N×N real-road distance matrix (km) for `points` (depot first, then
 * stops) via the Mapbox Matrix API.
 *
 * The Matrix API allows ≤25 coordinates per request, so for larger point sets we
 * tile the matrix into blocks of ≤12 and request every block pair (≤24 coords
 * each) using `sources`/`destinations`. Any pair the API can't route (null) —
 * or any failed request — falls back to haversine × 1.3, so the optimizer always
 * gets a complete matrix. Returns null only if the token is missing.
 */
export async function fetchDistanceMatrix(
  token: string,
  points: LatLng[],
): Promise<DistanceMatrix | null> {
  if (!token || points.length < 2) return null
  const n = points.length
  // Seed with the haversine estimate; real values overwrite it as they arrive.
  const km: number[][] = points.map((a) => points.map((b) => roadKm(a, b)))

  const BLOCK = 12 // any two blocks ≤ 24 coordinates ≤ the API's 25 limit
  const blocks: number[][] = []
  for (let i = 0; i < n; i += BLOCK) blocks.push(range(i, Math.min(i + BLOCK, n)))

  for (let bi = 0; bi < blocks.length; bi++) {
    for (let bj = 0; bj < blocks.length; bj++) {
      const src = blocks[bi]
      const dst = blocks[bj]
      // One request covers coords = src ++ dst (deduped when bi === bj).
      const coordIdx = bi === bj ? src : [...src, ...dst]
      if (coordIdx.length < 2) continue // Matrix API needs ≥2 coords; 1-point block is a 0-diagonal
      const srcPos = src.map((g) => coordIdx.indexOf(g))
      const dstPos = dst.map((g) => coordIdx.indexOf(g))
      const path = coordIdx.map((g) => `${points[g].lng.toFixed(6)},${points[g].lat.toFixed(6)}`).join(';')
      const url =
        `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${path}` +
        `?annotations=distance&sources=${srcPos.join(';')}&destinations=${dstPos.join(';')}` +
        `&access_token=${token}`
      try {
        const res = await fetch(url)
        if (!res.ok) continue // keep haversine seed for this block
        const data = await res.json()
        const meters: (number | null)[][] | undefined = data.distances
        if (!meters) continue
        for (let s = 0; s < src.length; s++) {
          for (let d = 0; d < dst.length; d++) {
            const m = meters[s]?.[d]
            if (m != null) km[src[s]][dst[d]] = m / 1000
          }
        }
      } catch {
        // network error — leave the haversine seed for this block
      }
    }
  }
  return { points, km }
}

function range(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a; i < b; i++) out.push(i)
  return out
}
