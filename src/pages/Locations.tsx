import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, FileUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { effectiveMapboxToken, newId, useTms } from '../store'
import CoordPicker from '../components/CoordPicker'
import { validateCoords } from '../lib/geo'
import { exportCsv, parseCsv, readFileText } from '../lib/csv'
import { can } from '../lib/permissions'
import {
  Badge, Button, Card, EmptyRow, Field, Modal, PageHeader, Stat, Table, inputClass,
} from '../components/ui'
import type { DeliveryLocation, LocationKind } from '../types'

const IMPORT_KINDS = new Set<LocationKind>(['supplier', 'plant', 'warehouse', 'customer'])

const KINDS: LocationKind[] = ['supplier', 'plant', 'warehouse', 'customer']

const emptyForm = {
  code: '', name: '', nameTh: '', kind: 'supplier' as LocationKind, zone: '',
  lat: '', lng: '', demandM3: '0', demandKg: '0', serviceMinutes: '15',
  windowStart: '', windowEnd: '', deliveryDays: [] as number[], active: true,
  deliveryPlantId: '', roundsPerDay: '1', pinnedTruckId: '',
}

export default function Locations() {
  const { t, i18n } = useTranslation()
  const { locations, trucks, settings, upsertLocation, deleteLocation, logAudit } = useTms()
  const mapToken = effectiveMapboxToken(settings)
  const canEdit = can(settings.role, 'master')
  const fileRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [editing, setEditing] = useState<DeliveryLocation | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const zones = useMemo(
    () => [...new Set(locations.map((l) => l.zone).filter(Boolean))].sort(),
    [locations],
  )

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return locations.filter(
      (l) =>
        (zoneFilter === '' || l.zone === zoneFilter) &&
        (l.code.toLowerCase().includes(q) ||
          l.name.toLowerCase().includes(q) ||
          l.nameTh.includes(query)),
    )
  }, [locations, query, zoneFilter])

  const coordCheck = validateCoords(form.lat, form.lng)
  const coordWarning =
    form.lat && form.lng && coordCheck.ok && coordCheck.warning ? t('locations.outsideTh') : undefined

  const open = (loc: DeliveryLocation | 'new') => {
    setErrors({})
    setForm(
      loc === 'new'
        ? emptyForm
        : {
            code: loc.code, name: loc.name, nameTh: loc.nameTh, kind: loc.kind, zone: loc.zone,
            lat: String(loc.lat), lng: String(loc.lng),
            demandM3: String(loc.demandM3), demandKg: String(loc.demandKg),
            serviceMinutes: String(loc.serviceMinutes),
            windowStart: loc.windowStart, windowEnd: loc.windowEnd,
            deliveryDays: loc.deliveryDays ?? [], active: loc.active,
            deliveryPlantId: loc.deliveryPlantId ?? '', roundsPerDay: String(loc.roundsPerDay ?? 1),
            pinnedTruckId: loc.pinnedTruckId ?? '',
          },
    )
    setEditing(loc)
  }

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!form.code.trim()) errs.code = t('common.required')
    if (!form.name.trim()) errs.name = t('common.required')
    const check = validateCoords(form.lat, form.lng)
    if (!check.ok) {
      const msg =
        check.error === 'lat-range'
          ? t('locations.latRange')
          : check.error === 'lng-range'
            ? t('locations.lngRange')
            : t('locations.notNumber')
      errs.coords = msg
    }
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    upsertLocation({
      id: editing === 'new' || !editing ? newId() : editing.id,
      code: form.code.trim(),
      name: form.name.trim(),
      nameTh: form.nameTh.trim(),
      kind: form.kind,
      zone: form.zone.trim(),
      lat: Number(form.lat),
      lng: Number(form.lng),
      demandM3: Math.max(0, Number(form.demandM3) || 0),
      demandKg: Math.max(0, Number(form.demandKg) || 0),
      serviceMinutes: Math.max(0, Number(form.serviceMinutes) || 0),
      windowStart: form.windowStart,
      windowEnd: form.windowEnd,
      deliveryDays: [...form.deliveryDays].sort((a, b) => a - b),
      active: form.active,
      deliveryPlantId: form.kind === 'plant' ? undefined : form.deliveryPlantId || undefined,
      roundsPerDay: Math.max(1, Number(form.roundsPerDay) || 1),
      pinnedTruckId: form.kind === 'plant' ? undefined : form.pinnedTruckId || undefined,
    })
    setEditing(null)
  }

  const exportRows = () =>
    exportCsv(
      `tms-locations-${new Date().toISOString().slice(0, 10)}`,
      ['Code', 'Name', 'NameTH', 'Kind', 'Zone', 'Lat', 'Lng', 'DemandM3', 'DemandKg', 'ServiceMin', 'WindowStart', 'WindowEnd', 'DeliveryDays', 'Active'],
      filtered.map((l) => [
        l.code, l.name, l.nameTh, l.kind, l.zone, l.lat, l.lng,
        l.demandM3, l.demandKg, l.serviceMinutes, l.windowStart, l.windowEnd,
        (l.deliveryDays ?? []).join(' '), l.active,
      ]),
    )

  /** Import locations from a CSV whose columns match the export. Rows with a
   *  matching Code update the existing record; others are created. */
  const importCsvFile = async (file: File) => {
    try {
      const rows = parseCsv(await readFileText(file))
      const byCode = new Map(locations.map((l) => [l.code, l]))
      let n = 0
      for (const r of rows) {
        const code = (r.Code || r.code || '').trim()
        if (!code) continue
        const check = validateCoords(r.Lat ?? r.lat, r.Lng ?? r.lng)
        if (!check.ok) continue
        const kind = (r.Kind || r.kind || 'supplier').toLowerCase() as LocationKind
        const existing = byCode.get(code)
        upsertLocation({
          id: existing?.id ?? newId(),
          code,
          name: r.Name || r.name || code,
          nameTh: r.NameTH || r.nameTh || '',
          kind: IMPORT_KINDS.has(kind) ? kind : 'supplier',
          zone: r.Zone || r.zone || '',
          lat: Number(r.Lat ?? r.lat),
          lng: Number(r.Lng ?? r.lng),
          demandM3: Math.max(0, Number(r.DemandM3 ?? r.demandM3) || 0),
          demandKg: Math.max(0, Number(r.DemandKg ?? r.demandKg) || 0),
          serviceMinutes: Math.max(0, Number(r.ServiceMin ?? r.serviceMinutes) || 15),
          windowStart: r.WindowStart || '',
          windowEnd: r.WindowEnd || '',
          deliveryDays: (r.DeliveryDays || '')
            .split(/[\s,]+/)
            .map(Number)
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
          active: String(r.Active ?? 'true').toLowerCase() !== 'false',
        })
        n++
      }
      logAudit('import', 'location', `${n} location(s) from CSV`)
      setToast(n > 0 ? t('common.imported', { n }) : t('common.importFailed'))
    } catch {
      setToast(t('common.importFailed'))
    }
    setTimeout(() => setToast(null), 4000)
    if (fileRef.current) fileRef.current.value = ''
  }

  const kindTone = { supplier: 'blue', plant: 'slate', warehouse: 'amber', customer: 'green' } as const

  return (
    <div>
      <PageHeader
        title={t('locations.title')}
        actions={
          <>
            {filtered.length > 0 && (
              <Button variant="secondary" onClick={exportRows}>
                <FileDown size={16} /> {t('common.exportCsv')}
              </Button>
            )}
            {canEdit && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && importCsvFile(e.target.files[0])}
                />
                <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                  <FileUp size={16} /> {t('common.importCsv')}
                </Button>
                <Button onClick={() => open('new')}>
                  <Plus size={16} /> {t('common.add')}
                </Button>
              </>
            )}
          </>
        }
      />

      {toast && (
        <Card className="p-3 mb-4 text-sm text-brand-700 bg-brand-50 border-brand-100">{toast}</Card>
      )}

      {(() => {
        const active = locations.filter((l) => l.active)
        const plants = active.filter((l) => l.kind === 'plant')
        const sup = active.filter((l) => l.kind !== 'plant' && (l.demandM3 > 0 || l.demandKg > 0))
        const dM3 = sup.reduce((s, l) => s + l.demandM3 * Math.max(1, l.roundsPerDay ?? 1), 0)
        const dKg = sup.reduce((s, l) => s + l.demandKg * Math.max(1, l.roundsPerDay ?? 1), 0)
        const pinned = active.filter((l) => l.pinnedTruckId).length
        const linked = sup.filter((l) => l.deliveryPlantId).length
        const nf = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
        return locations.length === 0 ? null : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
            <Stat primary label={t('locations.title')} value={String(active.length)} sub={`${zones.length} ${t('locations.zone').toLowerCase()}`} />
            <Stat label={t('dashboard.plants')} value={String(plants.length)} tone="brand" />
            <Stat label={t('dashboard.suppliers')} value={String(sup.length)} sub={`${linked}/${sup.length} ${t('locations.deliveryPlant').toLowerCase()}`} />
            <Stat label={`${t('locations.demandKg')}`} value={nf(dKg)} />
            <Stat label={`${t('locations.demandM3')}`} value={nf(dM3)} />
            <Stat label={t('locations.pinnedTruck')} value={String(pinned)} tone={pinned > 0 ? 'amber' : undefined} />
          </div>
        )
      })()}

      <Card>
        <div className="p-4 border-b border-slate-100 flex flex-wrap gap-2">
          <input
            className={`${inputClass} max-w-xs`}
            placeholder={t('common.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className={`${inputClass} max-w-[12rem]`}
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
          >
            <option value="">{t('locations.allZones')}</option>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <Table
          headers={[
            t('locations.code'), t('locations.name'), t('locations.kind'), t('locations.zone'),
            t('locations.coords'), t('locations.demandM3'), t('locations.demandKg'),
            t('locations.window'), t('common.status'), t('common.actions'),
          ]}
        >
          {filtered.length === 0 && <EmptyRow colSpan={10} message={t('common.noData')} />}
          {filtered.map((l) => (
            <tr key={l.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{l.code}</td>
              <td className="px-4 py-3">
                <div className="text-slate-800">{i18n.language === 'th' ? l.nameTh || l.name : l.name}</div>
                <div className="text-xs text-slate-400">{i18n.language === 'th' ? l.name : l.nameTh}</div>
              </td>
              <td className="px-4 py-3">
                <Badge tone={kindTone[l.kind]}>{t(`locations.kinds.${l.kind}`)}</Badge>
              </td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{l.zone || '—'}</td>
              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                {l.lat.toFixed(4)}, {l.lng.toFixed(4)}
              </td>
              <td className="px-4 py-3">{l.demandM3}</td>
              <td className="px-4 py-3">{l.demandKg.toLocaleString()}</td>
              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                {l.windowStart && l.windowEnd ? `${l.windowStart}–${l.windowEnd}` : '—'}
              </td>
              <td className="px-4 py-3">
                <Badge tone={l.active ? 'green' : 'red'}>
                  {l.active ? t('common.active') : t('common.inactive')}
                </Badge>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {canEdit ? (
                  <>
                    <Button variant="ghost" onClick={() => open(l)} aria-label={t('common.edit')}>
                      <Pencil size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => confirm(t('common.confirmDelete')) && deleteLocation(l.id)}
                      aria-label={t('common.delete')}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-slate-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {editing && (
        <Modal
          title={`${editing === 'new' ? t('common.add') : t('common.edit')} — ${t('locations.title')}`}
          onClose={() => setEditing(null)}
          wide
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('locations.code')} error={errors.code}>
              <input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label={t('locations.kind')}>
              <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as LocationKind })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>{t(`locations.kinds.${k}`)}</option>
                ))}
              </select>
            </Field>
            <Field label={t('locations.name')} error={errors.name}>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('locations.nameTh')}>
              <input className={inputClass} value={form.nameTh} onChange={(e) => setForm({ ...form, nameTh: e.target.value })} />
            </Field>
            <Field label={t('locations.lat')} error={errors.coords} hint={coordWarning ?? t('locations.pickOnMap')}>
              <input className={inputClass} inputMode="decimal" placeholder="13.1544" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
            </Field>
            <Field label={t('locations.lng')} error={errors.coords ? ' ' : undefined} hint={coordWarning ? ' ' : undefined}>
              <input className={inputClass} inputMode="decimal" placeholder="100.9319" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
            </Field>
            {mapToken && (
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500 mb-1">{t('locations.clickMapHint')}</p>
                <CoordPicker
                  token={mapToken}
                  lat={Number.isFinite(Number(form.lat)) && form.lat !== '' ? Number(form.lat) : null}
                  lng={Number.isFinite(Number(form.lng)) && form.lng !== '' ? Number(form.lng) : null}
                  onPick={({ lat, lng }) => setForm({ ...form, lat: String(lat), lng: String(lng) })}
                />
              </div>
            )}
            <Field label={t('locations.demandM3')}>
              <input className={inputClass} type="number" min="0" step="0.1" value={form.demandM3} onChange={(e) => setForm({ ...form, demandM3: e.target.value })} />
            </Field>
            <Field label={t('locations.demandKg')}>
              <input className={inputClass} type="number" min="0" step="1" value={form.demandKg} onChange={(e) => setForm({ ...form, demandKg: e.target.value })} />
            </Field>
            <Field label={t('locations.serviceMinutes')}>
              <input className={inputClass} type="number" min="0" step="5" value={form.serviceMinutes} onChange={(e) => setForm({ ...form, serviceMinutes: e.target.value })} />
            </Field>
            <Field label={t('locations.zone')}>
              <input className={inputClass} list="zone-list" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} />
              <datalist id="zone-list">
                {zones.map((z) => <option key={z} value={z} />)}
              </datalist>
            </Field>
            {form.kind !== 'plant' && (
              <Field label={t('locations.deliveryPlant')} hint={t('locations.deliveryPlantHint')}>
                <select
                  className={inputClass}
                  value={form.deliveryPlantId}
                  onChange={(e) => setForm({ ...form, deliveryPlantId: e.target.value })}
                >
                  <option value="">{t('locations.useGlobalDepot')}</option>
                  {locations.filter((l) => l.kind === 'plant').map((p) => (
                    <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                  ))}
                </select>
              </Field>
            )}
            {form.kind !== 'plant' && (
              <Field label={t('locations.roundsPerDay')} hint={t('locations.roundsPerDayHint')}>
                <input className={inputClass} type="number" min="1" step="1" value={form.roundsPerDay} onChange={(e) => setForm({ ...form, roundsPerDay: e.target.value })} />
              </Field>
            )}
            {form.kind !== 'plant' && (
              <Field label={t('locations.pinnedTruck')} hint={t('locations.pinnedTruckHint')}>
                <select className={inputClass} value={form.pinnedTruckId} onChange={(e) => setForm({ ...form, pinnedTruckId: e.target.value })}>
                  <option value="">{t('locations.pinnedTruckNone')}</option>
                  {trucks.map((tr) => (
                    <option key={tr.id} value={tr.id}>{tr.plateNumber}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={t('locations.windowStart')}>
              <input className={inputClass} type="time" value={form.windowStart} onChange={(e) => setForm({ ...form, windowStart: e.target.value })} />
            </Field>
            <Field label={t('locations.windowEnd')}>
              <input className={inputClass} type="time" value={form.windowEnd} onChange={(e) => setForm({ ...form, windowEnd: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              {t('common.active')}
            </label>
          </div>

          <div className="mt-4">
            <span className="block text-sm font-medium text-slate-700 mb-1">
              {t('locations.deliveryDays')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                const on = form.deliveryDays.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        deliveryDays: on
                          ? form.deliveryDays.filter((x) => x !== d)
                          : [...form.deliveryDays, d],
                      })
                    }
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                      on ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {t(`week.days.${d}`)}
                  </button>
                )
              })}
            </div>
            <span className="block text-xs text-slate-500 mt-1">
              {form.deliveryDays.length === 0 ? t('week.everyDay') : ''}
            </span>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <Button variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button onClick={submit}>{t('common.save')}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
