import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Camera, CheckCircle2, Clock, Flag, LogOut, MapPin, Navigation, Package, Truck as TruckIcon,
} from 'lucide-react'
import { useTms } from '../store'
import { logout, type AuthUser } from '../lib/auth'
import { Badge, Button, Field, Modal, inputClass } from '../components/ui'
import { podDelayMinutes, type PlannedRoute, type PodRecord, type PodStatus } from '../types'

const POD_STATUSES: PodStatus[] = ['pending', 'delivered', 'failed']
const NEXT: Partial<Record<string, [PlannedRoute['status'], string, typeof Navigation]>> = {
  dispatched: ['in-transit', 'planner.startTrip', Navigation],
  'in-transit': ['completed', 'planner.complete', Flag],
}

/** Mobile field view for a logged-in driver: their trips + POD capture. */
export default function DriverView({ user }: { user: AuthUser }) {
  const { t, i18n } = useTranslation()
  const th = i18n.language === 'th'
  const { plan, locations, drivers, trucks, pods,
    updateRouteStatus, upsertPod, upsertIncident, deleteIncident, incidents, updateSettings } = useTms()

  const driver = drivers.find((d) => d.id === user.driverId)
  const truck = trucks.find((tr) => tr.id === driver?.truckId)
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const podById = useMemo(() => new Map(pods.map((p) => [p.id, p])), [pods])
  const locName = (id: string) => {
    const l = locById.get(id)
    return l ? (th ? l.nameTh || l.name : l.name) : id
  }
  const clock = (start: string, add: number) => {
    const [h, m] = (start || '08:00').split(':').map(Number)
    const total = h * 60 + m + add
    return `${String(Math.floor((total % 1440) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  // My trips = routes on my assigned truck (all rounds), stops first.
  const myRoutes = useMemo(
    () => (plan?.routes ?? [])
      .filter((r) => r.truckId === driver?.truckId && r.stops.length > 0)
      .sort((a, b) => a.round - b.round),
    [plan, driver?.truckId],
  )

  const [pod, setPod] = useState<{ route: PlannedRoute; locationId: string } | null>(null)

  const savePod = (p: PodRecord, route: PlannedRoute, locationId: string) => {
    upsertPod(p)
    const incId = `podfail:${route.id}:${locationId}`
    if (p.status === 'failed') {
      upsertIncident({
        id: incId, date: new Date().toISOString().slice(0, 10),
        type: 'other', severity: 'medium', truckId: route.truckId, routeId: route.id,
        description: t('ops.failedIncident', { loc: locName(locationId) }), resolved: false,
      })
    } else if (incidents.some((i) => i.id === incId)) {
      deleteIncident(incId)
    }
    setPod(null)
  }

  const driverName = driver ? (th ? driver.nameTh || driver.name : driver.name) : user.username

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 h-14 shrink-0 bg-slate-900 text-white">
        <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
          <TruckIcon size={17} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-tight truncate">{driverName}</p>
          <p className="text-[11px] text-slate-400 leading-tight truncate">
            {truck ? truck.plateNumber : t('driver.noTruck')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {(['en', 'th'] as const).map((lang) => (
            <button key={lang}
              onClick={() => { i18n.changeLanguage(lang); updateSettings({ language: lang }) }}
              className={`px-2 py-1 rounded-md text-xs font-medium ${i18n.language === lang ? 'bg-brand-500 text-white' : 'text-slate-400'}`}>
              {lang === 'en' ? 'EN' : 'ไทย'}
            </button>
          ))}
          <button onClick={async () => { await logout(); window.location.reload() }}
            className="ml-1 p-1.5 rounded-md text-slate-300 hover:bg-slate-800" aria-label={t('auth.logout')}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {!driver ? (
          <Empty icon={<TruckIcon size={26} />} text={t('driver.notLinked')} />
        ) : myRoutes.length === 0 ? (
          <Empty icon={<Package size={26} />} text={t('driver.noTrips')} />
        ) : (
          myRoutes.map((route) => {
            const start = route.startTime || '08:00'
            const total = route.stops.length
            const delivered = route.stops.filter((s) => podById.get(`${route.id}:${s.locationId}`)?.status === 'delivered').length
            const pct = total ? Math.round((delivered / total) * 100) : 0
            const status = route.status ?? 'planned'
            const next = NEXT[status]
            return (
              <div key={route.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-lg text-slate-900">{t('planner.round')} {route.round}</span>
                    <Badge tone={status === 'completed' ? 'green' : status === 'in-transit' ? 'amber' : status === 'dispatched' ? 'blue' : 'slate'}>
                      {t(`planner.statuses.${status}`)}
                    </Badge>
                    <span className="ml-auto inline-flex items-center gap-1 text-sm text-slate-500">
                      <Clock size={14} /> {start}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-slate-700">{delivered}/{total}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  {next && (
                    <Button className="w-full mt-3 !py-2.5 justify-center text-base"
                      onClick={() => updateRouteStatus(route.id, next[0]!)}>
                      {(() => { const Icon = next[2]; return <Icon size={18} /> })()} {t(next[1])}
                    </Button>
                  )}
                </div>

                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {route.stops.map((s) => {
                    const p = podById.get(`${route.id}:${s.locationId}`)
                    const st = p?.status ?? 'pending'
                    const delay = p?.arrival ? podDelayMinutes(route, s.etaMinutes, p.arrival) : null
                    const seqCls = st === 'delivered' ? 'bg-emerald-500 text-white'
                      : st === 'failed' ? 'bg-rose-500 text-white' : 'bg-white border border-slate-300 text-slate-500'
                    return (
                      <div key={s.locationId} className="flex items-center gap-3 p-3">
                        <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${seqCls}`}>
                          {st === 'delivered' ? <CheckCircle2 size={16} /> : s.sequence}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-800 truncate flex items-center gap-1">
                            <MapPin size={13} className="text-slate-400 shrink-0" /> {locName(s.locationId)}
                          </div>
                          <div className="text-xs text-slate-400 tabular-nums">
                            {t('pod.plannedEta')} {clock(start, s.etaMinutes)}
                            {p?.arrival && ` · ${t('ops.arrived')} ${p.arrival}`}
                            {delay != null && delay > 5 && ` · ${t('ops.late', { n: delay })}`}
                          </div>
                        </div>
                        <Button variant={st === 'pending' ? 'primary' : 'secondary'} className="!px-3 !py-1.5 text-xs shrink-0"
                          onClick={() => setPod({ route, locationId: s.locationId })}>
                          {st === 'pending' ? t('ops.recordPod') : t('common.edit')}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </main>

      {pod && (
        <PodSheet
          key={`${pod.route.id}:${pod.locationId}`}
          locationName={locName(pod.locationId)}
          existing={podById.get(`${pod.route.id}:${pod.locationId}`)}
          onClose={() => setPod(null)}
          onSave={(rec) => savePod(rec, pod.route, pod.locationId)}
          routeId={pod.route.id}
          locationId={pod.locationId}
        />
      )}
    </div>
  )
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-slate-400 text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center">{icon}</div>
      <p className="text-sm">{text}</p>
    </div>
  )
}

function PodSheet({ routeId, locationId, locationName, existing, onClose, onSave }: {
  routeId: string; locationId: string; locationName: string
  existing?: PodRecord; onClose: () => void; onSave: (p: PodRecord) => void
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
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700 cursor-pointer">
            <Camera size={16} /> {t('pod.photo')}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
          </label>
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
        <Button onClick={() => onSave({
          id: `${routeId}:${locationId}`, routeId, locationId, status, arrival,
          receivedBy: receivedBy.trim(), note: note.trim(), photoDataUrl: photo,
          recordedAt: new Date().toISOString(),
        })}>{t('common.save')}</Button>
      </div>
    </Modal>
  )
}
