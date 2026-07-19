import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown, ArrowUp, Camera, CheckCircle2, ChevronDown, ChevronRight, ChevronsUpDown,
  Flag, Info, Navigation, Printer, RotateCcw, Send, TriangleAlert,
} from 'lucide-react'
import { newId, useTms } from '../store'
import { printRouteSheet } from '../lib/routeSheet'
import { printManifest } from '../lib/documents'
import { ROUTE_COLORS } from '../components/MapView'
import {
  Badge, Button, Card, Field, Modal, PageHeader, inputClass,
} from '../components/ui'
import {
  podDelayMinutes,
  type Incident, type IncidentSeverity, type IncidentType, type PlannedRoute, type PodRecord, type PodStatus, type TripStatus,
} from '../types'

const INCIDENT_TYPES: IncidentType[] = ['breakdown', 'delay', 'accident', 'damage', 'other']
const INCIDENT_SEVERITIES: IncidentSeverity[] = ['low', 'medium', 'high']

const STATUS_TONE: Record<TripStatus, 'slate' | 'blue' | 'amber' | 'green'> = {
  planned: 'slate', dispatched: 'blue', 'in-transit': 'amber', completed: 'green',
}
/** Next trip action per status: [nextStatus, i18nKey, icon]. */
const NEXT_ACTION: Partial<Record<TripStatus, [TripStatus, string, typeof Send]>> = {
  planned: ['dispatched', 'planner.dispatch', Send],
  dispatched: ['in-transit', 'planner.startTrip', Navigation],
  'in-transit': ['completed', 'planner.complete', Flag],
}
// Board order: active trips first, then planned, then done.
const STATUS_ORDER: Record<TripStatus, number> = {
  'in-transit': 0, dispatched: 1, planned: 2, completed: 3,
}
type SortKey = 'status' | 'plate' | 'driver' | 'departure' | 'progress' | 'ontime'

export default function Operations() {
  const { t, i18n } = useTranslation()
  const { plan, trucks, partners, drivers, locations, pods, incidents, settings,
    patchRoute, updateRouteStatus, upsertPod, upsertIncident, deleteIncident } = useTms()

  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const truckById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks])
  const partnerById = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners])
  const driverByTruck = useMemo(
    () => new Map(drivers.filter((d) => d.truckId).map((d) => [d.truckId as string, d])),
    [drivers],
  )
  const podById = useMemo(() => new Map(pods.map((p) => [p.id, p])), [pods])

  const [podEdit, setPodEdit] = useState<{ route: PlannedRoute; locationId: string } | null>(null)
  const [incidentEdit, setIncidentEdit] = useState<{ route: PlannedRoute } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [filter, setFilter] = useState<TripStatus | 'all'>('all')
  // Stop lists collapse per route; active trips (dispatched / in-transit) open by default.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const isOpen = (r: PlannedRoute) =>
    openMap[r.id] ?? ['dispatched', 'in-transit'].includes(r.status ?? 'planned')
  const toggleOpen = (r: PlannedRoute) => setOpenMap((m) => ({ ...m, [r.id]: !isOpen(r) }))
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'status', dir: 'asc' })
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  const allRoutes = plan?.routes ?? []
  const routes = filter === 'all' ? allRoutes : allRoutes.filter((r) => (r.status ?? 'planned') === filter)

  const ops = useMemo(() => {
    const status: Record<TripStatus, number> = { planned: 0, dispatched: 0, 'in-transit': 0, completed: 0 }
    let stops = 0, delivered = 0, failed = 0, onTime = 0, late = 0, early = 0
    for (const r of allRoutes) {
      status[r.status ?? 'planned']++
      for (const s of r.stops) {
        stops++
        const pod = podById.get(`${r.id}:${s.locationId}`)
        if (pod?.status === 'delivered') delivered++
        else if (pod?.status === 'failed') failed++
        if (pod?.arrival) {
          const d = podDelayMinutes(r, s.etaMinutes, pod.arrival)
          if (d != null) { if (d > 5) late++; else if (d < -5) early++; else onTime++ }
        }
      }
    }
    const recorded = onTime + late + early
    return { status, stops, delivered, failed, onTime, late, early, recorded }
  }, [allRoutes, podById])
  const locName = (id: string) => {
    const l = locById.get(id)
    return l ? (i18n.language === 'th' ? l.nameTh || l.name : l.name) : id
  }
  const clock = (start: string, add: number) => {
    const [h, m] = (start || '08:00').split(':').map(Number)
    const total = h * 60 + m + add
    return `${String(Math.floor((total % 1440) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  // One derived, sorted row per trip — the data model behind the table.
  const tripRows = useMemo(() => {
    const arr = routes.map((route) => {
      const truck = truckById.get(route.truckId)
      const partner = truck ? partnerById.get(truck.partnerId) : undefined
      const driver = driverByTruck.get(route.truckId)
      const total = route.stops.length
      let delivered = 0, rOn = 0, rRec = 0
      for (const s of route.stops) {
        const pod = podById.get(`${route.id}:${s.locationId}`)
        if (pod?.status === 'delivered') delivered++
        if (pod?.arrival) {
          const d = podDelayMinutes(route, s.etaMinutes, pod.arrival)
          if (d != null) { rRec++; if (Math.abs(d) <= 5) rOn++ }
        }
      }
      return {
        route, truck, partner, driver,
        start: route.startTime || '08:00',
        total, delivered,
        pct: total > 0 ? Math.round((delivered / total) * 100) : 0,
        status: route.status ?? 'planned',
        onTimePct: rRec > 0 ? Math.round((rOn / rRec) * 100) : -1,
        color: ROUTE_COLORS[route.colorIndex % ROUTE_COLORS.length],
        plate: truck?.plateNumber ?? route.truckId,
        driverName: driver ? (i18n.language === 'th' ? driver.nameTh || driver.name : driver.name) : '',
      }
    })
    type Row = (typeof arr)[number]
    const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
      status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
      plate: (a, b) => a.plate.localeCompare(b.plate),
      driver: (a, b) => a.driverName.localeCompare(b.driverName),
      departure: (a, b) => a.start.localeCompare(b.start),
      progress: (a, b) => a.pct - b.pct,
      ontime: (a, b) => a.onTimePct - b.onTimePct,
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    arr.sort((a, b) => { const c = cmp[sort.key](a, b); return c !== 0 ? c * dir : a.plate.localeCompare(b.plate) })
    return arr
  }, [routes, truckById, partnerById, driverByTruck, podById, sort, i18n.language])

  const allOpen = tripRows.length > 0 && tripRows.every((r) => isOpen(r.route))
  const setAllOpen = (open: boolean) =>
    setOpenMap(Object.fromEntries(tripRows.map((r) => [r.route.id, open])))

  if (allRoutes.length === 0) {
    return (
      <div>
        <PageHeader title={t('ops.title')} />
        <Card className="p-8 flex items-center gap-3 text-slate-500">
          <Info size={20} /> {t('ops.noPlan')}
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={t('ops.title')}
        actions={
          plan ? (
            <Button
              variant="secondary"
              onClick={() =>
                printManifest(plan, { trucks, drivers, partners, locations, settings })
              }
            >
              <Printer size={16} /> {t('doc.manifest')}
            </Button>
          ) : undefined
        }
      />

      {/* Operations overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <OpsKpi label={t('ops.kpiRoutes')} value={String(allRoutes.length)} sub={`${ops.stops} ${t('planner.stops')}`} />
        <OpsKpi label={t('ops.onRoad')} value={String(ops.status.dispatched + ops.status['in-transit'])} sub={`${ops.status.dispatched} ${t('planner.statuses.dispatched').toLowerCase()} · ${ops.status['in-transit']} ${t('planner.statuses.in-transit').toLowerCase()}`} tone="amber" />
        <OpsKpi label={t('planner.statuses.completed')} value={String(ops.status.completed)} sub={`${ops.status.planned} ${t('planner.statuses.planned').toLowerCase()}`} tone="green" />
        <OpsKpi primary label={t('ops.deliveries')} value={`${ops.delivered}/${ops.stops}`} sub={`${ops.stops > 0 ? Math.round((ops.delivered / ops.stops) * 100) : 0}% ${t('ops.done')}`} />
        <OpsKpi label={t('ops.onTimeRate')} value={ops.recorded > 0 ? `${Math.round((ops.onTime / ops.recorded) * 100)}%` : '—'} sub={`${ops.onTime}/${ops.recorded} ${t('ops.recorded')}`} tone="green" />
        <OpsKpi label={t('analytics.late')} value={String(ops.late)} sub={`${ops.early} ${t('analytics.early')} · ${ops.failed} ${t('pod.statuses.failed')}`} tone={ops.late > 0 || ops.failed > 0 ? 'red' : undefined} />
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {(['all', 'planned', 'dispatched', 'in-transit', 'completed'] as const).map((f) => {
          const n = f === 'all' ? allRoutes.length : ops.status[f]
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition ${filter === f ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {f === 'all' ? t('common.all') : t(`planner.statuses.${f}`)} <span className="tabular-nums opacity-70">({n})</span>
            </button>
          )
        })}
      </div>

      {/* Trip data table */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
          <span className="text-xs text-slate-500 tabular-nums">
            {tripRows.length} {t('costs.routesCount').toLowerCase()}
          </span>
          <button
            onClick={() => setAllOpen(!allOpen)}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600 cursor-pointer"
          >
            {allOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {allOpen ? t('ops.collapseAll') : t('ops.expandAll')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="w-9" />
                <SortTh label={t('common.status')} k="status" sort={sort} onSort={toggleSort} />
                <SortTh label={t('trucks.plate')} k="plate" sort={sort} onSort={toggleSort} />
                <SortTh label={t('ops.crew')} k="driver" sort={sort} onSort={toggleSort} />
                <SortTh label={t('ops.startTime')} k="departure" sort={sort} onSort={toggleSort} />
                <SortTh label={t('ops.deliveries')} k="progress" sort={sort} onSort={toggleSort} />
                <SortTh label={t('ops.onTimeRate')} k="ontime" sort={sort} onSort={toggleSort} align="right" />
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tripRows.map((row) => {
                const { route, truck, partner, driver, start, total, delivered, pct, status, color, plate, driverName, onTimePct } = row
                const next = NEXT_ACTION[status]
                const open = isOpen(route)
                return (
                  <Fragment key={route.id}>
                    <tr className={`transition-colors ${open ? 'bg-slate-50/50' : 'hover:bg-slate-50/70'}`}>
                      <td className="pl-3 align-middle">
                        <button onClick={() => toggleOpen(route)} className="text-slate-400 hover:text-slate-700 cursor-pointer align-middle" aria-label={plate}>
                          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <Badge tone={STATUS_TONE[status]}>{t(`planner.statuses.${status}`)}</Badge>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                          <span className="font-semibold text-slate-800">{plate}</span>
                          <span className="text-[11px] text-slate-400">{t('planner.round')} {route.round}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-slate-700 truncate max-w-[11rem]">{driverName || '—'}</div>
                        {partner && <div className="text-[11px] text-slate-400 truncate max-w-[11rem]">{partner.name}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="time"
                          value={start}
                          onChange={(e) => patchRoute(route.id, { startTime: e.target.value })}
                          className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 min-w-[8.5rem]">
                          <span className="tabular-nums text-slate-700 font-medium w-9">{delivered}/{total}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {onTimePct >= 0 ? (
                          <span className={`tabular-nums font-medium ${onTimePct >= 90 ? 'text-emerald-600' : onTimePct >= 70 ? 'text-amber-600' : 'text-rose-600'}`}>{onTimePct}%</span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {next && (() => {
                            const Icon = next[2]
                            return (
                              <Button className="!px-2.5 !py-1 text-xs whitespace-nowrap" onClick={() => updateRouteStatus(route.id, next[0])}>
                                <Icon size={13} /> {t(next[1])}
                              </Button>
                            )
                          })()}
                          {status !== 'planned' && (
                            <Button variant="ghost" className="!px-1.5 !py-1" title={t('planner.reopen')} aria-label={t('planner.reopen')} onClick={() => updateRouteStatus(route.id, 'planned')}>
                              <RotateCcw size={14} />
                            </Button>
                          )}
                          <Button variant="ghost" className="!px-1.5 !py-1" title={t('ops.logIncident')} aria-label={t('ops.logIncident')} onClick={() => setIncidentEdit({ route })}>
                            <TriangleAlert size={14} className="text-amber-500" />
                          </Button>
                          <Button variant="ghost" className="!px-1.5 !py-1" title={t('ops.routeSheet')} aria-label={t('ops.routeSheet')} onClick={() => printRouteSheet({ route, truck, driver, partner, depotName: settings.depotName, locById })}>
                            <Printer size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className="bg-slate-50/60 border-t border-slate-100 px-4 py-3 pl-12">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                                  <th className="w-8 pb-1.5 font-medium">#</th>
                                  <th className="pb-1.5 pr-3 font-medium">{t('planner.stops')}</th>
                                  <th className="pb-1.5 pr-3 font-medium w-20">{t('pod.plannedEta')}</th>
                                  <th className="pb-1.5 pr-3 font-medium w-20">{t('ops.arrived')}</th>
                                  <th className="pb-1.5 pr-3 font-medium">{t('common.status')}</th>
                                  <th className="pb-1.5" />
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {route.stops.map((s) => {
                                  const pod = podById.get(`${route.id}:${s.locationId}`)
                                  const st = pod?.status ?? 'pending'
                                  const delay = pod?.arrival ? podDelayMinutes(route, s.etaMinutes, pod.arrival) : null
                                  const seqCls =
                                    st === 'delivered' ? 'bg-emerald-500 text-white'
                                    : st === 'failed' ? 'bg-rose-500 text-white'
                                    : 'bg-white border border-slate-300 text-slate-500'
                                  return (
                                    <tr key={s.locationId} className="align-middle">
                                      <td className="py-2">
                                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${seqCls}`}>
                                          {st === 'delivered' ? <CheckCircle2 size={13} /> : s.sequence}
                                        </span>
                                      </td>
                                      <td className="py-2 pr-3 text-slate-700">{locName(s.locationId)}</td>
                                      <td className="py-2 pr-3 tabular-nums text-slate-500">{clock(start, s.etaMinutes)}</td>
                                      <td className="py-2 pr-3 tabular-nums text-slate-500">{pod?.arrival ?? '—'}</td>
                                      <td className="py-2 pr-3">
                                        <div className="flex items-center gap-1.5">
                                          {delay != null && (
                                            <Badge tone={delay > 5 ? 'red' : delay < -5 ? 'blue' : 'green'}>
                                              {delay > 5 ? t('ops.late', { n: delay }) : delay < -5 ? t('ops.early', { n: -delay }) : t('ops.onTime')}
                                            </Badge>
                                          )}
                                          {st === 'failed' && <Badge tone="red">{t('pod.statuses.failed')}</Badge>}
                                          {st === 'delivered' && delay == null && <Badge tone="green">{t('pod.statuses.delivered')}</Badge>}
                                          {st === 'pending' && <span className="text-xs text-slate-400">{t('pod.statuses.pending')}</span>}
                                          {pod?.photoDataUrl && <Camera size={14} className="text-slate-400" />}
                                        </div>
                                      </td>
                                      <td className="py-2 text-right">
                                        <Button variant={st === 'pending' ? 'secondary' : 'ghost'} className="!px-2.5 !py-1 text-xs" onClick={() => setPodEdit({ route, locationId: s.locationId })}>
                                          {st === 'pending' ? t('ops.recordPod') : t('common.edit')}
                                        </Button>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {podEdit && (
        <PodModal
          key={`${podEdit.route.id}:${podEdit.locationId}`}
          routeId={podEdit.route.id}
          locationId={podEdit.locationId}
          locationName={locName(podEdit.locationId)}
          existing={podById.get(`${podEdit.route.id}:${podEdit.locationId}`)}
          onClose={() => setPodEdit(null)}
          onSave={(p) => {
            upsertPod(p)
            // A failed delivery auto-logs an incident (kept in sync by a
            // deterministic id — reverting the POD clears it again).
            const r = podEdit.route
            const incId = `podfail:${r.id}:${podEdit.locationId}`
            if (p.status === 'failed') {
              upsertIncident({
                id: incId,
                date: new Date().toISOString().slice(0, 10),
                type: 'other', severity: 'medium',
                truckId: r.truckId, routeId: r.id,
                description: t('ops.failedIncident', { loc: locName(podEdit.locationId) }),
                resolved: false,
              })
            } else if (incidents.some((i) => i.id === incId)) {
              deleteIncident(incId)
            }
            setPodEdit(null)
          }}
        />
      )}

      {incidentEdit && (
        <IncidentModal
          route={incidentEdit.route}
          plate={truckById.get(incidentEdit.route.truckId)?.plateNumber ?? incidentEdit.route.truckId}
          onClose={() => setIncidentEdit(null)}
          onSave={(inc) => {
            upsertIncident(inc)
            setIncidentEdit(null)
            setToast(t('ops.incidentLogged', { plate: truckById.get(inc.truckId ?? '')?.plateNumber ?? '' }))
            setTimeout(() => setToast(null), 3000)
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-900 text-white text-sm px-4 py-2.5 shadow-lg flex items-center gap-2">
          <TriangleAlert size={15} className="text-amber-400" /> {toast}
        </div>
      )}
    </div>
  )
}

function IncidentModal({ route, plate, onClose, onSave }: {
  route: PlannedRoute; plate: string; onClose: () => void; onSave: (i: Incident) => void
}) {
  const { t } = useTranslation()
  const [type, setType] = useState<IncidentType>('delay')
  const [severity, setSeverity] = useState<IncidentSeverity>('medium')
  const [description, setDescription] = useState('')
  return (
    <Modal title={`${t('ops.logIncident')} — ${plate} · ${t('planner.round')} ${route.round}`} onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('incidents.type')}>
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as IncidentType)}>
            {INCIDENT_TYPES.map((ty) => <option key={ty} value={ty}>{t(`incidents.types.${ty}`)}</option>)}
          </select>
        </Field>
        <Field label={t('incidents.severity')}>
          <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}>
            {INCIDENT_SEVERITIES.map((sv) => <option key={sv} value={sv}>{t(`incidents.severities.${sv}`)}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('incidents.description')}>
            <input className={inputClass} value={description} autoFocus onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={() => onSave({
          id: newId(), date: new Date().toISOString().slice(0, 10),
          type, severity, truckId: route.truckId, routeId: route.id,
          description: description.trim(), resolved: false,
        })}>{t('common.save')}</Button>
      </div>
    </Modal>
  )
}

function SortTh({ label, k, sort, onSort, align }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void; align?: 'right'
}) {
  const active = sort.key === k
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={`px-3 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide cursor-pointer ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-slate-700' : 'text-slate-500 hover:text-slate-700'}`}
      >
        {label}
        <Icon size={12} className={active ? 'text-brand-500' : 'text-slate-300'} />
      </button>
    </th>
  )
}

function OpsKpi({ label, value, sub, primary, tone }: { label: string; value: string; sub?: string; primary?: boolean; tone?: 'green' | 'amber' | 'red' }) {
  const vColor = primary ? 'text-white' : tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-rose-600' : 'text-slate-900'
  return (
    <div className={`rounded-xl border shadow-sm p-4 ${primary ? 'bg-brand-500 border-brand-500' : 'bg-white border-slate-200'}`}>
      <div className={`text-xs font-medium mb-2 ${primary ? 'text-white/80' : 'text-slate-500'}`}>{label}</div>
      <p className={`text-xl font-bold tabular-nums leading-none ${vColor}`}>{value}</p>
      {sub && <p className={`text-[11px] mt-1.5 truncate ${primary ? 'text-white/70' : 'text-slate-400'}`}>{sub}</p>}
    </div>
  )
}

const POD_STATUSES: PodStatus[] = ['pending', 'delivered', 'failed']

function PodModal({
  routeId, locationId, locationName, existing, onClose, onSave,
}: {
  routeId: string
  locationId: string
  locationName: string
  existing?: PodRecord
  onClose: () => void
  onSave: (p: PodRecord) => void
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<PodStatus>(existing?.status ?? 'delivered')
  const [arrival, setArrival] = useState(existing?.arrival ?? new Date().toTimeString().slice(0, 5))
  const [receivedBy, setReceivedBy] = useState(existing?.receivedBy ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [photo, setPhoto] = useState<string | undefined>(existing?.photoDataUrl)

  const onPhoto = (file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhoto(reader.result as string)
    reader.readAsDataURL(file)
  }

  const save = () =>
    onSave({
      id: `${routeId}:${locationId}`,
      routeId,
      locationId,
      status,
      arrival,
      receivedBy: receivedBy.trim(),
      note: note.trim(),
      photoDataUrl: photo,
      recordedAt: new Date().toISOString(),
    })

  return (
    <Modal title={`${t('ops.pod')} — ${locationName}`} onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('pod.status')}>
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as PodStatus)}>
            {POD_STATUSES.map((s) => <option key={s} value={s}>{t(`pod.statuses.${s}`)}</option>)}
          </select>
        </Field>
        <Field label={t('pod.arrival')}>
          <input type="time" className={inputClass} value={arrival} onChange={(e) => setArrival(e.target.value)} />
        </Field>
        <Field label={t('pod.receivedBy')}>
          <input className={inputClass} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
        </Field>
        <Field label={t('pod.photo')}>
          <input type="file" accept="image/*" className="text-sm" onChange={(e) => onPhoto(e.target.files?.[0])} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('pod.note')}>
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {photo && (
          <div className="sm:col-span-2">
            <img src={photo} alt="POD" className="max-h-40 rounded-lg border border-slate-200" />
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={save}>{t('common.save')}</Button>
      </div>
    </Modal>
  )
}
