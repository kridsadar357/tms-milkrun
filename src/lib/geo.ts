/** Geodesy helpers and coordinate validation. */

export interface LatLng {
  lat: number
  lng: number
}

const EARTH_RADIUS_KM = 6371.0088

/** Great-circle distance in km (haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s))
}

/** Road-distance approximation: haversine × winding factor. */
export function roadKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1.3
}

export type CoordCheck =
  | { ok: true; warning?: string }
  | { ok: false; error: 'lat-range' | 'lng-range' | 'not-number' }

/** Thailand bounding box for a soft plausibility warning. */
const TH_BBOX = { minLat: 5.6, maxLat: 20.47, minLng: 97.34, maxLng: 105.64 }

export function validateCoords(lat: unknown, lng: unknown): CoordCheck {
  const la = typeof lat === 'string' ? Number(lat) : (lat as number)
  const ln = typeof lng === 'string' ? Number(lng) : (lng as number)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return { ok: false, error: 'not-number' }
  if (la < -90 || la > 90) return { ok: false, error: 'lat-range' }
  if (ln < -180 || ln > 180) return { ok: false, error: 'lng-range' }
  const inTh =
    la >= TH_BBOX.minLat && la <= TH_BBOX.maxLat && ln >= TH_BBOX.minLng && ln <= TH_BBOX.maxLng
  return inTh ? { ok: true } : { ok: true, warning: 'outside-thailand' }
}

/** Bearing from a to b in degrees [0, 360). Used by the sweep heuristic. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat))
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180) / Math.PI + 180
}
