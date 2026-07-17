import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Check, Fuel, History, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useTms } from '../store'
import { validateCoords } from '../lib/geo'
import { can, ROLES } from '../lib/permissions'
import { Badge, Button, Card, Field, PageHeader, Table, inputClass } from '../components/ui'
import type { Role } from '../types'

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { settings, trucks, audit, updateSettings, upsertTruck, resetToSeed, clearAll } = useTms()
  const isAdmin = can(settings.role, 'admin')
  const [form, setForm] = useState({
    mapboxToken: settings.mapboxToken,
    depotName: settings.depotName,
    depotLat: String(settings.depotLat),
    depotLng: String(settings.depotLng),
    avgSpeedKmh: String(settings.avgSpeedKmh),
    useRoadGeometry: settings.useRoadGeometry,
    dieselPricePerLiter: String(settings.dieselPricePerLiter),
    fuelConsumptionKmPerL: String(settings.fuelConsumptionKmPerL),
    co2KgPerLiter: String(settings.co2KgPerLiter),
    companyName: settings.companyName ?? '',
    companyTaxId: settings.companyTaxId ?? '',
    companyAddress: settings.companyAddress ?? '',
  })
  const [saved, setSaved] = useState(false)
  const [fuelMsg, setFuelMsg] = useState<string | null>(null)

  const coordCheck = validateCoords(form.depotLat, form.depotLng)

  const setLanguage = (lang: 'en' | 'th') => {
    i18n.changeLanguage(lang)
    updateSettings({ language: lang })
  }

  const save = () => {
    if (!coordCheck.ok) return
    updateSettings({
      mapboxToken: form.mapboxToken.trim(),
      depotName: form.depotName.trim(),
      depotLat: Number(form.depotLat),
      depotLng: Number(form.depotLng),
      avgSpeedKmh: Math.max(10, Number(form.avgSpeedKmh) || 45),
      useRoadGeometry: form.useRoadGeometry,
      dieselPricePerLiter: Math.max(0, Number(form.dieselPricePerLiter) || 0),
      fuelConsumptionKmPerL: Math.max(0.1, Number(form.fuelConsumptionKmPerL) || 4),
      co2KgPerLiter: Math.max(0, Number(form.co2KgPerLiter) || 2.68),
      companyName: form.companyName.trim(),
      companyTaxId: form.companyTaxId.trim(),
      companyAddress: form.companyAddress.trim(),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  /** Recompute each truck's cost/km from the current fuel price & economy. */
  const applyFuelToTrucks = () => {
    const price = Math.max(0, Number(form.dieselPricePerLiter) || 0)
    const kmPerL = Math.max(0.1, Number(form.fuelConsumptionKmPerL) || 4)
    const perKm = Math.round((price / kmPerL) * 100) / 100
    trucks.forEach((tr) => upsertTruck({ ...tr, costPerKm: perKm }))
    setFuelMsg(t('settings.fuelApplied', { n: trucks.length }))
    setTimeout(() => setFuelMsg(null), 3000)
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title={t('settings.title')} />

      <Card className="p-5 mb-4 space-y-4">
        <Field label={t('settings.language')}>
          <div className="flex gap-2 mt-1">
            <Button
              variant={settings.language === 'en' ? 'primary' : 'secondary'}
              onClick={() => setLanguage('en')}
            >
              English
            </Button>
            <Button
              variant={settings.language === 'th' ? 'primary' : 'secondary'}
              onClick={() => setLanguage('th')}
            >
              ไทย
            </Button>
          </div>
        </Field>

        <Field label={t('settings.theme')}>
          <div className="flex gap-2 mt-1">
            <Button
              variant={settings.theme !== 'dark' ? 'primary' : 'secondary'}
              onClick={() => updateSettings({ theme: 'light' })}
            >
              <Sun size={15} /> {t('settings.themeLight')}
            </Button>
            <Button
              variant={settings.theme === 'dark' ? 'primary' : 'secondary'}
              onClick={() => updateSettings({ theme: 'dark' })}
            >
              <Moon size={15} /> {t('settings.themeDark')}
            </Button>
          </div>
        </Field>

        <Field label={t('roles.label')} hint={t('roles.hint')}>
          <div className="flex gap-2 mt-1">
            {ROLES.map((r) => (
              <Button
                key={r}
                variant={settings.role === r ? 'primary' : 'secondary'}
                onClick={() => updateSettings({ role: r as Role })}
              >
                <ShieldCheck size={15} /> {t(`roles.${r}`)}
              </Button>
            ))}
          </div>
        </Field>
      </Card>

      <Card className="p-5 mb-4 space-y-4">
        <Field label={t('settings.mapboxToken')} hint={t('settings.mapboxHint')}>
          <input
            className={inputClass}
            type="password"
            placeholder="pk.…"
            value={form.mapboxToken}
            onChange={(e) => setForm({ ...form, mapboxToken: e.target.value })}
          />
        </Field>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-800 mb-3">{t('settings.depot')}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Field label={t('settings.depotName')}>
                <input className={inputClass} value={form.depotName} onChange={(e) => setForm({ ...form, depotName: e.target.value })} />
              </Field>
            </div>
            <Field
              label={t('locations.lat')}
              error={!coordCheck.ok ? t('locations.notNumber') : undefined}
              hint={coordCheck.ok && coordCheck.warning ? t('locations.outsideTh') : undefined}
            >
              <input className={inputClass} inputMode="decimal" value={form.depotLat} onChange={(e) => setForm({ ...form, depotLat: e.target.value })} />
            </Field>
            <Field label={t('locations.lng')}>
              <input className={inputClass} inputMode="decimal" value={form.depotLng} onChange={(e) => setForm({ ...form, depotLng: e.target.value })} />
            </Field>
          </div>
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('settings.avgSpeed')}>
            <input className={inputClass} type="number" min="10" max="120" value={form.avgSpeedKmh} onChange={(e) => setForm({ ...form, avgSpeedKmh: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.useRoadGeometry}
              onChange={(e) => setForm({ ...form, useRoadGeometry: e.target.checked })}
            />
            {t('settings.useRoad')}
          </label>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={!coordCheck.ok}>
            {t('common.save')}
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
              <Check size={16} /> {t('settings.saved')}
            </span>
          )}
        </div>
      </Card>

      {/* Fuel & emissions */}
      <Card className="p-5 mb-4 space-y-4">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Fuel size={16} /> {t('settings.fuel')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t('settings.dieselPrice')}>
            <input className={inputClass} type="number" min="0" step="0.25" value={form.dieselPricePerLiter} onChange={(e) => setForm({ ...form, dieselPricePerLiter: e.target.value })} />
          </Field>
          <Field label={t('settings.fuelEconomy')}>
            <input className={inputClass} type="number" min="0.1" step="0.1" value={form.fuelConsumptionKmPerL} onChange={(e) => setForm({ ...form, fuelConsumptionKmPerL: e.target.value })} />
          </Field>
          <Field label={t('settings.co2PerLiter')}>
            <input className={inputClass} type="number" min="0" step="0.01" value={form.co2KgPerLiter} onChange={(e) => setForm({ ...form, co2KgPerLiter: e.target.value })} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={applyFuelToTrucks}>
            {t('settings.applyFuel')}
          </Button>
          {fuelMsg && <span className="text-sm text-emerald-600">{fuelMsg}</span>}
        </div>
      </Card>

      {/* Company details for printed documents */}
      <Card className="p-5 mb-4 space-y-4">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Building2 size={16} /> {t('settings.company')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('settings.companyName')}>
            <input className={inputClass} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          </Field>
          <Field label={t('settings.companyTaxId')}>
            <input className={inputClass} value={form.companyTaxId} onChange={(e) => setForm({ ...form, companyTaxId: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('settings.companyAddress')}>
              <input className={inputClass} value={form.companyAddress} onChange={(e) => setForm({ ...form, companyAddress: e.target.value })} />
            </Field>
          </div>
        </div>
        <Button onClick={save} disabled={!coordCheck.ok}>{t('common.save')}</Button>
      </Card>

      {/* Activity log */}
      <Card className="mb-4">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <History size={16} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-800">{t('activity.title')}</h2>
          <span className="ml-auto text-xs text-slate-400">{audit.length}</span>
        </div>
        {audit.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">{t('activity.empty')}</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <Table headers={[t('activity.time'), t('activity.actor'), t('activity.action'), t('activity.entity'), t('activity.detail')]}>
              {audit.slice(0, 60).map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td>
                  <td className="px-4 py-2"><Badge tone="slate">{t(`roles.${e.actor}`)}</Badge></td>
                  <td className="px-4 py-2 text-slate-700">{t(`activity.actions.${e.action}`)}</td>
                  <td className="px-4 py-2 text-slate-500">{e.entity}</td>
                  <td className="px-4 py-2 text-slate-700">{e.label}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>

      {isAdmin && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">{t('settings.dataMgmt')}</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => confirm(t('settings.resetConfirm')) && resetToSeed()}>
              {t('settings.resetSeed')}
            </Button>
            <Button variant="danger" onClick={() => confirm(t('settings.clearConfirm')) && clearAll()}>
              {t('settings.clearAll')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
