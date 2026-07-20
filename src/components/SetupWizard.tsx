import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Building2, Check, Factory, Handshake, MapPin, Package, Rocket, Truck as TruckIcon, X,
} from 'lucide-react'
import { newId, useTms, withLocationDefaults, withPartnerDefaults } from '../store'
import { validateCoords } from '../lib/geo'
import { Button, Field, inputClass } from './ui'
import type { TruckType } from '../types'

const TRUCK_TYPES: TruckType[] = ['4W', '4WJ', '6W', '10W', 'Trailer']

/**
 * Guided first-run setup — walks a fresh workspace through the master data
 * needed to run Auto Route, in dependency order (depot → transporter → trucks
 * → plants → suppliers). Each step writes real records; "Next" gates on the
 * step's minimum so nothing downstream is left dangling.
 */
export default function SetupWizard({ onNavigate, onClose }: {
  onNavigate?: (page: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { settings, partners, trucks, locations, updateSettings, upsertPartner, upsertTruck, upsertLocation } = useTms()
  const plants = locations.filter((l) => l.kind === 'plant')
  const suppliers = locations.filter((l) => l.kind !== 'plant')

  const [step, setStep] = useState(0)

  // ---- per-step local forms ----
  const [depot, setDepot] = useState({
    companyName: settings.companyName ?? '', depotName: settings.depotName ?? '',
    lat: String(settings.depotLat ?? ''), lng: String(settings.depotLng ?? ''),
    token: settings.mapboxToken ?? '',
  })
  const [pForm, setPForm] = useState({ code: '', name: '' })
  const [tForm, setTForm] = useState({ plate: '', type: '6W' as TruckType, m3: '22', kg: '5500', costKm: '12', partnerId: '' })
  const [plForm, setPlForm] = useState({ code: '', name: '', lat: '', lng: '' })
  const [sForm, setSForm] = useState({ code: '', name: '', lat: '', lng: '', m3: '2', kg: '500', plantId: '', ws: '08:00', we: '17:00' })

  const depotCoord = validateCoords(depot.lat, depot.lng)
  const depotDone = !!depot.depotName.trim() && depotCoord.ok
  const num = (s: string, d = 0) => { const n = Number(s); return Number.isFinite(n) ? n : d }

  const saveDepot = () => {
    if (!depotDone) return
    updateSettings({
      companyName: depot.companyName.trim(), depotName: depot.depotName.trim(),
      depotLat: num(depot.lat), depotLng: num(depot.lng), mapboxToken: depot.token.trim(),
    })
    setStep(1)
  }
  const addPartner = () => {
    if (!pForm.name.trim()) return
    upsertPartner(withPartnerDefaults({
      id: newId(), code: pForm.code.trim() || pForm.name.trim().slice(0, 4).toUpperCase(),
      name: pForm.name.trim(), contactPerson: '', phone: '', email: '', active: true,
    }))
    setPForm({ code: '', name: '' })
  }
  const addTruck = () => {
    if (!tForm.plate.trim() || !tForm.partnerId) return
    upsertTruck({
      id: newId(), plateNumber: tForm.plate.trim(), type: tForm.type, partnerId: tForm.partnerId,
      capacityM3: num(tForm.m3, 22), capacityKg: num(tForm.kg, 5500), roundsPerDay: 1,
      fixedCostPerRound: 0, costPerKm: num(tForm.costKm, 12), active: true, assignmentMode: 'dynamic',
    })
    setTForm({ ...tForm, plate: '' })
  }
  const addPlant = () => {
    const cc = validateCoords(plForm.lat, plForm.lng)
    if (!plForm.name.trim() || !cc.ok) return
    upsertLocation(withLocationDefaults({
      id: newId(), code: plForm.code.trim() || plForm.name.trim().slice(0, 4).toUpperCase(),
      name: plForm.name.trim(), nameTh: plForm.name.trim(), kind: 'plant',
      lat: num(plForm.lat), lng: num(plForm.lng), demandM3: 0, demandKg: 0, serviceMinutes: 0, active: true,
    }))
    setPlForm({ code: '', name: '', lat: '', lng: '' })
  }
  const addSupplier = () => {
    const cc = validateCoords(sForm.lat, sForm.lng)
    if (!sForm.name.trim() || !cc.ok) return
    upsertLocation(withLocationDefaults({
      id: newId(), code: sForm.code.trim() || sForm.name.trim().slice(0, 4).toUpperCase(),
      name: sForm.name.trim(), nameTh: sForm.name.trim(), kind: 'supplier',
      lat: num(sForm.lat), lng: num(sForm.lng), demandM3: num(sForm.m3, 1), demandKg: num(sForm.kg, 100),
      serviceMinutes: 30, active: true, deliveryPlantId: sForm.plantId || undefined,
      windowStart: sForm.ws, windowEnd: sForm.we, roundsPerDay: 1,
    }))
    setSForm({ ...sForm, code: '', name: '', lat: '', lng: '' })
  }

  const steps = [
    { key: 'depot', icon: <Building2 size={16} />, done: depotDone },
    { key: 'partner', icon: <Handshake size={16} />, done: partners.length > 0 },
    { key: 'truck', icon: <TruckIcon size={16} />, done: trucks.length > 0 },
    { key: 'plant', icon: <Factory size={16} />, done: plants.length > 0 },
    { key: 'supplier', icon: <MapPin size={16} />, done: suppliers.length > 0 },
    { key: 'done', icon: <Rocket size={16} />, done: false },
  ]
  const canPlan = partners.length > 0 && trucks.length > 0 && plants.length > 0 && suppliers.length > 0

  const Chip = ({ children }: { children: React.ReactNode }) => (
    <span className="inline-flex items-center gap-1 text-xs bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 text-slate-600">{children}</span>
  )
  const num2 = (label: string, val: string, on: (v: string) => void, ph?: string) => (
    <Field label={label}><input className={inputClass} inputMode="decimal" value={val} placeholder={ph} onChange={(e) => on(e.target.value)} /></Field>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex overflow-hidden">
        {/* Stepper rail */}
        <aside className="hidden sm:flex flex-col gap-1 w-52 shrink-0 bg-slate-50 border-r border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3 px-1">
            <Rocket size={18} className="text-brand-500" />
            <span className="font-semibold text-slate-800">{t('wizard.title')}</span>
          </div>
          {steps.map((s, i) => (
            <button key={s.key} onClick={() => setStep(i)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition cursor-pointer ${
                step === i ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:bg-white/60'}`}>
              <span className={`flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${
                s.done ? 'bg-emerald-500 text-white' : step === i ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                {s.done ? <Check size={14} /> : i + 1}
              </span>
              {t(`wizard.steps.${s.key}`)}
            </button>
          ))}
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-6 pt-5 pb-2">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                {steps[step].icon} {t(`wizard.steps.${steps[step].key}`)}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">{t(`wizard.desc.${steps[step].key}`)}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer shrink-0" aria-label={t('common.cancel')}><X size={18} /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-3 space-y-4">
            {/* 0 — Depot & company */}
            {step === 0 && (
              <div className="space-y-4">
                <Field label={t('settings.companyName')}><input className={inputClass} value={depot.companyName} onChange={(e) => setDepot({ ...depot, companyName: e.target.value })} /></Field>
                <Field label={t('settings.depotName')} error={!depot.depotName.trim() ? t('common.required') : undefined}>
                  <input className={inputClass} value={depot.depotName} onChange={(e) => setDepot({ ...depot, depotName: e.target.value })} placeholder="Yusen Transport Yard (Bowin)" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  {num2(t('locations.lat'), depot.lat, (v) => setDepot({ ...depot, lat: v }), '13.0102')}
                  {num2(t('locations.lng'), depot.lng, (v) => setDepot({ ...depot, lng: v }), '101.0676')}
                </div>
                {!depotCoord.ok && (depot.lat || depot.lng) ? <p className="text-xs text-rose-600">{t('locations.notNumber')}</p> : null}
                <Field label={t('settings.mapboxToken')} hint={t('settings.mapboxHint')}>
                  <input className={inputClass} type="password" placeholder="pk.…" value={depot.token} onChange={(e) => setDepot({ ...depot, token: e.target.value })} />
                </Field>
              </div>
            )}

            {/* 1 — Transporter */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-end">
                  <Field label={t('partners.code')}><input className={inputClass} value={pForm.code} onChange={(e) => setPForm({ ...pForm, code: e.target.value })} placeholder="YUSE" /></Field>
                  <Field label={t('partners.name')}><input className={inputClass} value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} placeholder="Yusen Logistics" onKeyDown={(e) => e.key === 'Enter' && addPartner()} /></Field>
                  <Button onClick={addPartner} disabled={!pForm.name.trim()}>{t('common.add')}</Button>
                </div>
                {partners.length > 0 && <div className="flex flex-wrap gap-1.5">{partners.map((p) => <Chip key={p.id}><Handshake size={11} /> {p.name}</Chip>)}</div>}
              </div>
            )}

            {/* 2 — Trucks */}
            {step === 2 && (
              <div className="space-y-4">
                {partners.length === 0
                  ? <p className="text-sm text-amber-600">{t('wizard.needPartner')}</p>
                  : <>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label={t('trucks.plate')}><input className={inputClass} value={tForm.plate} onChange={(e) => setTForm({ ...tForm, plate: e.target.value })} placeholder="70-1001" /></Field>
                        <Field label={t('trucks.type')}><select className={inputClass} value={tForm.type} onChange={(e) => setTForm({ ...tForm, type: e.target.value as TruckType })}>{TRUCK_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
                        <Field label={t('costs.partner')}><select className={inputClass} value={tForm.partnerId} onChange={(e) => setTForm({ ...tForm, partnerId: e.target.value })}><option value="">—</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                        <Field label={`${t('common.baht')}/${t('common.km')}`}><input className={inputClass} inputMode="decimal" value={tForm.costKm} onChange={(e) => setTForm({ ...tForm, costKm: e.target.value })} /></Field>
                        {num2(`${t('trucks.capacity')} ${t('common.m3')}`, tForm.m3, (v) => setTForm({ ...tForm, m3: v }))}
                        {num2(`${t('trucks.capacity')} ${t('common.kg')}`, tForm.kg, (v) => setTForm({ ...tForm, kg: v }))}
                      </div>
                      <Button onClick={addTruck} disabled={!tForm.plate.trim() || !tForm.partnerId}>{t('common.add')}</Button>
                      {trucks.length > 0 && <div className="flex flex-wrap gap-1.5">{trucks.map((tr) => <Chip key={tr.id}><TruckIcon size={11} /> {tr.plateNumber} · {tr.type}</Chip>)}</div>}
                    </>}
              </div>
            )}

            {/* 3 — Plants */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('locations.code')}><input className={inputClass} value={plForm.code} onChange={(e) => setPlForm({ ...plForm, code: e.target.value })} placeholder="ATFB" /></Field>
                  <Field label={t('locations.name')}><input className={inputClass} value={plForm.name} onChange={(e) => setPlForm({ ...plForm, name: e.target.value })} placeholder="Aisin Plant ATFB" /></Field>
                  {num2(t('locations.lat'), plForm.lat, (v) => setPlForm({ ...plForm, lat: v }))}
                  {num2(t('locations.lng'), plForm.lng, (v) => setPlForm({ ...plForm, lng: v }))}
                </div>
                <Button onClick={addPlant} disabled={!plForm.name.trim() || !validateCoords(plForm.lat, plForm.lng).ok}>{t('common.add')}</Button>
                {plants.length > 0 && <div className="flex flex-wrap gap-1.5">{plants.map((p) => <Chip key={p.id}><Factory size={11} /> {p.code}</Chip>)}</div>}
              </div>
            )}

            {/* 4 — Suppliers */}
            {step === 4 && (
              <div className="space-y-4">
                {plants.length === 0
                  ? <p className="text-sm text-amber-600">{t('wizard.needPlant')}</p>
                  : <>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label={t('locations.code')}><input className={inputClass} value={sForm.code} onChange={(e) => setSForm({ ...sForm, code: e.target.value })} placeholder="TTTC" /></Field>
                        <Field label={t('locations.name')}><input className={inputClass} value={sForm.name} onChange={(e) => setSForm({ ...sForm, name: e.target.value })} /></Field>
                        {num2(t('locations.lat'), sForm.lat, (v) => setSForm({ ...sForm, lat: v }))}
                        {num2(t('locations.lng'), sForm.lng, (v) => setSForm({ ...sForm, lng: v }))}
                        {num2(t('locations.demandM3'), sForm.m3, (v) => setSForm({ ...sForm, m3: v }))}
                        {num2(t('locations.demandKg'), sForm.kg, (v) => setSForm({ ...sForm, kg: v }))}
                        <Field label={t('wizard.deliveryPlant')}><select className={inputClass} value={sForm.plantId} onChange={(e) => setSForm({ ...sForm, plantId: e.target.value })}><option value="">—</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label={t('locations.windowStart')}><input className={inputClass} type="time" value={sForm.ws} onChange={(e) => setSForm({ ...sForm, ws: e.target.value })} /></Field>
                          <Field label={t('locations.windowEnd')}><input className={inputClass} type="time" value={sForm.we} onChange={(e) => setSForm({ ...sForm, we: e.target.value })} /></Field>
                        </div>
                      </div>
                      <Button onClick={addSupplier} disabled={!sForm.name.trim() || !validateCoords(sForm.lat, sForm.lng).ok}>{t('common.add')}</Button>
                      {suppliers.length > 0 && <div className="flex flex-wrap gap-1.5">{suppliers.map((sp) => <Chip key={sp.id}><MapPin size={11} /> {sp.code}</Chip>)}</div>}
                    </>}
              </div>
            )}

            {/* 5 — Done */}
            {step === 5 && (
              <div className="space-y-4 text-center py-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600"><Rocket size={28} /></div>
                <h3 className="text-lg font-semibold text-slate-900">{t('wizard.readyTitle')}</h3>
                <div className="flex justify-center gap-2 flex-wrap text-sm">
                  <Chip><Handshake size={12} /> {partners.length} {t('nav.partners').toLowerCase()}</Chip>
                  <Chip><TruckIcon size={12} /> {trucks.length} {t('nav.trucks').toLowerCase()}</Chip>
                  <Chip><Factory size={12} /> {plants.length} {t('dashboard.plants').toLowerCase()}</Chip>
                  <Chip><MapPin size={12} /> {suppliers.length} {t('dashboard.suppliers').toLowerCase()}</Chip>
                </div>
                {!canPlan && <p className="text-xs text-amber-600">{t('wizard.incomplete')}</p>}
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button variant="secondary" onClick={onClose}>{t('wizard.later')}</Button>
                  <Button disabled={!canPlan} onClick={() => { onNavigate?.('planner'); onClose() }}>
                    <Package size={16} /> {t('wizard.goPlan')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Footer nav */}
          {step < 5 && (
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-100">
              <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer">{t('wizard.skip')}</button>
              <div className="flex items-center gap-2">
                {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>{t('common.back')}</Button>}
                <Button
                  onClick={() => (step === 0 ? saveDepot() : setStep(step + 1))}
                  disabled={!steps[step].done}
                >
                  {t('common.next')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
