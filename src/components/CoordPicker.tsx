import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'

/**
 * Minimal click/drag map for picking a location's coordinates. Clicking the map
 * (or dragging the pin) reports the new lat/lng; the pin follows the lat/lng props
 * so typing into the form and picking on the map stay in sync.
 */
export default function CoordPicker({
  token,
  lat,
  lng,
  onPick,
}: {
  token: string
  lat: number | null
  lng: number | null
  onPick: (c: { lat: number; lng: number }) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  // Thailand-ish fallback when the form has no coordinates yet.
  const start: [number, number] = [lng ?? 100.9319, lat ?? 13.7]

  useEffect(() => {
    if (!token || !containerRef.current) return
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: start,
      zoom: lat != null && lng != null ? 11 : 5.2,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    const marker = new mapboxgl.Marker({ color: '#2a78d6', draggable: true })
    if (lat != null && lng != null) marker.setLngLat([lng, lat]).addTo(map)
    marker.on('dragend', () => {
      const { lat: la, lng: ln } = marker.getLngLat()
      onPickRef.current({ lat: +la.toFixed(6), lng: +ln.toFixed(6) })
    })
    map.on('click', (e) => {
      marker.setLngLat(e.lngLat).addTo(map)
      onPickRef.current({ lat: +e.lngLat.lat.toFixed(6), lng: +e.lngLat.lng.toFixed(6) })
    })
    mapRef.current = map
    markerRef.current = marker
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // Init once; the pin is kept in sync by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Follow the form's lat/lng (e.g. pasted or typed) without re-creating the map.
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker || lat == null || lng == null) return
    marker.setLngLat([lng, lat]).addTo(map)
    map.easeTo({ center: [lng, lat], duration: 400 })
  }, [lat, lng])

  if (!token) return null
  return <div ref={containerRef} className="h-56 w-full rounded-lg overflow-hidden border border-slate-200" />
}
