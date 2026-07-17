import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Boxes, Clock, FileDown, Gauge, Info, Recycle, RefreshCw, Route as RouteIcon,
  Timer, TriangleAlert,
} from 'lucide-react'
import { useTms } from '../store'
import { computeMilkrunStats } from '../lib/analytics'
import { exportCsv } from '../lib/csv'
import { Badge, Button, Card, PageHeader } from '../components/ui'

const SERIES_1 = '#2a78d6' // volume / returnable
const SERIES_2 = '#1baf7a' // weight / one-way

export default function Analytics() {
  const { t, i18n } = useTranslation()
  const { plan, trucks, locations, products, pods, incidents, audit, settings } = useTms()
  const fmt = (n: number) => n.toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-US')

  const s = useMemo(
    () => computeMilkrunStats({ plan, trucks, locations, products, pods, incidents, audit, settings }),
    [plan, trucks, locations, products, pods, incidents, audit, settings],
  )

  const exportSummary = () =>
    exportCsv(
      `tms-analytics-${new Date().toISOString().slice(0, 10)}`,
      ['Metric', 'Value'],
      [
        ['Routes', s.routeCount],
        ['Cyclic rotation %', s.cyclicRotationPct],
        ['Avg lead time (min)', s.avgLeadTimeMin],
        ['Max lead time (min)', s.maxLeadTimeMin],
        ['Loading efficiency % (m³)', s.loadingEfficiencyPct],
        ['Avg kg utilization %', s.avgUtilKg],
        ['Total CO₂ (kg)', s.co2Kg],
        ['Fixed routes', s.fixedRoutes],
        ['Dynamic routes', s.dynamicRoutes],
        ['Time-window compliance %', s.windowCompliancePct],
        ['POD on-time', s.podOnTime],
        ['POD late', s.podLate],
        ['POD early', s.podEarly],
        ['Returnable SKUs', s.returnableSkus],
        ['One-way SKUs', s.oneWaySkus],
        ['Returnable %', s.returnablePct],
        ['POD completion %', s.podCompletionPct],
        ['Failed deliveries', s.podFailed],
        ['Open incidents', s.incidentsOpen],
        ['High-severity incidents', s.incidentsHigh],
        ['Recorded changes', s.changes],
      ],
    )

  if (!s.hasPlan) {
    return (
      <div>
        <PageHeader title={t('analytics.title')} />
        <Card className="p-8 flex items-center gap-3 text-slate-500">
          <Info size={20} /> {t('analytics.noPlan')}
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('analytics.title')}
        actions={
          <Button variant="secondary" onClick={exportSummary}>
            <FileDown size={16} /> {t('common.exportCsv')}
          </Button>
        }
      />

      {/* Milkrun principle KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={<RefreshCw size={18} />} label={t('analytics.cyclicRotation')} value={`${s.cyclicRotationPct}%`}
          sub={`${s.fixedRoutes} ${t('analytics.fixed')} · ${s.dynamicRoutes} ${t('analytics.dynamic')}`} />
        <Kpi icon={<Timer size={18} />} label={t('analytics.shortLeadTime')} value={`${s.avgLeadTimeMin} ${t('common.min')}`}
          sub={`${t('analytics.max')} ${s.maxLeadTimeMin} ${t('common.min')}`} />
        <Kpi icon={<Gauge size={18} />} label={t('analytics.loadingEfficiency')} value={`${s.loadingEfficiencyPct}%`}
          sub={`${t('planner.weight')} ${s.avgUtilKg}%`} />
        <Kpi icon={<RefreshCw size={18} />} label={t('analytics.flexibility')} value={`${s.podCompletionPct}%`}
          sub={`${s.incidentsOpen} ${t('analytics.openIncidents')} · ${s.changes} ${t('analytics.changes')}`} />
      </div>

      {/* 1. Truck routing */}
      <Section icon={<RouteIcon size={16} />} title={t('analytics.truckRouting')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4 font-medium">{t('trucks.plate')}</th>
                <th className="py-2 pr-4 font-medium">{t('analytics.mode')}</th>
                <th className="py-2 pr-4 font-medium text-right">{t('planner.routes')}</th>
                <th className="py-2 pr-4 font-medium text-right">{t('planner.stops')}</th>
                <th className="py-2 pr-4 font-medium text-right">{t('common.km')}</th>
                <th className="py-2 pr-4 font-medium">{t('analytics.utilization')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.perTruck.map((row) => (
                <tr key={row.truckId}>
                  <td className="py-2 pr-4 font-medium text-slate-800 whitespace-nowrap">{row.plate}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={row.mode === 'fixed' ? 'green' : 'blue'}>
                      {t(`analytics.${row.mode}`)}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.routes}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.stops}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmt(row.distanceKm)}</td>
                  <td className="py-2 pr-4 min-w-[8rem]">
                    <Meter pct={row.utilM3} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 2. Time windows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section icon={<Clock size={16} />} title={t('analytics.timeWindows')}>
          <p className="text-xs text-slate-500 mb-3">{t('analytics.windowHint')}</p>
          <div className="flex items-end gap-3 mb-2">
            <span className="text-3xl font-semibold text-slate-900 tabular-nums">{s.windowCompliancePct}%</span>
            <span className="text-sm text-slate-500 pb-1">
              {s.withinWindow}/{s.windowStops} {t('analytics.withinWindow')}
            </span>
          </div>
          <Meter pct={s.windowCompliancePct} />
          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            <MiniStat label={t('analytics.onTime')} value={s.podOnTime} tone="text-emerald-600" />
            <MiniStat label={t('analytics.late')} value={s.podLate} tone="text-red-600" />
            <MiniStat label={t('analytics.early')} value={s.podEarly} tone="text-brand-600" />
          </div>
        </Section>

        {/* 4. Returnable packaging */}
        <Section icon={<Recycle size={16} />} title={t('analytics.returnable')}>
          <p className="text-xs text-slate-500 mb-3">{t('analytics.returnableHint')}</p>
          <div className="flex items-end gap-3 mb-3">
            <span className="text-3xl font-semibold text-slate-900 tabular-nums">{s.returnablePct}%</span>
            <span className="text-sm text-slate-500 pb-1">{t('analytics.returnableShare')}</span>
          </div>
          <Legend items={[[SERIES_1, t('analytics.returnableSkus')], [SERIES_2, t('analytics.oneWay')]]} />
          <div className="space-y-2 mt-2">
            <PairRow label={t('analytics.wooden')} a={s.palletsWooden} b={0} max={Math.max(1, ...[s.palletsWooden, s.palletsPlastic, s.palletsNone])} />
            <PairRow label={t('analytics.plastic')} a={s.palletsPlastic} b={0} max={Math.max(1, ...[s.palletsWooden, s.palletsPlastic, s.palletsNone])} />
            <PairRow label={t('analytics.oneWay')} a={0} b={s.palletsNone} max={Math.max(1, ...[s.palletsWooden, s.palletsPlastic, s.palletsNone])} />
          </div>
        </Section>
      </div>

      {/* 3. Load optimization */}
      <Section icon={<Boxes size={16} />} title={t('analytics.loadOptimization')}>
        <Legend items={[[SERIES_1, `${t('planner.volume')} (${t('common.m3')})`], [SERIES_2, `${t('planner.weight')} (${t('common.kg')})`]]} />
        <div className="space-y-2 mt-2">
          {s.routeUtil.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-xs">
              <span className="text-slate-600 truncate">{r.label}</span>
              <div className="space-y-1">
                <Bar pct={r.m3Pct} color={SERIES_1} suffix={`${r.m3Pct}%`} />
                <Bar pct={r.kgPct} color={SERIES_2} suffix={`${r.kgPct}%`} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 5. Flexibility & communication */}
      <Section icon={<TriangleAlert size={16} />} title={t('analytics.flexComm')}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MiniStat label={t('analytics.podCompletion')} value={`${s.podCompletionPct}%`} tone="text-emerald-600" big />
          <MiniStat label={t('analytics.failed')} value={s.podFailed} tone={s.podFailed ? 'text-red-600' : 'text-slate-700'} big />
          <MiniStat label={t('analytics.openIncidents')} value={s.incidentsOpen} tone={s.incidentsHigh ? 'text-red-600' : 'text-amber-600'} big />
          <MiniStat label={t('analytics.co2')} value={`${fmt(s.co2Kg)} ${t('common.kg')}`} tone="text-emerald-600" big />
        </div>
      </Section>
    </div>
  )
}

/* -------------------------- little chart pieces ------------------------- */

function Kpi({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-slate-400 mb-2">
        {icon}
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-slate-900 tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1.5">{sub}</p>}
    </Card>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-3">
        <span className="text-slate-400">{icon}</span>
        {title}
      </h2>
      {children}
    </Card>
  )
}

function Meter({ pct }: { pct: number }) {
  const clamped = Math.min(100, pct)
  const color = pct >= 85 ? '#1baf7a' : pct >= 60 ? '#2a78d6' : '#eda100'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: color }} />
      </div>
      <span className="text-xs text-slate-500 tabular-nums w-10 text-right">{pct}%</span>
    </div>
  )
}

function Bar({ pct, color, suffix }: { pct: number; color: string; suffix: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-3 rounded-r bg-slate-100 overflow-hidden">
        <div className="h-full rounded-r" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
      <span className="text-[11px] text-slate-500 tabular-nums w-9 text-right">{suffix}</span>
    </div>
  )
}

function PairRow({ label, a, b, max }: { label: string; a: number; b: number; max: number }) {
  const val = a || b
  const color = a ? SERIES_1 : SERIES_2
  return (
    <div className="grid grid-cols-[minmax(0,5rem)_1fr_2rem] items-center gap-2 text-xs">
      <span className="text-slate-600 truncate">{label}</span>
      <div className="h-3 rounded-r bg-slate-100 overflow-hidden">
        <div className="h-full rounded-r" style={{ width: `${(val / max) * 100}%`, background: color }} />
      </div>
      <span className="text-slate-500 tabular-nums text-right">{val}</span>
    </div>
  )
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-500">
      {items.map(([c, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
          {label}
        </span>
      ))}
    </div>
  )
}

function MiniStat({ label, value, tone, big }: { label: string; value: ReactNode; tone: string; big?: boolean }) {
  return (
    <div>
      <div className={`${big ? 'text-2xl' : 'text-xl'} font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}
