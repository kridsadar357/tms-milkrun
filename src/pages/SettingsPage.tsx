import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bell, Building2, Check, Database, Fuel, History, LogOut, MapPin, Moon, Send, ShieldCheck,
  SlidersHorizontal, Sun, Upload,
} from 'lucide-react'
import { useTms } from '../store'
import { notify, notifyStatus, type NotifyStatus } from '../lib/notify'

type TabId = 'general' | 'routing' | 'cost' | 'company' | 'notify' | 'activity' | 'data'
import { validateCoords } from '../lib/geo'
import { can } from '../lib/permissions'
import { logout } from '../lib/auth'
import { parseAisinWorkbook, type ImportResult } from '../lib/importAisin'
import { Badge, Button, Card, Field, PageHeader, Table, inputClass } from '../components/ui'

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { settings, trucks, audit, updateSettings, upsertTruck, resetToSeed, clearAll, importMasterData } = useTms()
  const isAdmin = can(settings.role, 'admin')
  const [imp, setImp] = useState<ImportResult | null>(null)
  const [impErr, setImpErr] = useState<string | null>(null)
  const [form, setForm] = useState({
    mapboxToken: settings.mapboxToken,
    depotName: settings.depotName,
    depotLat: String(settings.depotLat),
    depotLng: String(settings.depotLng),
    avgSpeedKmh: String(settings.avgSpeedKmh),
    planStartTime: settings.planStartTime ?? '08:00',
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
  const [tab, setTab] = useState<TabId>('general')
  const [notifyState, setNotifyState] = useState<NotifyStatus>({ configured: false, channel: null })
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null)
  useEffect(() => { notifyStatus().then(setNotifyState) }, [])

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
      planStartTime: form.planStartTime || '08:00',
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

  const allTabs: { id: TabId; label: string; icon: ReactNode; adminOnly?: boolean }[] = [
    { id: 'general', label: t('settings.tabGeneral'), icon: <SlidersHorizontal size={15} /> },
    { id: 'routing', label: t('settings.tabRouting'), icon: <MapPin size={15} /> },
    { id: 'cost', label: t('settings.tabCost'), icon: <Fuel size={15} /> },
    { id: 'company', label: t('settings.tabCompany'), icon: <Building2 size={15} /> },
    { id: 'notify', label: t('notify.tab'), icon: <Bell size={15} /> },
    { id: 'activity', label: t('activity.title'), icon: <History size={15} /> },
    { id: 'data', label: t('settings.dataMgmt'), icon: <Database size={15} />, adminOnly: true },
  ]
  const tabs = allTabs.filter((x) => !x.adminOnly || isAdmin)

  return (
    <div>
      <PageHeader title={t('settings.title')} />

      <div className="flex flex-wrap gap-1 border-b border-slate-200 mb-4">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition cursor-pointer ${
              tab === tb.id ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tb.icon} {tb.label}
          </button>
        ))}
      </div>

      <div className="max-w-3xl">
      {tab === 'general' && (
      <Card className="p-5 space-y-4">
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

        <Field label={t('auth.signedInAs')}>
          <div className="flex items-center gap-3 mt-1">
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
              <ShieldCheck size={15} className="text-brand-500" />
              {t(`roles.${settings.role}`)}
            </span>
            <Button
              variant="secondary"
              onClick={async () => {
                await logout()
                window.location.reload()
              }}
            >
              <LogOut size={15} /> {t('auth.logout')}
            </Button>
          </div>
        </Field>
      </Card>
      )}

      {tab === 'routing' && (
      <Card className="p-5 space-y-4">
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
          <legend className="text-sm font-semibold text-slate-800 mb-1">{t('settings.depot')}</legend>
          <p className="text-xs text-slate-400 mb-3">{t('settings.depotHint')}</p>
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t('settings.avgSpeed')}>
            <input className={inputClass} type="number" min="10" max="120" value={form.avgSpeedKmh} onChange={(e) => setForm({ ...form, avgSpeedKmh: e.target.value })} />
          </Field>
          <Field label={t('settings.planStartTime')}>
            <input className={inputClass} type="time" value={form.planStartTime} onChange={(e) => setForm({ ...form, planStartTime: e.target.value })} />
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
      )}

      {tab === 'cost' && (
      <Card className="p-5 space-y-4">
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
      )}

      {tab === 'company' && (
      <Card className="p-5 space-y-4">
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
      )}

      {tab === 'notify' && (
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Bell size={16} /> {t('notify.title')}
        </h2>

        <div className={`rounded-lg border px-3 py-2.5 text-sm flex items-center gap-2 ${notifyState.configured ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
          <span className={`w-2 h-2 rounded-full ${notifyState.configured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {notifyState.configured
            ? t('notify.configured', { channel: notifyState.channel === 'line' ? 'LINE' : 'Webhook' })
            : t('notify.notConfigured')}
        </div>

        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!settings.lineNotify}
            disabled={!notifyState.configured}
            onChange={(e) => updateSettings({ lineNotify: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t('notify.enable')}</span>
            <span className="block text-xs text-slate-400 mt-0.5">{t('notify.enableHint')} · {t('notify.events')}</span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={!notifyState.configured}
            onClick={async () => {
              await notify(`✅ TMS Milkrun — ${t('notify.test')}`)
              setNotifyMsg(t('notify.testSent'))
              setTimeout(() => setNotifyMsg(null), 3000)
            }}
          >
            <Send size={15} /> {t('notify.test')}
          </Button>
          {notifyMsg && <span className="text-sm text-emerald-600">{notifyMsg}</span>}
        </div>
      </Card>
      )}

      {tab === 'activity' && (
      <Card>
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
      )}

      {tab === 'data' && isAdmin && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">{t('settings.dataMgmt')}</h2>

          {/* Import a milkrun planning workbook (.xlsx) → plants, suppliers, trucks, rate cards */}
          <div className="mb-4">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm text-slate-700 cursor-pointer">
              <Upload size={15} /> {t('settings.importXlsx')}
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  setImp(null); setImpErr(null)
                  try {
                    setImp(await parseAisinWorkbook(await file.arrayBuffer()))
                  } catch (err) {
                    setImpErr(err instanceof Error ? err.message : String(err))
                  }
                }}
              />
            </label>
            <p className="text-xs text-slate-400 mt-1">{t('settings.importXlsxHint')}</p>
            {impErr && <p className="text-xs text-rose-600 mt-2">{impErr}</p>}
            {imp && (
              <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm">
                <p className="text-slate-700 mb-1">
                  {t('settings.importPreview', {
                    plants: imp.locations.filter((l) => l.kind === 'plant').length,
                    suppliers: imp.locations.filter((l) => l.kind !== 'plant').length,
                    trucks: imp.trucks.length,
                    partners: imp.partners.length,
                  })}
                </p>
                {imp.warnings.length > 0 && (
                  <p className="text-xs text-amber-700 mb-2">⚠ {imp.warnings.slice(0, 3).join('; ')}{imp.warnings.length > 3 ? '…' : ''}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      importMasterData({ partners: imp.partners, trucks: imp.trucks, drivers: [], locations: imp.locations })
                      setImp(null)
                    }}
                  >
                    <Check size={15} /> {t('settings.importApply')}
                  </Button>
                  <Button variant="secondary" onClick={() => setImp(null)}>{t('common.cancel')}</Button>
                </div>
              </div>
            )}
          </div>

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
    </div>
  )
}
