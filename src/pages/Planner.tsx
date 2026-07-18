import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarDays, Check, Coins, FileSpreadsheet, GripVertical, Leaf, Lock, LockOpen, Moon, Route, Save, Scale,
  Spline, Sun, Trash2, TrendingDown, TriangleAlert, Truck as TruckIcon, Undo2, UserRound,
} from 'lucide-react'
import type { OptimizeObjective } from '../types'
import { effectiveMapboxToken, useTms } from '../store'
import { can } from '../lib/permissions'
import { explainUnassigned, isMilkrun, planMilkrun, planRoutes, rebuildRoute, servesDay } from '../lib/optimizer'
import { applyRoadData, fetchRoadRoute } from '../lib/directions'
import { fetchDistanceMatrix } from '../lib/matrix'
import { exportToExcel } from '../lib/excel'
import MapView, { ROUTE_COLORS } from '../components/MapView'
import { Badge, Button, Card } from '../components/ui'
import { estimateCo2Kg, type DeliveryLocation, type PlannedRoute, type TripStatus } from '../types'
import { dailyRouteCost } from '../lib/cost'

interface Totals { cost: number; distanceKm: number; co2: number }
interface Savings { cost: number; distanceKm: number; co2: number }

const STATUS_TONE: Record<TripStatus, 'slate' | 'blue' | 'amber' | 'green'> = {
  planned: 'slate',
  dispatched: 'blue',
  'in-transit': 'amber',
  completed: 'green',
}
/** Next action per status: [nextStatus, i18nKey]. */
const NEXT_ACTION: Partial<Record<TripStatus, [TripStatus, string]>> = {
  planned: ['dispatched', 'planner.dispatch'],
  dispatched: ['in-transit', 'planner.startTrip'],
  'in-transit': ['completed', 'planner.complete'],
}

export default function Planner({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { t, i18n } = useTranslation()
  const { trucks, locations, partners, drivers, plan, settings, setPlan, updateRouteStatus,
    patchRoute, updatePlanRoutes, updateSettings, resetToSeed,
    scenarios, saveScenario, deleteScenario, loadScenario } = useTms()
  const [busy, setBusy] = useState<null | 'plan' | 'road'>(null)
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null)
  const [editHistory, setEditHistory] = useState<PlannedRoute[][]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [excludedTrucks, setExcludedTrucks] = useState<Set<string>>(new Set())
  const [savings, setSavings] = useState<Savings | null>(null)
  const [drag, setDrag] = useState<{ routeId: string; index: number } | null>(null)
  const [planDay, setPlanDay] = useState<number | null>(null) // null = every day

  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const truckById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks])
  const partnerById = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners])
  const driverByTruck = useMemo(
    () => new Map(drivers.filter((d) => d.truckId).map((d) => [d.truckId as string, d])),
    [drivers],
  )

  const activeTrucks = trucks.filter((tr) => tr.active)
  const activeLocations = locations.filter((l) => l.active && (l.demandM3 > 0 || l.demandKg > 0))
  const depot = { lat: settings.depotLat, lng: settings.depotLng, name: settings.depotName }
  const mapToken = effectiveMapboxToken(settings)
  const canEditPlan = can(settings.role, 'plan')

  // A milkrun route starts/ends at its stops' destination plant, not the global
  // depot — road-snapping and manual re-routing must use that plant as the depot.
  const plantById = useMemo(() => new Map(locations.filter((l) => l.kind === 'plant').map((l) => [l.id, l])), [locations])
  const depotForLoc = useCallback(
    (loc: DeliveryLocation) => {
      const plant = loc.deliveryPlantId ? plantById.get(loc.deliveryPlantId) : undefined
      return plant ? { lat: plant.lat, lng: plant.lng, name: plant.name } : depot
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plantById, depot.lat, depot.lng],
  )
  const depotForRoute = useCallback(
    (route: PlannedRoute) => {
      const first = route.stops[0] && locById.get(route.stops[0].locationId)
      return first ? depotForLoc(first) : depot
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locById, depotForLoc, depot.lat, depot.lng],
  )
  const usableTrucksForExplain = useMemo(() => trucks.filter((tr) => !excludedTrucks.has(tr.id)), [trucks, excludedTrucks])

  // Re-price every route with the transporter's rate card (falls back to the
  // truck's simple fixed + per-km cost when no rate card exists).
  const priceRoutes = useCallback(
    (rs: PlannedRoute[]) =>
      rs.map((r) => {
        const truck = truckById.get(r.truckId)
        if (!truck) return r
        const withShift = { ...r, shift: settings.shift }
        return { ...withShift, cost: Math.round(dailyRouteCost(withShift, truck, partnerById.get(truck.partnerId)) * 100) / 100 }
      }),
    [truckById, partnerById, settings.shift],
  )

  // Scheduled demand per weekday (for the multi-day overview).
  const weekly = useMemo(() => {
    const act = locations.filter((l) => l.active && (l.demandM3 > 0 || l.demandKg > 0))
    return [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const stops = act.filter((l) => servesDay(l, d))
      return {
        day: d,
        count: stops.length,
        m3: Math.round(stops.reduce((s, l) => s + l.demandM3, 0) * 10) / 10,
        kg: stops.reduce((s, l) => s + l.demandKg, 0),
      }
    })
  }, [locations])

  /** Snap every route of a plan to real roads via Mapbox Directions. */
  const snapPlanToRoads = useCallback(
    async (result: NonNullable<typeof plan>) => {
      setBusy('road')
      const withStops = result.routes.filter((r) => r.stops.length > 0)
      const upgraded: PlannedRoute[] = []
      let done = 0
      for (const route of result.routes) {
        const truck = truckById.get(route.truckId)
        const stops = route.stops
          .map((s) => locById.get(s.locationId))
          .filter((l): l is NonNullable<typeof l> => !!l)
        if (stops.length) setProgress({ label: t('planner.progSnap'), done: done++, total: withStops.length })
        const road = truck ? await fetchRoadRoute(mapToken, depotForRoute(route), stops).catch(() => null) : null
        upgraded.push(
          road && truck
            ? applyRoadData(
                route,
                road,
                stops.reduce((sum, l) => sum + l.serviceMinutes, 0),
                truck.fixedCostPerRound,
                truck.costPerKm,
              )
            : route,
        )
      }
      setPlan({ ...result, routes: priceRoutes(upgraded) })
      setProgress(null)
      setBusy(null)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [truckById, locById, mapToken, depot.lat, depot.lng, setPlan, depotForRoute, priceRoutes],
  )

  const summarize = (rs: PlannedRoute[]): Totals => ({
    cost: rs.reduce((n, r) => n + r.cost, 0),
    distanceKm: rs.reduce((n, r) => n + r.distanceKm, 0),
    co2: rs.reduce((n, r) => n + estimateCo2Kg(r.distanceKm, settings), 0),
  })

  const planTotals = useMemo(() => {
    if (!plan) return null
    const rs = plan.routes
    const t2 = summarize(rs)
    const m3 = rs.reduce((n, r) => n + r.totalM3, 0)
    return { ...t2, routes: rs.filter((r) => r.stops.length > 0).length, unitCost: m3 > 0 ? Math.round(t2.cost / m3) : 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, settings.dieselPricePerLiter, settings.fuelConsumptionKmPerL, settings.co2KgPerLiter])

  const runAutoRoute = async () => {
    const prev = plan ? summarize(plan.routes) : null
    setBusy('plan')
    setSelectedRouteId(null)
    setEditHistory([])
    // Let the spinner paint before the (synchronous) solver runs.
    await new Promise((r) => setTimeout(r, 30))
    // Keep locked routes as-is; exclude any "what-if" trucks from planning.
    const lockedRoutes = (plan?.routes ?? []).filter((r) => r.locked)
    const usableTrucks = trucks.filter((tr) => !excludedTrucks.has(tr.id))

    // Milkrun mode routes each supplier back to its own destination plant.
    const milkrun = isMilkrun(locations)

    // When road geometry is on, plan on REAL Mapbox road distances: fetch a
    // distance matrix over the depot, every plant, and the stops to be routed.
    let distanceMatrix
    if (settings.useRoadGeometry && mapToken) {
      const lockedIds = new Set(lockedRoutes.flatMap((r) => r.stops.map((s) => s.locationId)))
      const planStops = locations.filter(
        (l) => l.active && (l.demandM3 > 0 || l.demandKg > 0) && !lockedIds.has(l.id) && servesDay(l, planDay ?? undefined),
      )
      const plants = milkrun ? locations.filter((l) => l.kind === 'plant') : []
      setBusy('road')
      setProgress({ label: t('planner.progMatrix'), done: 0, total: 0 })
      distanceMatrix = (await fetchDistanceMatrix(mapToken, [depot, ...plants, ...planStops])) ?? undefined
      setBusy('plan')
      setProgress({ label: t('planner.progOptimize'), done: 0, total: 0 })
      await new Promise((r) => setTimeout(r, 30))
    }

    const args = {
      trucks: usableTrucks,
      locations,
      depot,
      avgSpeedKmh: settings.avgSpeedKmh,
      lockedRoutes,
      dayOfWeek: planDay ?? undefined,
      planStartTime: settings.shift === 'night' ? '20:00' : settings.planStartTime,
      objective: settings.optimizeObjective,
      distanceMatrix,
      shift: settings.shift,
    }
    const raw = milkrun ? planMilkrun(args) : planRoutes(args)
    const result = { ...raw, routes: priceRoutes(raw.routes) }
    setPlan(result)
    setSavings(prev ? diff(prev, summarize(result.routes)) : null)

    if (settings.useRoadGeometry && mapToken && result.routes.some((r) => !r.geometry)) {
      await snapPlanToRoads(result)
    } else {
      setProgress(null)
      setBusy(null)
    }
  }

  /* ------------------------ manual editing ------------------------ */

  const routeLocs = useCallback(
    (r: PlannedRoute): DeliveryLocation[] =>
      r.stops.map((s) => locById.get(s.locationId)).filter((l): l is DeliveryLocation => !!l),
    [locById],
  )

  // Re-snap only the routes whose geometry was cleared by an edit.
  const snapChanged = useCallback(
    async (arr: PlannedRoute[]): Promise<PlannedRoute[]> => {
      if (!settings.useRoadGeometry || !mapToken) return arr
      const out: PlannedRoute[] = []
      for (const route of arr) {
        if (route.geometry || route.stops.length === 0) {
          out.push(route)
          continue
        }
        const truck = truckById.get(route.truckId)
        const stops = routeLocs(route)
        const road = truck ? await fetchRoadRoute(mapToken, depotForRoute(route), stops).catch(() => null) : null
        out.push(
          road && truck
            ? applyRoadData(route, road, stops.reduce((a, l) => a + l.serviceMinutes, 0), truck.fixedCostPerRound, truck.costPerKm)
            : route,
        )
      }
      return out
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.useRoadGeometry, mapToken, truckById, routeLocs, depot.lat, depot.lng, depotForRoute],
  )

  const applyEdit = async (nextRoutes: PlannedRoute[]) => {
    if (plan) setEditHistory((h) => [plan.routes, ...h].slice(0, 15)) // snapshot for Undo
    const cleaned = nextRoutes.filter((r) => r.stops.length > 0)
    updatePlanRoutes(priceRoutes(cleaned))
    if (settings.useRoadGeometry && mapToken && cleaned.some((r) => !r.geometry)) {
      setBusy('road')
      const snapped = await snapChanged(cleaned)
      updatePlanRoutes(priceRoutes(snapped))
      setBusy(null)
    }
  }

  const undoEdit = () => {
    if (editHistory.length === 0) return
    const [prev, ...rest] = editHistory
    updatePlanRoutes(prev)
    setEditHistory(rest)
    setSelectedRouteId(null)
  }

  const reorderStop = (routeId: string, from: number, to: number) => {
    if (from === to) return
    const route = routes.find((r) => r.id === routeId)
    const truck = route && truckById.get(route.truckId)
    if (!route || !truck) return
    const locs = routeLocs(route)
    const [moved] = locs.splice(from, 1)
    locs.splice(to, 0, moved)
    const rebuilt = rebuildRoute(route, locs, truck, depotForRoute(route), settings.avgSpeedKmh)
    applyEdit(routes.map((r) => (r.id === routeId ? rebuilt : r)))
  }

  const reassignStop = (fromId: string, locationId: string, toId: string) => {
    if (fromId === toId) return
    const from = routes.find((r) => r.id === fromId)
    const to = routes.find((r) => r.id === toId)
    const fromTruck = from && truckById.get(from.truckId)
    const toTruck = to && truckById.get(to.truckId)
    const moved = locById.get(locationId)
    if (!from || !to || !fromTruck || !toTruck || !moved) return
    const newFrom = rebuildRoute(from, routeLocs(from).filter((l) => l.id !== locationId), fromTruck, depotForRoute(from), settings.avgSpeedKmh)
    const newTo = rebuildRoute(to, [...routeLocs(to), moved], toTruck, depotForRoute(to), settings.avgSpeedKmh)
    applyEdit(routes.map((r) => (r.id === fromId ? newFrom : r.id === toId ? newTo : r)))
  }

  // Upgrade stale plans (created without a token / road snapping) to real
  // road geometry automatically, so straight-line routes never linger.
  const upgradedOnceRef = useRef(false)
  useEffect(() => {
    if (upgradedOnceRef.current || busy !== null) return
    if (!plan || !settings.useRoadGeometry || !mapToken) return
    if (!plan.routes.some((r) => !r.geometry)) return
    upgradedOnceRef.current = true
    snapPlanToRoads(plan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, settings.useRoadGeometry, mapToken, snapPlanToRoads])

  const routes = plan?.routes ?? []
  const canPlan = activeTrucks.length > 0 && activeLocations.length > 0

  return (
    <div className="relative h-full">
      {/* Full-bleed map; all map tools sit on the left / bottom-left. */}
      <MapView
        token={mapToken}
        depot={depot}
        locations={locations}
        routes={routes}
        selectedRouteId={selectedRouteId}
        routeLabel={(r) => {
          const truck = truckById.get(r.truckId)
          return `${truck?.plateNumber ?? r.truckId} · ${t('planner.round')} ${r.round} · ${r.distanceKm} ${t('common.km')}`
        }}
        className="h-full w-full rounded-xl border border-slate-200"
      />

      {/* Floating control panel — right side, clear of the map's own controls. */}
      <div className="absolute top-2 right-2 bottom-2 w-[380px] max-w-[calc(100%-1rem)] flex flex-col gap-2 z-20">
        <div className="bg-white/95 backdrop-blur rounded-xl border border-slate-200 shadow-md px-2 py-1.5 flex items-center gap-1">
          <span className="text-sm font-semibold text-slate-800 px-1 mr-auto">{t('planner.title')}</span>
          {plan && (
            <button title={t('common.exportExcel')} onClick={() => exportToExcel({ partners, trucks, locations, plan, depotName: settings.depotName })}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"><FileSpreadsheet size={16} /></button>
          )}
          {canEditPlan && editHistory.length > 0 && (
            <button title={t('planner.undo')} onClick={undoEdit} disabled={busy !== null}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer disabled:opacity-40"><Undo2 size={16} /></button>
          )}
          {plan && canEditPlan && (
            <button title={t('planner.clearPlan')} onClick={() => setPlan(null)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"><Trash2 size={16} /></button>
          )}
          {canEditPlan && (
            <Button onClick={runAutoRoute} disabled={!canPlan || busy !== null}>
              <Route size={16} />
              {busy === 'plan' ? t('planner.planning') : busy === 'road' ? t('planner.roadGeometry') : t('planner.autoRoute')}
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-0.5 pb-1">

      {!canPlan && (
        <Card className="p-5 mb-4">
          <h2 className="text-base font-semibold text-slate-800 mb-1">{t('planner.onboardTitle')}</h2>
          <p className="text-sm text-slate-500 mb-4">{t('planner.onboardIntro')}</p>
          <ol className="space-y-2.5">
            {([
              { done: activeLocations.length > 0, label: t('planner.onboardLocations'), count: locations.length, page: 'locations', optional: false },
              { done: activeTrucks.length > 0, label: t('planner.onboardTrucks'), count: activeTrucks.length, page: 'trucks', optional: false },
              { done: partners.some((p) => p.costProfile), label: t('planner.onboardPartners'), count: partners.length, page: 'partners', optional: true },
            ] as const).map((step) => (
              <li key={step.page} className="flex items-center gap-3">
                <span className={`flex items-center justify-center w-5 h-5 rounded-full text-xs shrink-0 ${step.done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
                  {step.done ? <Check size={13} /> : ''}
                </span>
                <span className="text-sm text-slate-700 flex-1">
                  {step.label}
                  {step.optional && <span className="text-slate-400"> · {t('common.all')}</span>}
                  <span className="text-slate-400 tabular-nums"> ({step.count})</span>
                </span>
                {canEditPlan && (
                  <Button variant="secondary" onClick={() => onNavigate?.(step.page)}>{step.done ? t('common.edit') : t('common.add')}</Button>
                )}
              </li>
            ))}
          </ol>
          {canEditPlan && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={() => confirm(t('settings.resetConfirm')) && resetToSeed()}>
                {t('planner.onboardSample')}
              </Button>
              <span className="text-xs text-slate-400">{t('planner.onboardImportNote')}</span>
            </div>
          )}
        </Card>
      )}

          {progress && (
            <Card className="p-3 border-brand-200 bg-brand-50">
              <div className="flex items-center gap-2 text-sm text-brand-700 font-medium mb-2">
                <Route size={15} className="animate-pulse" />
                {progress.label}
                {progress.total > 0 && <span className="ml-auto tabular-nums text-xs text-brand-500">{progress.done}/{progress.total}</span>}
              </div>
              <div className="h-1.5 rounded-full bg-brand-100 overflow-hidden">
                <div
                  className={`h-full rounded-full bg-brand-500 ${progress.total > 0 ? 'transition-[width] duration-300' : 'animate-pulse w-1/3'}`}
                  style={progress.total > 0 ? { width: `${Math.round((progress.done / progress.total) * 100)}%` } : undefined}
                />
              </div>
            </Card>
          )}
          {plan && (
            <p className="text-xs text-slate-400">
              {t('planner.plannedAt')}: {new Date(plan.plannedAt).toLocaleString()}
            </p>
          )}

          {/* Whole-plan totals — the headline delivery cost for the chosen objective */}
          {plan && planTotals && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Coins size={16} className="text-brand-500" /> {t('planner.planTotal')}
                </div>
                <Badge tone="blue">{t(`planner.obj.${settings.optimizeObjective}`)}</Badge>
              </div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">
                ฿{fmt(Math.round(planTotals.cost), i18n.language)}
              </div>
              <div className="text-[11px] text-slate-400 mb-3">
                {t('planner.unitCost')}: ฿{fmt(planTotals.unitCost, i18n.language)}/{t('common.m3')}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  [t('planner.routesCount'), `${planTotals.routes}`, ''],
                  [t('planner.distance'), fmt(Math.round(planTotals.distanceKm), i18n.language), t('common.km')],
                  [t('planner.co2'), fmt(Math.round(planTotals.co2), i18n.language), t('common.kg')],
                ].map(([label, value, unit]) => (
                  <div key={label} className="rounded-lg bg-slate-50 py-2">
                    <div className="text-sm font-semibold text-slate-800 tabular-nums">{value} <span className="text-[10px] font-normal text-slate-400">{unit}</span></div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
                  </div>
                ))}
              </div>
              {plan.unassignedLocationIds.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                  <TriangleAlert size={13} /> {t('planner.unassignedN', { n: plan.unassignedLocationIds.length })}
                </div>
              )}
            </Card>
          )}

          {/* Before/after savings from the last re-plan */}
          {savings && (Math.abs(savings.cost) > 1 || Math.abs(savings.distanceKm) > 0.1) && (
            <Card className="p-3 bg-emerald-50 border-emerald-200">
              <div className="flex items-center gap-2 text-emerald-800 text-sm font-medium mb-1">
                <TrendingDown size={15} /> {t('planner.savingsTitle')}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-emerald-900">
                <SavingStat label={t('planner.cost')} value={savings.cost} unit={t('common.baht')} lang={i18n.language} tLess={t('planner.less')} tMore={t('planner.more')} />
                <SavingStat label={t('planner.distance')} value={savings.distanceKm} unit={t('common.km')} lang={i18n.language} tLess={t('planner.less')} tMore={t('planner.more')} />
                <SavingStat label={t('planner.co2')} value={savings.co2} unit={t('common.kg')} lang={i18n.language} tLess={t('planner.less')} tMore={t('planner.more')} />
              </div>
            </Card>
          )}

          {/* Multi-day: pick the weekday to plan + weekly demand overview */}
          {canEditPlan && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-sm font-medium text-slate-700 flex items-center gap-2 mb-2">
                <Coins size={15} className="text-slate-400" /> {t('planner.optimizeFor')}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  ['cost', Coins],
                  ['distance', Spline],
                  ['balanced', Scale],
                ] as [OptimizeObjective, typeof Coins][]).map(([obj, Icon]) => (
                  <button
                    key={obj}
                    onClick={() => updateSettings({ optimizeObjective: obj })}
                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-xs font-medium cursor-pointer border transition ${
                      settings.optimizeObjective === obj
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Icon size={16} />
                    {t(`planner.obj.${obj}`)}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">{t(`planner.objHint.${settings.optimizeObjective}`)}</p>
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="text-sm font-medium text-slate-700 flex items-center gap-2 mb-2">
                  {settings.shift === 'night' ? <Moon size={15} className="text-slate-400" /> : <Sun size={15} className="text-slate-400" />}
                  {t('planner.shift')}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['day', 'night'] as const).map((sh) => (
                    <button
                      key={sh}
                      onClick={() => updateSettings({ shift: sh, planStartTime: sh === 'night' ? '20:00' : '08:00' })}
                      className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium cursor-pointer border transition ${
                        settings.shift === sh
                          ? 'bg-brand-500 text-white border-brand-500'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {sh === 'night' ? <Moon size={14} /> : <Sun size={14} />}
                      {t(`planner.shifts.${sh}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {canEditPlan && (
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer flex items-center gap-2">
                <CalendarDays size={15} className="text-slate-400" /> {t('planner.planDay')}
                <Badge tone="blue">
                  {planDay === null ? t('week.everyDay') : t(`week.days.${planDay}`)}
                </Badge>
              </summary>
              <div className="px-4 pb-3 pt-1">
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <button
                    onClick={() => setPlanDay(null)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${planDay === null ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {t('week.everyDay')}
                  </button>
                  {weekly.map((w) => (
                    <button
                      key={w.day}
                      onClick={() => setPlanDay(w.day)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${planDay === w.day ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {t(`week.days.${w.day}`)}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mb-1">{t('planner.weekOverview')}</p>
                <div className="space-y-1">
                  {weekly.map((w) => (
                    <div key={w.day} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 text-xs">
                      <span className={`font-medium ${planDay === w.day ? 'text-brand-600' : 'text-slate-500'}`}>
                        {t(`week.days.${w.day}`)}
                      </span>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${Math.min(100, (w.count / Math.max(1, activeLocations.length)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-slate-500 whitespace-nowrap tabular-nums">
                        {w.count} · {w.m3} {t('common.m3')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}

          {/* What-if fleet: exclude trucks from the next Auto Route */}
          {activeTrucks.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer flex items-center gap-2">
                <TruckIcon size={15} className="text-slate-400" /> {t('planner.fleet')}
                {excludedTrucks.size > 0 && <Badge tone="amber">−{excludedTrucks.size}</Badge>}
              </summary>
              <div className="px-4 pb-3 pt-1">
                <p className="text-xs text-slate-500 mb-2">{t('planner.fleetHint')}</p>
                <div className="space-y-1">
                  {activeTrucks.map((tr) => (
                    <label key={tr.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={!excludedTrucks.has(tr.id)}
                        onChange={(e) =>
                          setExcludedTrucks((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.delete(tr.id)
                            else next.add(tr.id)
                            return next
                          })
                        }
                      />
                      {tr.plateNumber}
                      <span className="text-xs text-slate-400">
                        · {tr.capacityM3} {t('common.m3')} · {t('trucks.roundsPerDay')} {tr.roundsPerDay}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          )}

          {/* Save & compare plan scenarios (A/B, history) */}
          {canEditPlan && (plan || scenarios.length > 0) && (
            <details className="rounded-xl border border-slate-200 bg-white" open={scenarios.length > 0}>
              <summary className="px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer flex items-center gap-2">
                <Save size={15} className="text-slate-400" /> {t('planner.scenarios')}
                {scenarios.length > 0 && <Badge tone="blue">{scenarios.length}</Badge>}
              </summary>
              <div className="px-4 pb-3 pt-1">
                {plan && (
                  <Button
                    variant="secondary"
                    className="mb-2 w-full justify-center"
                    onClick={() => {
                      const name = prompt(t('planner.scenarioName'), '')
                      if (name !== null) saveScenario(name)
                    }}
                  >
                    <Save size={14} /> {t('planner.saveScenario')}
                  </Button>
                )}
                {scenarios.length > 0 && (() => {
                  const cheapest = Math.min(...scenarios.map((sc) => sc.totalCost))
                  return (
                    <div className="space-y-1.5">
                      {scenarios.map((sc) => (
                        <div key={sc.id} className="rounded-lg border border-slate-100 p-2 text-xs">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="font-medium text-slate-800 truncate">{sc.name}</span>
                            {sc.totalCost === cheapest && scenarios.length > 1 && <Badge tone="green">{t('costs.best')}</Badge>}
                            <span className="ml-auto flex gap-1.5 shrink-0">
                              <button className="text-brand-600 hover:underline cursor-pointer" onClick={() => loadScenario(sc.id)}>{t('planner.load')}</button>
                              <button className="text-rose-500 hover:underline cursor-pointer" onClick={() => deleteScenario(sc.id)}>{t('common.delete')}</button>
                            </span>
                          </div>
                          <div className="text-slate-500 tabular-nums">
                            {sc.trucks} {t('planner.routesCount').toLowerCase()} · {fmt(sc.distanceKm, i18n.language)} {t('common.km')} · ฿{fmt(sc.totalCost, i18n.language)}
                            {sc.totalCost !== cheapest && scenarios.length > 1 && <span className="text-rose-500"> (+{fmt(sc.totalCost - cheapest, i18n.language)})</span>}
                            <span className="text-slate-400"> · {t(`planner.shifts.${sc.shift}`)} · {t(`planner.obj.${sc.objective}`)}</span>
                            {sc.unassigned > 0 && <span className="text-amber-600"> · {t('planner.unassignedN', { n: sc.unassigned })}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </details>
          )}

          {routes.map((route) => {
            const truck = truckById.get(route.truckId)
            const partner = truck ? partnerById.get(truck.partnerId) : undefined
            const firstStop = route.stops[0] && locById.get(route.stops[0].locationId)
            const routePlant = firstStop?.deliveryPlantId ? plantById.get(firstStop.deliveryPlantId) : undefined
            const utilM3 = truck ? Math.round((route.totalM3 / truck.capacityM3) * 100) : 0
            const utilKg = truck ? Math.round((route.totalKg / truck.capacityKg) * 100) : 0
            const selected = selectedRouteId === route.id
            return (
              <Card
                key={route.id}
                className={`p-4 cursor-pointer transition-shadow ${selected ? 'ring-2 ring-brand-500' : 'hover:shadow-md'}`}
              >
                <button
                  className="w-full text-left cursor-pointer"
                  onClick={() => setSelectedRouteId(selected ? null : route.id)}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ background: ROUTE_COLORS[route.colorIndex % ROUTE_COLORS.length] }}
                    />
                    <TruckIcon size={16} className="text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-800">
                      {truck?.plateNumber ?? route.truckId}
                    </span>
                    {routePlant && <Badge tone="slate">{t('planner.toPlant', { plant: routePlant.code })}</Badge>}
                    <Badge tone="blue">
                      {t('planner.round')} {route.round}
                    </Badge>
                    {(route.roundsPerDay ?? 1) > 1 && (
                      <Badge tone="amber">{t('planner.roundsPerDay', { n: route.roundsPerDay })}</Badge>
                    )}
                    <Badge tone={STATUS_TONE[route.status ?? 'planned']}>
                      {t(`planner.statuses.${route.status ?? 'planned'}`)}
                    </Badge>
                    {route.locked && (
                      <Badge tone="amber">
                        <Lock size={10} className="inline mr-0.5" />{t('planner.locked')}
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-slate-400">
                      {route.stops.length} {t('planner.stops')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
                    {partner && <span>{partner.name}</span>}
                    {driverByTruck.get(route.truckId) && (
                      <span className="inline-flex items-center gap-1">
                        <UserRound size={12} />
                        {i18n.language === 'th'
                          ? driverByTruck.get(route.truckId)!.nameTh || driverByTruck.get(route.truckId)!.name
                          : driverByTruck.get(route.truckId)!.name}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 mb-2">
                    <span>
                      {t('planner.volume')}: <b>{route.totalM3}</b>/{truck?.capacityM3} {t('common.m3')} ({utilM3}%)
                    </span>
                    <span>
                      {t('planner.weight')}: <b>{fmt(route.totalKg, i18n.language)}</b>/{fmt(truck?.capacityKg ?? 0, i18n.language)} {t('common.kg')} ({utilKg}%)
                    </span>
                    <span>
                      {t('planner.distance')}: <b>{route.distanceKm}</b> {t('common.km')}
                    </span>
                    <span>
                      {t('planner.duration')}: <b>{route.durationMinutes}</b> {t('common.min')}
                    </span>
                    <span>
                      {t('planner.cost')}: <b>{fmt(route.cost, i18n.language)}</b> {t('common.baht')}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Leaf size={12} className="text-emerald-500" />
                      {t('planner.co2')}: <b>{fmt(estimateCo2Kg(route.distanceKm, settings), i18n.language)}</b> {t('common.kg')}
                    </span>
                  </div>

                  {/* Utilization bar — single-hue magnitude */}
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, utilM3)}%`,
                        background: ROUTE_COLORS[route.colorIndex % ROUTE_COLORS.length],
                      }}
                    />
                  </div>
                </button>

                {/* Trip status workflow (outside the toggling button) */}
                {canEditPlan && (
                <div className="flex items-center gap-2 mt-3">
                  {(() => {
                    const next = NEXT_ACTION[route.status ?? 'planned']
                    return next ? (
                      <Button
                        className="!px-2.5 !py-1 text-xs"
                        onClick={() => updateRouteStatus(route.id, next[0])}
                      >
                        {t(next[1])}
                      </Button>
                    ) : null
                  })()}
                  {(route.status ?? 'planned') !== 'planned' && (
                    <Button
                      variant="ghost"
                      className="!px-2.5 !py-1 text-xs"
                      onClick={() => updateRouteStatus(route.id, 'planned')}
                    >
                      {t('planner.reopen')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="!px-2.5 !py-1 text-xs ml-auto"
                    onClick={() => patchRoute(route.id, { locked: !route.locked })}
                  >
                    {route.locked ? <LockOpen size={13} /> : <Lock size={13} />}
                    {route.locked ? t('planner.unlock') : t('planner.lock')}
                  </Button>
                </div>
                )}

                {selected && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {canEditPlan && (
                      <p className="text-[11px] text-slate-400 mb-2 flex items-center gap-1">
                        <GripVertical size={12} /> {t('planner.reorderHint')}
                      </p>
                    )}
                    <ol className="space-y-1">
                      {route.stops.map((s, idx) => {
                        const loc = locById.get(s.locationId)
                        const otherRoutes = routes.filter((r) => r.id !== route.id)
                        const isDragging = drag?.routeId === route.id && drag.index === idx
                        return (
                          <li
                            key={s.locationId}
                            draggable={canEditPlan}
                            onDragStart={() => canEditPlan && setDrag({ routeId: route.id, index: idx })}
                            onDragOver={(e) => canEditPlan && e.preventDefault()}
                            onDrop={(e) => {
                              if (!canEditPlan) return
                              e.preventDefault()
                              if (drag?.routeId === route.id) reorderStop(route.id, drag.index, idx)
                              setDrag(null)
                            }}
                            onDragEnd={() => setDrag(null)}
                            className={`flex items-center gap-2 text-xs rounded-md px-1 py-1 ${canEditPlan ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : 'hover:bg-slate-50'}`}
                          >
                            {canEditPlan && <GripVertical size={13} className="text-slate-300 shrink-0" />}
                            <span className="w-5 h-5 shrink-0 rounded-full bg-slate-800 text-white flex items-center justify-center text-[10px] font-semibold">
                              {s.sequence}
                            </span>
                            <span className="text-slate-700 flex-1 min-w-0 truncate">
                              {i18n.language === 'th' ? loc?.nameTh || loc?.name : loc?.name}
                            </span>
                            <span className="text-slate-400 whitespace-nowrap">
                              +{s.distanceFromPrevKm} {t('common.km')} · {s.etaMinutes} {t('common.min')}
                            </span>
                            {s.lateBy ? (
                              <Badge tone="red">{t('planner.lateWindow', { n: s.lateBy })}</Badge>
                            ) : loc?.windowStart ? (
                              <Badge tone="green">{t('planner.inWindow')}</Badge>
                            ) : null}
                            {canEditPlan && otherRoutes.length > 0 && (
                              <select
                                title={t('planner.moveTo')}
                                value=""
                                onChange={(e) => e.target.value && reassignStop(route.id, s.locationId, e.target.value)}
                                className="shrink-0 rounded border border-slate-200 text-[11px] text-slate-500 py-0.5 max-w-[5rem]"
                              >
                                <option value="">{t('planner.moveTo')}</option>
                                {otherRoutes.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {truckById.get(r.truckId)?.plateNumber ?? r.truckId}
                                  </option>
                                ))}
                              </select>
                            )}
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                )}
              </Card>
            )
          })}

          {plan && plan.unassignedLocationIds.length > 0 && (
            <Card className="p-4 border-amber-200 bg-amber-50">
              <div className="flex items-center gap-2 text-amber-800 font-medium text-sm mb-1">
                <TriangleAlert size={16} /> {t('planner.unassigned')} ({plan.unassignedLocationIds.length})
              </div>
              <p className="text-xs text-amber-700 mb-2">{t('planner.unassignedHint')}</p>
              <ul className="text-xs text-amber-900 space-y-1">
                {plan.unassignedLocationIds.map((id) => {
                  const loc = locById.get(id)
                  if (!loc) return null
                  const reason = explainUnassigned(
                    loc, usableTrucksForExplain, depotForLoc(loc), settings.avgSpeedKmh,
                    settings.shift === 'night' ? 20 * 60 : 8 * 60, settings.shift,
                  )
                  const tone = reason === 'capacity' ? 'red' : reason === 'window' ? 'amber' : 'slate'
                  return (
                    <li key={id} className="flex items-center gap-1.5">
                      <span>{loc.code} — {i18n.language === 'th' ? loc.nameTh || loc.name : loc.name} ({loc.demandM3} {t('common.m3')} / {fmt(loc.demandKg, i18n.language)} {t('common.kg')})</span>
                      <Badge tone={tone}>{t(`planner.unreason.${reason}`)}</Badge>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

const fmt = (n: number, lang: string) =>
  n.toLocaleString(lang === 'th' ? 'th-TH' : 'en-US')

/** Positive = the new plan uses less than the previous one (a saving). */
function diff(prev: Totals, now: Totals): Savings {
  return {
    cost: Math.round((prev.cost - now.cost) * 100) / 100,
    distanceKm: Math.round((prev.distanceKm - now.distanceKm) * 100) / 100,
    co2: Math.round((prev.co2 - now.co2) * 100) / 100,
  }
}

function SavingStat({
  label, value, unit, lang, tLess, tMore,
}: {
  label: string; value: number; unit: string; lang: string; tLess: string; tMore: string
}) {
  const saved = value >= 0
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className={`font-semibold ${saved ? 'text-emerald-700' : 'text-red-600'}`}>
        {saved ? '−' : '+'}{fmt(Math.abs(value), lang)} {unit}
      </div>
      <div className="text-[10px] opacity-70">{saved ? tLess : tMore}</div>
    </div>
  )
}
