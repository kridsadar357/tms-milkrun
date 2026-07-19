import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Camera, CheckCircle2, ChevronDown, ChevronRight, Clock, Flag, Info, Navigation,
  Printer, RotateCcw, Send, UserRound,
} from 'lucide-react'
import { useTms } from '../store'
import { printRouteSheet } from '../lib/routeSheet'
import { printManifest } from '../lib/documents'
import { ROUTE_COLORS } from '../components/MapView'
import {
  Badge, Button, Card, Field, Modal, PageHeader, inputClass,
} from '../components/ui'
import { podDelayMinutes, type PlannedRoute, type PodRecord, type PodStatus, type TripStatus } from '../types'

const STATUS_TONE: Record<TripStatus, 'slate' | 'blue' | 'amber' | 'green'> = {
  planned: 'slate', dispatched: 'blue', 'in-transit': 'amber', completed: 'green',
}
/** Next trip action per status: [nextStatus, i18nKey, icon]. */
const NEXT_ACTION: Partial<Record<TripStatus, [TripStatus, string, typeof Send]>> = {
  planned: ['dispatched', 'planner.dispatch', Send],
  dispatched: ['in-transit', 'planner.startTrip', Navigation],
  'in-transit': ['completed', 'planner.complete', Flag],
}

export default function Operations() {
  const { t, i18n } = useTranslation()
  const { plan, trucks, partners, drivers, locations, pods, settings, patchRoute, updateRouteStatus, upsertPod } = useTms()

  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const truckById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks])
  const partnerById = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners])
  const driverByTruck = useMemo(
    () => new Map(drivers.filter((d) => d.truckId).map((d) => [d.truckId as string, d])),
    [drivers],
  )
  const podById = useMemo(() => new Map(pods.map((p) => [p.id, p])), [pods])

  const [podEdit, setPodEdit] = useState<{ route: PlannedRoute; locationId: string } | null>(null)
  const [filter, setFilter] = useState<TripStatus | 'all'>('all')
  // Stop lists collapse per route; active trips (dispatched / in-transit) open by default.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const isOpen = (r: PlannedRoute) =>
    openMap[r.id] ?? ['dispatched', 'in-transit'].includes(r.status ?? 'planned')
  const toggleOpen = (r: PlannedRoute) => setOpenMap((m) => ({ ...m, [r.id]: !isOpen(r) }))

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

      <div className="space-y-4">
        {routes.map((route) => {
          const truck = truckById.get(route.truckId)
          const partner = truck ? partnerById.get(truck.partnerId) : undefined
          const driver = driverByTruck.get(route.truckId)
          const start = route.startTime || '08:00'
          const delivered = route.stops.filter(
            (s) => podById.get(`${route.id}:${s.locationId}`)?.status === 'delivered',
          ).length
          const color = ROUTE_COLORS[route.colorIndex % ROUTE_COLORS.length]
          const total = route.stops.length
          const pct = total > 0 ? Math.round((delivered / total) * 100) : 0
          const status = route.status ?? 'planned'
          const next = NEXT_ACTION[status]
          const open = isOpen(route)
          // On-time rate for this route (delivered / recorded stops only).
          let rOn = 0, rRec = 0
          for (const s of route.stops) {
            const pod = podById.get(`${route.id}:${s.locationId}`)
            if (pod?.arrival) {
              const d = podDelayMinutes(route, s.etaMinutes, pod.arrival)
              if (d != null) { rRec++; if (Math.abs(d) <= 5) rOn++ }
            }
          }

          return (
            <Card key={route.id} className="overflow-hidden">
              {/* Tier 1 — who + primary action */}
              <div className="flex items-start gap-3 p-4">
                <button
                  onClick={() => toggleOpen(route)}
                  className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-700 cursor-pointer"
                  aria-label={truck?.plateNumber ?? route.truckId}
                >
                  {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
                <span className="mt-0.5 w-1.5 h-9 rounded-full shrink-0" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800">{truck?.plateNumber ?? route.truckId}</span>
                    <Badge tone={STATUS_TONE[status]}>{t(`planner.statuses.${status}`)}</Badge>
                    <Badge tone="blue">{t('planner.round')} {route.round}</Badge>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 truncate">
                    {driver && (
                      <span className="inline-flex items-center gap-1">
                        <UserRound size={12} />
                        {i18n.language === 'th' ? driver.nameTh || driver.name : driver.name}
                      </span>
                    )}
                    {partner && <span className="text-slate-400">{driver ? ' · ' : ''}{partner.name}</span>}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  {next && (() => {
                    const Icon = next[2]
                    return (
                      <Button className="!px-3 !py-1.5 text-xs" onClick={() => updateRouteStatus(route.id, next[0])}>
                        <Icon size={14} /> {t(next[1])}
                      </Button>
                    )
                  })()}
                  {status !== 'planned' && (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1.5 text-xs"
                      title={t('planner.reopen')}
                      aria-label={t('planner.reopen')}
                      onClick={() => updateRouteStatus(route.id, 'planned')}
                    >
                      <RotateCcw size={14} />
                    </Button>
                  )}
                </div>
              </div>

              {/* Tier 2 — meta strip + progress */}
              <div className="flex items-center gap-x-5 gap-y-2 flex-wrap px-4 pl-16 text-xs">
                <label className="inline-flex items-center gap-1.5 text-slate-500">
                  <Clock size={13} /> {t('ops.startTime')}
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => patchRoute(route.id, { startTime: e.target.value })}
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs tabular-nums"
                  />
                </label>
                <span className="inline-flex items-center gap-1.5 text-slate-500">
                  <CheckCircle2 size={13} className="text-emerald-500" />
                  {t('ops.deliveries')}
                  <span className="font-semibold tabular-nums text-slate-800">{delivered}/{total}</span>
                </span>
                {rRec > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    {t('ops.onTimeRate')}
                    <span className="font-semibold tabular-nums text-slate-800">{Math.round((rOn / rRec) * 100)}%</span>
                  </span>
                )}
                <button
                  className="ml-auto inline-flex items-center gap-1 text-slate-500 hover:text-brand-600 cursor-pointer"
                  onClick={() =>
                    printRouteSheet({ route, truck, driver, partner, depotName: settings.depotName, locById })
                  }
                >
                  <Printer size={13} /> {t('ops.routeSheet')}
                </button>
              </div>
              <div className="px-4 pl-16 py-3">
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>

              {/* Tier 3 — stops (collapsible) */}
              {open && (
                <div className="border-t border-slate-100 divide-y divide-slate-100 bg-slate-50/40">
                  {route.stops.map((s) => {
                    const pod = podById.get(`${route.id}:${s.locationId}`)
                    const st = pod?.status ?? 'pending'
                    const delay = pod?.arrival ? podDelayMinutes(route, s.etaMinutes, pod.arrival) : null
                    const seqCls =
                      st === 'delivered' ? 'bg-emerald-500 text-white'
                      : st === 'failed' ? 'bg-rose-500 text-white'
                      : 'bg-white border border-slate-300 text-slate-500'
                    return (
                      <div key={s.locationId} className="flex items-center gap-3 py-2.5 px-4 pl-16 text-sm">
                        <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ${seqCls}`}>
                          {st === 'delivered' ? <CheckCircle2 size={13} /> : s.sequence}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-700 truncate">{locName(s.locationId)}</div>
                          <div className="text-xs text-slate-400 tabular-nums">
                            {t('pod.plannedEta')} {clock(start, s.etaMinutes)}
                            {pod?.arrival && ` · ${t('ops.arrived')} ${pod.arrival}`}
                          </div>
                        </div>
                        {delay != null && (
                          <Badge tone={delay > 5 ? 'red' : delay < -5 ? 'blue' : 'green'}>
                            {delay > 5
                              ? t('ops.late', { n: delay })
                              : delay < -5
                                ? t('ops.early', { n: -delay })
                                : t('ops.onTime')}
                          </Badge>
                        )}
                        {st === 'failed' && <Badge tone="red">{t('pod.statuses.failed')}</Badge>}
                        {pod?.photoDataUrl && <Camera size={14} className="text-slate-400" />}
                        <Button
                          variant={st === 'pending' ? 'secondary' : 'ghost'}
                          className="!px-2.5 !py-1 text-xs"
                          onClick={() => setPodEdit({ route, locationId: s.locationId })}
                        >
                          {st === 'pending' ? t('ops.recordPod') : t('common.edit')}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })}
      </div>

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
            setPodEdit(null)
          }}
        />
      )}
    </div>
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
