import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, CheckCircle2, Clock, Info, Printer, Truck as TruckIcon, UserRound } from 'lucide-react'
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
const POD_TONE: Record<PodStatus, 'slate' | 'green' | 'red'> = {
  pending: 'slate', delivered: 'green', failed: 'red',
}

export default function Operations() {
  const { t, i18n } = useTranslation()
  const { plan, trucks, partners, drivers, locations, pods, settings, patchRoute, upsertPod } = useTms()

  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const truckById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks])
  const partnerById = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners])
  const driverByTruck = useMemo(
    () => new Map(drivers.filter((d) => d.truckId).map((d) => [d.truckId as string, d])),
    [drivers],
  )
  const podById = useMemo(() => new Map(pods.map((p) => [p.id, p])), [pods])

  const [podEdit, setPodEdit] = useState<{ route: PlannedRoute; locationId: string } | null>(null)

  const routes = plan?.routes ?? []
  const locName = (id: string) => {
    const l = locById.get(id)
    return l ? (i18n.language === 'th' ? l.nameTh || l.name : l.name) : id
  }
  const clock = (start: string, add: number) => {
    const [h, m] = (start || '08:00').split(':').map(Number)
    const total = h * 60 + m + add
    return `${String(Math.floor((total % 1440) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  if (routes.length === 0) {
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

          return (
            <Card key={route.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                <TruckIcon size={16} className="text-slate-400" />
                <span className="font-semibold text-slate-800">{truck?.plateNumber ?? route.truckId}</span>
                <Badge tone="blue">{t('planner.round')} {route.round}</Badge>
                <Badge tone={STATUS_TONE[route.status ?? 'planned']}>
                  {t(`planner.statuses.${route.status ?? 'planned'}`)}
                </Badge>
                {driver && (
                  <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                    <UserRound size={12} />
                    {i18n.language === 'th' ? driver.nameTh || driver.name : driver.name}
                  </span>
                )}
                {partner && <span className="text-xs text-slate-400">· {partner.name}</span>}

                <div className="ml-auto flex items-center gap-3">
                  <label className="text-xs text-slate-500 inline-flex items-center gap-1">
                    <Clock size={13} /> {t('ops.startTime')}
                    <input
                      type="time"
                      value={start}
                      onChange={(e) => patchRoute(route.id, { startTime: e.target.value })}
                      className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
                    />
                  </label>
                  <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                    <CheckCircle2 size={13} className="text-emerald-500" />
                    {t('ops.progress')} {delivered}/{route.stops.length}
                  </span>
                  <Button
                    variant="secondary"
                    className="!px-2.5 !py-1 text-xs"
                    onClick={() =>
                      printRouteSheet({ route, truck, driver, partner, depotName: settings.depotName, locById })
                    }
                  >
                    <Printer size={14} /> {t('ops.routeSheet')}
                  </Button>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-3">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.round((delivered / route.stops.length) * 100)}%` }}
                />
              </div>

              <div className="divide-y divide-slate-100">
                {route.stops.map((s) => {
                  const pod = podById.get(`${route.id}:${s.locationId}`)
                  const delay = pod?.arrival ? podDelayMinutes(route, s.etaMinutes, pod.arrival) : null
                  return (
                    <div key={s.locationId} className="flex items-center gap-3 py-2 text-sm">
                      <span className="w-6 h-6 shrink-0 rounded-full bg-slate-800 text-white flex items-center justify-center text-[11px] font-semibold">
                        {s.sequence}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-700 truncate">{locName(s.locationId)}</div>
                        <div className="text-xs text-slate-400">
                          {t('pod.plannedEta')} {clock(start, s.etaMinutes)}
                          {pod?.arrival && ` · ${pod.arrival}`}
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
                      <Badge tone={POD_TONE[pod?.status ?? 'pending']}>
                        {t(`pod.statuses.${pod?.status ?? 'pending'}`)}
                      </Badge>
                      {pod?.photoDataUrl && <Camera size={14} className="text-slate-400" />}
                      <Button
                        variant="secondary"
                        className="!px-2.5 !py-1 text-xs"
                        onClick={() => setPodEdit({ route, locationId: s.locationId })}
                      >
                        {t('ops.recordPod')}
                      </Button>
                    </div>
                  )
                })}
              </div>
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
