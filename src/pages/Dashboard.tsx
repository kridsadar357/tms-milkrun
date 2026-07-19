import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import {
  ArrowRight, Banknote, Boxes, Check, Factory, Gauge, Leaf, PackageCheck, Recycle, Route as RouteIcon,
  Ruler, Sunrise, Timer, TriangleAlert, Truck as TruckIcon,
} from 'lucide-react'
import { billingAmounts, useTms } from '../store'
import { estimateCo2Kg } from '../types'
import { computeMilkrunStats } from '../lib/analytics'
import { planCostByPartner, routeCostBreakdown } from '../lib/cost'
import { ROUTE_COLORS } from '../components/MapView'
import type { ReactNode } from 'react'

const WORKDAYS = 26

export default function Dashboard({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { t, i18n } = useTranslation()
  const { plan, trucks, locations, partners, billings, pods, incidents, products, audit, settings } = useTms()
  const th = i18n.language === 'th'
  const fmt = (n: number) => n.toLocaleString(th ? 'th-TH' : 'en-US', { maximumFractionDigits: 0 })
  const truckById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks])

  /* ---------------- master data (always populated) ---------------- */
  const activeLocs = locations.filter((l) => l.active)
  const plants = activeLocs.filter((l) => l.kind === 'plant')
  const suppliers = activeLocs.filter((l) => l.kind !== 'plant' && (l.demandM3 > 0 || l.demandKg > 0))
  const activeTrucks = trucks.filter((tr) => tr.active)

  const demandM3 = suppliers.reduce((s, l) => s + l.demandM3 * Math.max(1, l.roundsPerDay ?? 1), 0)
  const demandKg = suppliers.reduce((s, l) => s + l.demandKg * Math.max(1, l.roundsPerDay ?? 1), 0)
  const capM3 = activeTrucks.reduce((s, tr) => s + tr.capacityM3 * Math.max(1, tr.roundsPerDay), 0)
  const capKg = activeTrucks.reduce((s, tr) => s + tr.capacityKg * Math.max(1, tr.roundsPerDay), 0)

  const fleetMix = useMemo(() => {
    const m = new Map<string, { n: number; m3: number; kg: number }>()
    for (const tr of activeTrucks) {
      const e = m.get(tr.type) ?? { n: 0, m3: 0, kg: 0 }
      e.n++; e.m3 += tr.capacityM3; e.kg += tr.capacityKg
      m.set(tr.type, e)
    }
    return [...m.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.n - a.n)
  }, [activeTrucks])

  // Milkrun structure: inbound suppliers per destination plant.
  const perPlant = useMemo(() => {
    const byId = new Map(plants.map((p) => [p.id, p]))
    const m = new Map<string, { name: string; sup: number; m3: number; kg: number }>()
    for (const s of suppliers) {
      const key = s.deliveryPlantId && byId.has(s.deliveryPlantId) ? s.deliveryPlantId : '—'
      const e = m.get(key) ?? { name: key === '—' ? t('dashboard.globalDepot') : (byId.get(key)?.code ?? key), sup: 0, m3: 0, kg: 0 }
      e.sup++; e.m3 += s.demandM3; e.kg += s.demandKg
      m.set(key, e)
    }
    return [...m.values()].sort((a, b) => b.kg - a.kg)
  }, [plants, suppliers, t])

  const weekly = useMemo(() => {
    const days = th ? ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return days.map((d, i) => {
      const stops = suppliers.filter((l) => (l.deliveryDays?.length ?? 0) === 0 || l.deliveryDays.includes(i))
      return { day: d, m3: Math.round(stops.reduce((s, l) => s + l.demandM3, 0) * 10) / 10, count: stops.length }
    })
  }, [suppliers, th])
  // Weekly bars are only meaningful when suppliers actually differ by weekday;
  // with daily-delivery data every bar is identical, so we hide the chart.
  const weeklyVaries = new Set(weekly.map((w) => w.count)).size > 1

  /* ---------------- plan-derived (real; empty until Auto Route) ---------------- */
  const routes = plan?.routes.filter((r) => r.stops.length > 0) ?? []
  const hasPlan = routes.length > 0
  const stats = useMemo(
    () => computeMilkrunStats({ plan, trucks, locations, products, pods, incidents, audit, settings }),
    [plan, trucks, locations, products, pods, incidents, audit, settings],
  )
  const totalCost = routes.reduce((s, r) => s + r.cost, 0)
  const totalDistance = routes.reduce((s, r) => s + r.distanceKm, 0)
  const totalCo2 = routes.reduce((s, r) => s + estimateCo2Kg(r.distanceKm, settings), 0)
  const trips = routes.reduce((s, r) => s + Math.max(1, r.roundsPerDay ?? 1), 0)

  const costRanked = useMemo(() => planCostByPartner(routes, truckById, partners), [routes, truckById, partners])
  const cheapest = costRanked[0]?.total ?? 0
  const costSplit = useMemo(() => {
    let fixed = 0, variable = 0
    for (const r of routes) {
      const tr = truckById.get(r.truckId)
      const bd = tr ? routeCostBreakdown(r, tr, partners.find((p) => p.id === tr.partnerId)) : null
      if (bd) { fixed += bd.fixed; variable += bd.variable }
    }
    return { fixed, variable, total: fixed + variable }
  }, [routes, truckById, partners])

  const routeLoad = useMemo(
    () => routes.map((r) => {
      const tr = truckById.get(r.truckId)
      return {
        id: r.id, colorIndex: r.colorIndex,
        label: `${tr?.plateNumber ?? r.truckId}`,
        m3Pct: tr ? Math.min(100, Math.round((r.totalM3 / tr.capacityM3) * 100)) : 0,
        kgPct: tr ? Math.min(100, Math.round((r.totalKg / tr.capacityKg) * 100)) : 0,
      }
    }),
    [routes, truckById],
  )

  const openBillings = billings.filter((b) => b.status !== 'paid')
  const outstanding = openBillings.reduce((s, b) => s + billingAmounts(b).netPayable, 0)

  // Start-of-day checklist — real state drives each step.
  const podIds = new Set(pods.map((p) => p.id))
  const dispatched = routes.filter((r) => (r.status ?? 'planned') !== 'planned').length
  const stopTotal = routes.reduce((n, r) => n + r.stops.length, 0)
  const podRecorded = routes.reduce((n, r) => n + r.stops.filter((x) => podIds.has(`${r.id}:${x.locationId}`)).length, 0)
  const sod = [
    { key: 'plan', done: hasPlan, page: 'planner', count: hasPlan ? `${routes.length} ${t('costs.routesCount').toLowerCase()}` : '' },
    { key: 'dispatch', done: hasPlan && dispatched === routes.length, page: 'operations', count: hasPlan ? `${dispatched}/${routes.length}` : '' },
    { key: 'deliver', done: stopTotal > 0 && podRecorded === stopTotal, page: 'operations', count: stopTotal > 0 ? `${podRecorded}/${stopTotal}` : '' },
    { key: 'bill', done: billings.length > 0, page: 'payments', count: billings.length > 0 ? `${billings.length}` : '' },
  ]
  const sodDone = sod.filter((s) => s.done).length
  const nextStep = sod.find((s) => !s.done)

  const heroPlanned = hasPlan
    ? `${fmt(totalCost)} ${t('common.baht')}`
    : demandM3 > 0 ? `${fmt(demandM3)} ${t('common.m3')}` : '—'

  return (
    <div className="flex flex-col gap-4 pb-2">
      {/* ---------- start-of-day guide ---------- */}
      <Panel className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <Sunrise size={18} className="text-amber-500" />
          <h2 className="font-semibold text-slate-900">{t('dashboard.sodTitle')}</h2>
          <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${sodDone === 4 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{sodDone}/4</span>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          {sodDone === 4 ? t('dashboard.sodAllDone') : nextStep ? t('dashboard.sodNext', { step: t(`dashboard.sod.${nextStep.key}`) }) : ''}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {sod.map((step, i) => {
            const isNext = nextStep?.key === step.key
            return (
              <button key={step.key} onClick={() => onNavigate?.(step.page)}
                className={`text-left rounded-xl border p-3 transition cursor-pointer flex items-start gap-3 ${step.done ? 'bg-emerald-50/60 border-emerald-200' : isNext ? 'bg-brand-50 border-brand-300 ring-1 ring-brand-200' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
                <span className={`mt-0.5 flex items-center justify-center w-6 h-6 rounded-full text-xs shrink-0 ${step.done ? 'bg-emerald-500 text-white' : isNext ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  {step.done ? <Check size={14} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-medium text-slate-800">
                    {t(`dashboard.sod.${step.key}`)}
                    {isNext && <ArrowRight size={13} className="text-brand-500" />}
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-0.5 truncate">{step.count || t(`dashboard.sodHint.${step.key}`)}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Panel>

      {/* ---------- hero KPI band ---------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Hero primary icon={<Banknote size={18} />} label={hasPlan ? t('dashboard.kpiCost') : t('dashboard.dailyDemand')}
          value={heroPlanned} sub={hasPlan ? `≈ ${fmt(totalCost * WORKDAYS)} ${t('common.baht')}/${t('dashboard.mo')}` : `${fmt(demandKg)} ${t('common.kg')}`} />
        <Hero icon={<Gauge size={18} />} label={t('dashboard.loadingEff')}
          value={hasPlan ? `${stats.avgUtilKg}%` : `${capKg > 0 ? Math.round((demandKg / capKg) * 100) : 0}%`}
          sub={hasPlan ? `${stats.avgUtilM3}% ${t('common.m3')}` : t('dashboard.planned')} tone="green" />
        <Hero icon={<Ruler size={18} />} label={t('dashboard.kpiDistance')}
          value={hasPlan ? `${fmt(totalDistance)}` : '—'} sub={hasPlan ? `${t('common.km')} · ${trips} ${t('dashboard.trips')}` : t('common.km')} />
        <Hero icon={<Timer size={18} />} label={t('dashboard.onTime')}
          value={hasPlan && stats.windowStops > 0 ? `${stats.windowCompliancePct}%` : '—'}
          sub={hasPlan ? `${stats.withinWindow}/${stats.windowStops} ${t('dashboard.inWindow')}` : t('dashboard.windows')} tone="green" />
        <Hero icon={<Factory size={18} />} label={t('dashboard.network')}
          value={`${plants.length} · ${suppliers.length}`} sub={`${t('dashboard.plants')} · ${t('dashboard.suppliers')}`} />
        <Hero icon={<TruckIcon size={18} />} label={t('dashboard.fleet')}
          value={String(activeTrucks.length)} sub={fleetMix.map((f) => `${f.n} ${f.type}`).join(' · ') || t('dashboard.noTrucks')} />
      </div>

      {!hasPlan && (
        <Panel className="p-4 flex items-center gap-3 bg-brand-50 border-brand-200">
          <RouteIcon size={18} className="text-brand-600" />
          <span className="text-sm text-slate-700">{t('dashboard.runHint')}</span>
        </Panel>
      )}

      {/* ---------- cost & efficiency ---------- */}
      <SectionLabel icon={<Banknote size={13} />}>{t('dashboard.secCost')}</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Transporter cost ranking */}
        <Panel className="p-5 lg:col-span-2">
          <PanelHead icon={<Banknote size={15} />} title={t('dashboard.costByPartner')}
            note={hasPlan ? t('dashboard.costByPartnerNote') : t('dashboard.needPlan')} />
          {hasPlan && costRanked.length ? (
            <div className="space-y-2.5 mt-3">
              {costRanked.map((c, i) => (
                <div key={c.partner.id} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3">
                  <span className="flex items-center gap-1.5 text-sm text-slate-700 truncate">
                    <span className="truncate">{c.partner.name}</span>
                    {i === 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">{t('costs.best')}</span>}
                  </span>
                  <Bar pct={Math.round((c.total / Math.max(1, costRanked[costRanked.length - 1].total)) * 100)} color={i === 0 ? 'var(--color-series-2)' : 'var(--color-brand-500)'} />
                  <span className="text-sm text-slate-800 text-right tabular-nums whitespace-nowrap font-medium">
                    ฿{fmt(c.total)}{i > 0 && <span className="text-rose-500 text-xs"> +{((c.total / cheapest - 1) * 100).toFixed(0)}%</span>}
                  </span>
                </div>
              ))}
              <div className="pt-2 mt-1 border-t border-slate-100 flex items-center gap-4 text-xs text-slate-500">
                <span>{t('dashboard.fixed')}: <b className="text-slate-700 tabular-nums">฿{fmt(costSplit.fixed)}</b></span>
                <span>{t('dashboard.variable')}: <b className="text-slate-700 tabular-nums">฿{fmt(costSplit.variable)}</b></span>
                <span className="ml-auto">{t('dashboard.unitCost')}: <b className="text-slate-700 tabular-nums">฿{fmt(demandM3 > 0 && hasPlan ? totalCost / routes.reduce((s, r) => s + r.totalM3, 0) : 0)}/{t('common.m3')}</b></span>
              </div>
            </div>
          ) : (
            <Empty text={t('dashboard.needPlanLong')} />
          )}
        </Panel>

        {/* Milkrun health rings */}
        <Panel className="p-5">
          <PanelHead icon={<Recycle size={15} />} title={t('dashboard.milkrunHealth')} />
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Ring pct={stats.loadingEfficiencyPct} label={t('analytics.loadingEfficiency')} color="var(--color-series-2)" disabled={!hasPlan} />
            <Ring pct={stats.cyclicRotationPct} label={t('analytics.cyclicRotation')} color="var(--color-brand-500)" disabled={!hasPlan} />
            <Ring pct={stats.windowStops > 0 ? stats.windowCompliancePct : 0} label={t('dashboard.onTime')} color="var(--color-series-4)" disabled={!hasPlan || stats.windowStops === 0} />
            <Ring pct={stats.returnablePct} label={t('analytics.returnable')} color="var(--color-series-3)" disabled={stats.returnableSkus + stats.oneWaySkus === 0} />
          </div>
        </Panel>
      </div>

      {/* ---------- network & demand ---------- */}
      <SectionLabel icon={<Factory size={13} />}>{t('dashboard.secNetwork')}</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Capacity vs demand */}
        <Panel className="p-5">
          <PanelHead icon={<Boxes size={15} />} title={t('dashboard.capacity')} note={t('dashboard.capacityNote')} />
          <div className="space-y-4 mt-4">
            <CapBar label={t('common.kg')} used={demandKg} cap={capKg} unit={t('common.kg')} fmt={fmt} tone="var(--color-series-2)" />
            <CapBar label={t('common.m3')} used={demandM3} cap={capM3} unit={t('common.m3')} fmt={fmt} tone="var(--color-brand-500)" />
            <div className="flex gap-2 flex-wrap pt-1">
              {fleetMix.map((f) => (
                <span key={f.type} className="text-xs px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
                  <b className="text-slate-800">{f.n}×</b> {f.type} · {fmt(f.kg)} {t('common.kg')}
                </span>
              ))}
            </div>
          </div>
        </Panel>

        {/* Inbound by plant (milkrun structure) — widens when the weekly chart is hidden */}
        <Panel className={`p-5 ${weeklyVaries ? '' : 'lg:col-span-2'}`}>
          <PanelHead icon={<Factory size={15} />} title={t('dashboard.byPlant')} note={t('dashboard.byPlantNote')} />
          <div className="space-y-2 mt-3 max-h-56 overflow-y-auto pr-1">
            {perPlant.length ? perPlant.map((p) => {
              const max = Math.max(1, ...perPlant.map((x) => x.kg))
              return (
                <div key={p.name} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 text-sm">
                  <span className="font-medium text-slate-700 truncate">{p.name}</span>
                  <Bar pct={Math.round((p.kg / max) * 100)} color="var(--color-brand-500)" thin />
                  <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">{p.sup} · {fmt(p.kg)} {t('common.kg')}</span>
                </div>
              )
            }) : <Empty text={t('dashboard.noSuppliers')} />}
          </div>
        </Panel>

        {/* Weekly demand — only when suppliers actually vary by weekday */}
        {weeklyVaries && (
          <Panel className="p-5">
            <PanelHead icon={<Ruler size={15} />} title={t('dashboard.weeklyDemand')} note={t('dashboard.weeklyDemandNote')} />
            <div className="flex items-end justify-between gap-2 h-40 mt-4">
              {weekly.map((w) => {
                const max = Math.max(1, ...weekly.map((x) => x.m3))
                return (
                  <div key={w.day} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                    <span className="text-[10px] text-slate-400 tabular-nums">{w.m3 > 0 ? w.m3 : ''}</span>
                    <div className="w-full rounded-t bg-brand-500/85" style={{ height: `${Math.max(2, (w.m3 / max) * 100)}%` }} />
                    <span className="text-[11px] text-slate-500">{w.day}</span>
                  </div>
                )
              })}
            </div>
          </Panel>
        )}
      </div>

      {/* ---------- operations ---------- */}
      <SectionLabel icon={<PackageCheck size={13} />}>{t('dashboard.secOps')}</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Per-route load */}
        <Panel className="p-5 lg:col-span-2">
          <PanelHead icon={<RouteIcon size={15} />} title={t('dashboard.routeLoad')} note={hasPlan ? t('dashboard.routeLoadNote') : t('dashboard.needPlan')} />
          {hasPlan ? (
            <div className="space-y-2 mt-3 max-h-64 overflow-y-auto pr-1">
              {routeLoad.map((r) => (
                <div key={r.id} className="grid grid-cols-[minmax(0,8rem)_1fr] items-center gap-3">
                  <span className="flex items-center gap-2 text-sm text-slate-700 truncate">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ROUTE_COLORS[r.colorIndex % ROUTE_COLORS.length] }} />
                    <span className="truncate">{r.label}</span>
                  </span>
                  <div className="flex flex-col gap-1">
                    <LabeledBar label={t('common.kg')} pct={r.kgPct} color="var(--color-series-2)" />
                    <LabeledBar label={t('common.m3')} pct={r.m3Pct} color="var(--color-brand-500)" />
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty text={t('dashboard.needPlanLong')} />}
        </Panel>

        {/* Operations pulse */}
        <div className="grid grid-cols-2 gap-4">
          <Mini icon={<PackageCheck size={16} />} label={t('dashboard.deliveries')} value={`${stats.podDelivered}/${stats.podTotal || pods.length}`}
            sub={`${stats.podOnTime} ${t('analytics.onTime')} · ${stats.podLate} ${t('analytics.late')}`} tone="text-emerald-600" />
          <Mini icon={<TriangleAlert size={16} />} label={t('dashboard.incidents')} value={String(stats.incidentsOpen)}
            sub={`${stats.incidentsHigh} ${t('dashboard.high')}`} tone={stats.incidentsHigh > 0 ? 'text-rose-600' : 'text-slate-600'} />
          <Mini icon={<Banknote size={16} />} label={t('dashboard.billing')} value={String(billings.length)}
            sub={outstanding > 0 ? `฿${fmt(outstanding)} ${t('dashboard.outstanding')}` : t('dashboard.allSettled')} />
          <Mini icon={<Leaf size={16} />} label={t('dashboard.kpiCo2')} value={hasPlan ? `${fmt(totalCo2)}` : '—'} sub={t('common.kg') + '/' + t('dashboard.day')} tone="text-emerald-600" />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ pieces ------------------------------ */

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>{children}</div>
}

function SectionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mt-2 -mb-1 px-0.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
      <span className="text-slate-300">{icon}</span>
      {children}
      <span className="flex-1 h-px bg-slate-200/70" />
    </div>
  )
}

function PanelHead({ icon, title, note }: { icon: ReactNode; title: string; note?: string }) {
  return (
    <div>
      <h2 className="font-semibold text-slate-900 flex items-center gap-2"><span className="text-slate-400">{icon}</span>{title}</h2>
      {note && <p className="text-xs text-slate-500 mt-0.5">{note}</p>}
    </div>
  )
}

function Hero({ icon, label, value, sub, tone, primary }: { icon: ReactNode; label: string; value: string; sub?: string; tone?: 'green'; primary?: boolean }) {
  return (
    <div className={`rounded-xl border shadow-sm p-4 relative overflow-hidden ${primary ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-slate-200'}`}>
      <div className={`flex items-center gap-1.5 mb-2 text-xs font-medium ${primary ? 'text-white/80' : 'text-slate-500'}`}>
        <span className={primary ? 'text-white/70' : tone === 'green' ? 'text-emerald-500' : 'text-slate-400'}>{icon}</span>{label}
      </div>
      <p className={`text-2xl font-bold tabular-nums leading-none ${primary ? 'text-white' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className={`text-[11px] mt-1.5 truncate ${primary ? 'text-white/70' : 'text-slate-400'}`}>{sub}</p>}
    </div>
  )
}

function Bar({ pct, color, thin }: { pct: number; color: string; thin?: boolean }) {
  return (
    <div className={`rounded-full bg-slate-100 overflow-hidden ${thin ? 'h-2' : 'h-3.5'}`}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  )
}

function LabeledBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="grid grid-cols-[1.6rem_1fr_2.4rem] items-center gap-2">
      <span className="text-[10px] text-slate-400 uppercase">{label}</span>
      <Bar pct={pct} color={color} thin />
      <span className="text-[11px] text-slate-500 text-right tabular-nums">{pct}%</span>
    </div>
  )
}

function CapBar({ label, used, cap, unit, fmt, tone }: { label: string; used: number; cap: number; unit: string; fmt: (n: number) => string; tone: string }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-500">{label} {t('dashboard.demandVsCap')}</span>
        <span className="text-slate-700 tabular-nums font-medium">{fmt(used)} / {fmt(cap)} {unit} · {pct}%</span>
      </div>
      <Bar pct={pct} color={tone} />
    </div>
  )
}

function Ring({ pct, label, color, disabled }: { pct: number; label: string; color: string; disabled?: boolean }) {
  const r = 26, c = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-slate-100" />
        {!disabled && <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset .6s' }} />}
      </svg>
      <div className="-mt-[52px] mb-[28px] text-center">
        <div className="text-base font-bold text-slate-900 tabular-nums">{disabled ? '—' : `${pct}%`}</div>
      </div>
      <span className="text-[11px] text-slate-500 text-center leading-tight">{label}</span>
    </div>
  )
}

function Mini({ icon, label, value, sub, tone = 'text-slate-800' }: { icon: ReactNode; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col justify-between">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-2"><span className="text-slate-400">{icon}</span>{label}</div>
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="mt-4 py-8 text-center text-sm text-slate-400">{text}</div>
}

// module-scope t for the small stateless CapBar helper
const t = (k: string) => i18n.t(k)
