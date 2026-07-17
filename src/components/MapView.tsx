import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import type { FeatureCollection } from 'geojson'
import { useTranslation } from 'react-i18next'
import { Box, MapPin } from 'lucide-react'
import type { DeliveryLocation, PlannedRoute } from '../types'

export const ROUTE_COLORS = [
  '#2a78d6', '#1baf7a', '#eda100', '#008300',
  '#4a3aa7', '#e34948', '#e87ba4', '#eb6834',
]

const KIND_COLORS: Record<DeliveryLocation['kind'], string> = {
  supplier: '#2a78d6',
  plant: '#4a3aa7',
  warehouse: '#eda100',
  customer: '#1baf7a',
}

type StyleKey = 'streets' | 'satellite' | 'dark' | 'traffic'
const STYLES: Record<StyleKey, string> = {
  streets: 'mapbox://styles/mapbox/streets-v12',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  dark: 'mapbox://styles/mapbox/dark-v11',
  traffic: 'mapbox://styles/mapbox/navigation-day-v1',
}

/** Animated dash sequence for the selected route ("marching ants"). */
const DASH_SEQUENCE: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5],
  [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2],
  [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
]

interface MapViewProps {
  token: string
  depot: { lat: number; lng: number; name: string }
  locations: DeliveryLocation[]
  routes?: PlannedRoute[]
  selectedRouteId?: string | null
  routeLabel?: (r: PlannedRoute) => string
  className?: string
}

export default function MapView({
  token,
  depot,
  locations,
  routes = [],
  selectedRouteId = null,
  routeLabel,
  className = '',
}: MapViewProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const stopMarkersRef = useRef<mapboxgl.Marker[]>([])
  const truckMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const truckRafRef = useRef(0)
  const dashRafRef = useRef(0)
  const loadedRef = useRef(false)
  const [styleKey, setStyleKey] = useState<StyleKey>('streets')
  const [tilt, setTilt] = useState(false)

  // Latest data for re-syncing after a style swap (style swaps drop layers).
  const dataRef = useRef({ routes, selectedRouteId, depot, locations, routeLabel })
  dataRef.current = { routes, selectedRouteId, depot, locations, routeLabel }

  const addLayersAndSync = useCallback((map: mapboxgl.Map) => {
    const d = dataRef.current
    if (!map.getSource('routes')) {
      map.addSource('routes', { type: 'geojson', data: emptyFC() })
    }
    if (!map.getLayer('route-casing')) {
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.85 },
      })
    }
    if (!map.getLayer('route-lines')) {
      map.addLayer({
        id: 'route-lines',
        type: 'line',
        source: 'routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'selected'], 5.5, 3.5],
          'line-opacity': ['case', ['get', 'dimmed'], 0.2, 0.95],
        },
      })
    }
    if (!map.getLayer('route-dash')) {
      // White marching-ants overlay, only on the selected route.
      map.addLayer({
        id: 'route-dash',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [0, 4, 3] },
      })
    }
    // 3D buildings (streets-based styles expose the composite building layer).
    if (!map.getLayer('3d-buildings') && map.getSource('composite')) {
      try {
        map.addLayer({
          id: '3d-buildings',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#cbd5e1',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.7,
          },
        })
      } catch {
        /* style without composite buildings — skip */
      }
    }
    syncRouteData(map, d.routes, d.selectedRouteId, d.depot, d.locations, d.routeLabel)
  }, [])

  /* ---------------- map lifecycle ---------------- */
  useEffect(() => {
    if (!token || !containerRef.current) return
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: STYLES.streets,
      center: [depot.lng, depot.lat],
      zoom: 10,
      antialias: true,
      preserveDrawingBuffer: true, // allows screenshots/print of the canvas
    })
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new mapboxgl.FullscreenControl(), 'top-right')
    map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      loadedRef.current = true
      addLayersAndSync(map)
    })
    // Re-create sources/layers whenever the base style is swapped.
    map.on('style.load', () => {
      if (loadedRef.current) addLayersAndSync(map)
    })

    // Hover tooltip on route lines.
    const hoverPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })
    map.on('mousemove', 'route-lines', (e) => {
      map.getCanvas().style.cursor = 'pointer'
      const f = e.features?.[0]
      if (f?.properties?.label) {
        hoverPopup.setLngLat(e.lngLat).setHTML(`<strong>${f.properties.label}</strong>`).addTo(map)
      }
    })
    map.on('mouseleave', 'route-lines', () => {
      map.getCanvas().style.cursor = ''
      hoverPopup.remove()
    })

    mapRef.current = map
    return () => {
      loadedRef.current = false
      cancelAnimationFrame(truckRafRef.current)
      cancelAnimationFrame(dashRafRef.current)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  /* ---------------- style / tilt controls ---------------- */
  const changeStyle = (key: StyleKey) => {
    setStyleKey(key)
    mapRef.current?.setStyle(STYLES[key])
  }

  const toggleTilt = () => {
    const map = mapRef.current
    if (!map) return
    const next = !tilt
    setTilt(next)
    map.easeTo({ pitch: next ? 55 : 0, bearing: next ? -15 : 0, duration: 800 })
  }

  /* ---------------- markers (depot + locations) ---------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    const depotEl = document.createElement('div')
    depotEl.innerHTML = `<div style="background:#0f172a;color:#fff;border-radius:8px;padding:4px 8px;font-size:11px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,.3);white-space:nowrap">🏭 ${t('planner.depot')}</div>`
    markersRef.current.push(
      new mapboxgl.Marker({ element: depotEl, anchor: 'bottom' })
        .setLngLat([depot.lng, depot.lat])
        .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML(`<strong>${esc(depot.name)}</strong>`))
        .addTo(map),
    )

    for (const loc of locations.filter((l) => l.active)) {
      const el = document.createElement('div')
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${KIND_COLORS[loc.kind]};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer`
      markersRef.current.push(
        new mapboxgl.Marker({ element: el })
          .setLngLat([loc.lng, loc.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 12 }).setHTML(
              `<strong>${esc(loc.code)}</strong> — ${esc(loc.name)}<br/>` +
                `${esc(loc.nameTh)}<br/>` +
                `<span style="color:#64748b">${loc.demandM3} m³ · ${loc.demandKg} kg</span>`,
            ),
          )
          .addTo(map),
      )
    }

    if (locations.length > 0 && !selectedRouteId) {
      const bounds = new mapboxgl.LngLatBounds()
      bounds.extend([depot.lng, depot.lat])
      locations.filter((l) => l.active).forEach((l) => bounds.extend([l.lng, l.lat]))
      map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 400 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, depot.lat, depot.lng, depot.name, t, token])

  /* ---------------- route data + dash animation ---------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    syncRouteData(map, routes, selectedRouteId, depot, locations, routeLabel)

    cancelAnimationFrame(dashRafRef.current)
    if (selectedRouteId) {
      let step = 0
      let last = 0
      const animate = (ts: number) => {
        if (ts - last > 70) {
          last = ts
          step = (step + 1) % DASH_SEQUENCE.length
          if (map.getLayer('route-dash')) {
            map.setPaintProperty('route-dash', 'line-dasharray', DASH_SEQUENCE[step])
          }
        }
        dashRafRef.current = requestAnimationFrame(animate)
      }
      dashRafRef.current = requestAnimationFrame(animate)
    }
    return () => cancelAnimationFrame(dashRafRef.current)
  }, [routes, selectedRouteId, depot, locations, routeLabel])

  /* ---------------- selection: fly-to, stop badges, truck animation ---------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    stopMarkersRef.current.forEach((m) => m.remove())
    stopMarkersRef.current = []
    truckMarkerRef.current?.remove()
    truckMarkerRef.current = null
    cancelAnimationFrame(truckRafRef.current)

    const route = routes.find((r) => r.id === selectedRouteId)
    if (!route) return
    const byId = new Map(locations.map((l) => [l.id, l]))
    const color = ROUTE_COLORS[route.colorIndex % ROUTE_COLORS.length]
    const coords = routeCoords(route, depot, locations)

    // Fly to the selected route.
    const bounds = new mapboxgl.LngLatBounds()
    coords.forEach((c) => bounds.extend(c))
    map.fitBounds(bounds, { padding: 80, duration: 700 })

    // Numbered stop badges.
    for (const s of route.stops) {
      const loc = byId.get(s.locationId)
      if (!loc) continue
      const el = document.createElement('div')
      el.style.cssText = `width:22px;height:22px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font:600 11px sans-serif`
      el.textContent = String(s.sequence)
      stopMarkersRef.current.push(
        new mapboxgl.Marker({ element: el }).setLngLat([loc.lng, loc.lat]).addTo(map),
      )
    }

    // Truck marker animating along the route.
    if (coords.length >= 2) {
      const el = document.createElement('div')
      el.style.cssText = `width:30px;height:30px;border-radius:50%;background:#fff;border:2.5px solid ${color};box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:15px`
      el.textContent = '🚚'
      const marker = new mapboxgl.Marker({ element: el }).setLngLat(coords[0]).addTo(map)
      truckMarkerRef.current = marker

      // Cumulative planar lengths for constant-speed interpolation.
      const cum = [0]
      for (let i = 1; i < coords.length; i++) {
        const dx = coords[i][0] - coords[i - 1][0]
        const dy = coords[i][1] - coords[i - 1][1]
        cum.push(cum[i - 1] + Math.hypot(dx, dy))
      }
      const total = cum[cum.length - 1]
      const durationMs = Math.min(30000, Math.max(10000, route.distanceKm * 100))
      let start = 0
      const animate = (ts: number) => {
        if (!start) start = ts
        const progress = (((ts - start) % durationMs) / durationMs) * total
        let i = 1
        while (i < cum.length && cum[i] < progress) i++
        if (i >= coords.length) i = coords.length - 1
        const segLen = cum[i] - cum[i - 1] || 1
        const f = (progress - cum[i - 1]) / segLen
        marker.setLngLat([
          coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f,
          coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f,
        ])
        truckRafRef.current = requestAnimationFrame(animate)
      }
      truckRafRef.current = requestAnimationFrame(animate)
    }

    return () => {
      cancelAnimationFrame(truckRafRef.current)
      stopMarkersRef.current.forEach((m) => m.remove())
      stopMarkersRef.current = []
      truckMarkerRef.current?.remove()
      truckMarkerRef.current = null
    }
  }, [selectedRouteId, routes, locations, depot])

  if (!token) {
    return (
      <div className={`flex flex-col items-center justify-center bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center p-8 ${className}`}>
        <MapPin className="text-slate-400 mb-3" size={36} />
        <p className="font-medium text-slate-600 mb-1">{t('settings.mapboxToken')}</p>
        <p className="text-sm text-slate-500 max-w-sm">{t('settings.mapboxHint')}</p>
      </div>
    )
  }

  const styleButtons: { key: StyleKey; label: string }[] = [
    { key: 'streets', label: t('map.streets') },
    { key: 'satellite', label: t('map.satellite') },
    { key: 'dark', label: t('map.dark') },
    { key: 'traffic', label: t('map.traffic') },
  ]

  return (
    <div className={`relative ${className}`}>
      {/* Inline position — mapbox-gl.css forces `.mapboxgl-map { position: relative }`,
          which would override a Tailwind `absolute` class and collapse the height. */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} className="rounded-xl overflow-hidden" />
      {/* Style switcher */}
      <div className="absolute top-3 left-3 flex gap-1 bg-white/95 backdrop-blur rounded-lg shadow-md p-1 z-10">
        {styleButtons.map((s) => (
          <button
            key={s.key}
            onClick={() => changeStyle(s.key)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
              styleKey === s.key ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={toggleTilt}
          title={t('map.tilt')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors inline-flex items-center gap-1 ${
            tilt ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Box size={13} /> 3D
        </button>
      </div>
    </div>
  )
}

/* ---------------- helpers ---------------- */

function routeCoords(
  route: PlannedRoute,
  depot: { lat: number; lng: number },
  locations: DeliveryLocation[],
): [number, number][] {
  if (route.geometry && route.geometry.length >= 2) return route.geometry
  const byId = new Map(locations.map((l) => [l.id, l]))
  return [
    [depot.lng, depot.lat],
    ...route.stops
      .map((s) => byId.get(s.locationId))
      .filter((l): l is DeliveryLocation => !!l)
      .map((l) => [l.lng, l.lat] as [number, number]),
    [depot.lng, depot.lat],
  ]
}

function syncRouteData(
  map: mapboxgl.Map,
  routes: PlannedRoute[],
  selectedRouteId: string | null,
  depot: { lat: number; lng: number },
  locations: DeliveryLocation[],
  routeLabel?: (r: PlannedRoute) => string,
) {
  const src = map.getSource('routes') as mapboxgl.GeoJSONSource | undefined
  if (!src) return
  src.setData({
    type: 'FeatureCollection',
    features: routes.map((r) => ({
      type: 'Feature' as const,
      properties: {
        color: ROUTE_COLORS[r.colorIndex % ROUTE_COLORS.length],
        selected: r.id === selectedRouteId,
        dimmed: selectedRouteId !== null && r.id !== selectedRouteId,
        label: routeLabel ? routeLabel(r) : r.id,
      },
      geometry: { type: 'LineString' as const, coordinates: routeCoords(r, depot, locations) },
    })),
  })
}

function emptyFC(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
