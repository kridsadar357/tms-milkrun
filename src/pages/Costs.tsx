import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSpreadsheet, Info } from 'lucide-react'
import { useTms } from '../store'
import { exportToExcel } from '../lib/excel'
import { planCostByPartner, planCostComposition, routeCostBreakdown } from '../lib/cost'
import { ROUTE_COLORS } from '../components/MapView'
import { Badge, Button, Card, PageHeader, Table } from '../components/ui'

const WORKDAYS = 22
// component → colour for the cost-composition bar (validated series palette)
const COMP: { key: 'labor' | 'fuel' | 'allowance' | 'drops' | 'tripFee' | 'other' | 'admin'; color: string }[] = [
  { key: 'labor', color: 'var(--color-series-1)' },
  { key: 'fuel', color: 'var(--color-series-8)' },
  { key: 'allowance', color: 'var(--color-series-3)' },
  { key: 'drops', color: 'var(--color-series-5)' },
  { key: 'tripFee', color: 'var(--color-series-7)' },
  { key: 'other', color: 'var(--color-series-2)' },
  { key: 'admin', color: '#94a3b8' },
]

type Tab = 'route' | 'truck' | 'partner'

export default function Costs() {
  const { t, i18n } = useTranslation()
  const { plan, trucks, partners, locations, settings } = useTms()
  const [tab, setTab] = useState<Tab>('partner')

  const truckById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks])
  const partnerById = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners])
  const fmt = (n: number) =>
    n.toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-US', { maximumFractionDigits: 0 })

  const rows = useMemo(() => {
    if (!plan) return []
    const routes = plan.routes.map((r) => {
      const truck = truckById.get(r.truckId)
      const bd = truck
        ? routeCostBreakdown(r, truck, partnerById.get(truck.partnerId))
        : { fixed: 0, variable: r.cost, total: r.cost }
      return {
        key: r.id,
        label: `${truck?.plateNumber ?? r.truckId} · ${t('planner.round')} ${r.round}`,
        partnerId: truck?.partnerId ?? '',
        truckId: r.truckId,
        routes: 1,
        distanceKm: r.distanceKm,
        m3: r.totalM3,
        kg: r.totalKg,
        fixed: bd.fixed,
        variable: bd.variable,
        total: bd.total,
      }
    })
    if (tab === 'route') return routes

    const groupKey = tab === 'truck' ? 'truckId' : 'partnerId'
    const groups = new Map<string, (typeof routes)[number]>()
    for (const r of routes) {
      const k = r[groupKey]
      const g = groups.get(k)
      if (!g) {
        const label =
          tab === 'truck'
            ? (truckById.get(k)?.plateNumber ?? k)
            : (partnerById.get(k)?.name ?? '—')
        groups.set(k, { ...r, key: k, label })
      } else {
        g.routes += r.routes
        g.distanceKm += r.distanceKm
        g.m3 += r.m3
        g.kg += r.kg
        g.fixed += r.fixed
        g.variable += r.variable
        g.total += r.total
      }
    }
    return [...groups.values()].sort((a, b) => b.total - a.total)
  }, [plan, tab, truckById, partnerById, t])

  const totals = rows.reduce(
    (acc, r) => ({
      routes: acc.routes + r.routes,
      distanceKm: acc.distanceKm + r.distanceKm,
      m3: acc.m3 + r.m3,
      kg: acc.kg + r.kg,
      fixed: acc.fixed + r.fixed,
      variable: acc.variable + r.variable,
      total: acc.total + r.total,
    }),
    { routes: 0, distanceKm: 0, m3: 0, kg: 0, fixed: 0, variable: 0, total: 0 },
  )

  const tabs: { id: Tab; label: string }[] = [
    { id: 'partner', label: t('costs.byPartner') },
    { id: 'truck', label: t('costs.byTruck') },
    { id: 'route', label: t('costs.byRoute') },
  ]

  // Price the whole plan under every transporter's rate card (cheapest first).
  const comparison = useMemo(
    () => (plan ? planCostByPartner(plan.routes, truckById, partners) : []),
    [plan, truckById, partners],
  )
  const cheapest = comparison[0]?.total ?? 0
  const current = comparison.find((c) => plan?.routes.some((r) => truckById.get(r.truckId)?.partnerId === c.partner.id))?.total

  // Where the money goes + the biggest routes.
  const composition = useMemo(() => (plan ? planCostComposition(plan.routes, truckById, partners) : null), [plan, truckById, partners])
  const routeCosts = useMemo(() => {
    if (!plan) return []
    return plan.routes.filter((r) => r.stops.length > 0).map((r) => {
      const tr = truckById.get(r.truckId)
      const bd = tr ? routeCostBreakdown(r, tr, partnerById.get(tr.partnerId)) : { total: r.cost }
      return { id: r.id, label: tr?.plateNumber ?? r.truckId, total: bd.total, colorIndex: r.colorIndex, km: r.distanceKm, m3: r.totalM3 }
    }).sort((a, b) => b.total - a.total)
  }, [plan, truckById, partnerById])

  const planTotal = composition?.total ?? 0
  const planM3 = plan?.routes.reduce((s, r) => s + r.totalM3, 0) ?? 0
  const planKm = plan?.routes.reduce((s, r) => s + r.distanceKm, 0) ?? 0
  const planTrips = plan?.routes.reduce((s, r) => s + (r.stops.length ? Math.max(1, r.roundsPerDay ?? 1) : 0), 0) ?? 0

  return (
    <div>
      <PageHeader
        title={t('costs.title')}
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              exportToExcel({ partners, trucks, locations, plan, depotName: settings.depotName })
            }
          >
            <FileSpreadsheet size={16} /> {t('common.exportExcel')}
          </Button>
        }
      />

      {!plan ? (
        <Card className="p-8 flex items-center gap-3 text-slate-500">
          <Info size={20} />
          {t('costs.noPlan')}
        </Card>
      ) : (
        <>
          {/* Hero cost KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
            <Kpi primary label={t('costs.dailyTotal')} value={`฿${fmt(planTotal)}`} sub={`${planTrips} ${t('dashboard.trips')} · ${totals.routes} ${t('costs.routesCount').toLowerCase()}`} />
            <Kpi label={t('costs.monthlyEstimate')} value={`฿${fmt(planTotal * WORKDAYS)}`} sub={`×${WORKDAYS} ${t('dashboard.day')}`} />
            <Kpi label={t('costs.costPerM3')} value={`฿${fmt(planM3 > 0 ? planTotal / planM3 : 0)}`} sub={`${planM3.toFixed(1)} ${t('common.m3')}`} />
            <Kpi label={`${t('common.baht')}/${t('common.km')}`} value={`฿${(planKm > 0 ? planTotal / planKm : 0).toFixed(1)}`} sub={`${fmt(planKm)} ${t('common.km')}`} />
            <Kpi label={`${t('common.baht')}/${t('dashboard.trips').replace(/s$/, '')}`} value={`฿${fmt(planTrips > 0 ? planTotal / planTrips : 0)}`} sub={`${planTrips} ${t('dashboard.trips')}`} />
            <Kpi label={t('costs.vsCheapest')} value={current && cheapest && current > cheapest ? `+${((current / cheapest - 1) * 100).toFixed(1)}%` : t('costs.best')}
              sub={comparison[0] ? `${t('costs.best')}: ${comparison[0].partner.name}` : ''} tone={current && cheapest && current > cheapest ? 'amber' : 'green'} />
          </div>

          {/* Cost composition + biggest routes */}
          {composition && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <Card className="p-5">
                <h2 className="font-semibold text-slate-900 mb-1">{t('costs.composition')}</h2>
                <p className="text-xs text-slate-500 mb-4">{t('costs.compositionNote')}</p>
                <div className="flex h-5 gap-0.5 mb-4">
                  {COMP.map((c) => {
                    const v = composition[c.key]
                    return v > 0 ? <div key={c.key} className="first:rounded-l-lg last:rounded-r-lg" title={`${t('costs.comp.' + c.key)} ฿${fmt(v)}`} style={{ width: `${(v / composition.total) * 100}%`, background: c.color }} /> : null
                  })}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {COMP.filter((c) => composition[c.key] > 0).map((c) => (
                    <div key={c.key} className="flex items-center gap-2 text-sm">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c.color }} />
                      <span className="text-slate-600 flex-1">{t('costs.comp.' + c.key)}</span>
                      <span className="text-slate-800 tabular-nums font-medium">฿{fmt(composition[c.key])}</span>
                      <span className="text-slate-400 tabular-nums text-xs w-9 text-right">{Math.round((composition[c.key] / composition.total) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="font-semibold text-slate-900 mb-1">{t('costs.byRouteChart')}</h2>
                <p className="text-xs text-slate-500 mb-4">{t('costs.byRouteChartNote')}</p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {routeCosts.map((r) => (
                    <div key={r.id} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
                      <span className="flex items-center gap-2 text-slate-700 truncate">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ROUTE_COLORS[r.colorIndex % ROUTE_COLORS.length] }} />
                        <span className="truncate">{r.label}</span>
                      </span>
                      <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.total / routeCosts[0].total) * 100}%` }} />
                      </div>
                      <span className="text-slate-700 tabular-nums whitespace-nowrap font-medium">฿{fmt(r.total)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          <div className="flex gap-2 mb-4">
            {tabs.map((tb) => (
              <Button
                key={tb.id}
                variant={tab === tb.id ? 'primary' : 'secondary'}
                onClick={() => setTab(tb.id)}
              >
                {tb.label}
              </Button>
            ))}
          </div>

          <Card>
            <Table
              headers={[
                tab === 'route' ? t('dashboard.route') : tab === 'truck' ? t('costs.truck') : t('costs.partner'),
                t('costs.routesCount'),
                `${t('planner.distance')} (${t('common.km')})`,
                t('common.m3'),
                t('common.kg'),
                `${t('costs.fixed')} (${t('common.baht')})`,
                `${t('costs.variable')} (${t('common.baht')})`,
                `${t('costs.totalCost')} (${t('common.baht')})`,
                t('costs.costPerM3'),
              ]}
            >
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{r.label}</td>
                  <td className="px-4 py-3 text-center">{r.routes}</td>
                  <td className="px-4 py-3">{fmt(r.distanceKm)}</td>
                  <td className="px-4 py-3">{r.m3.toFixed(1)}</td>
                  <td className="px-4 py-3">{fmt(r.kg)}</td>
                  <td className="px-4 py-3">{fmt(r.fixed)}</td>
                  <td className="px-4 py-3">{fmt(r.variable)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{fmt(r.total)}</td>
                  <td className="px-4 py-3 text-slate-500">{r.m3 > 0 ? fmt(r.total / r.m3) : '—'}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold text-slate-900 border-t-2 border-slate-200">
                <td className="px-4 py-3">{t('common.total')}</td>
                <td className="px-4 py-3 text-center">{totals.routes}</td>
                <td className="px-4 py-3">{fmt(totals.distanceKm)}</td>
                <td className="px-4 py-3">{totals.m3.toFixed(1)}</td>
                <td className="px-4 py-3">{fmt(totals.kg)}</td>
                <td className="px-4 py-3">{fmt(totals.fixed)}</td>
                <td className="px-4 py-3">{fmt(totals.variable)}</td>
                <td className="px-4 py-3">{fmt(totals.total)}</td>
                <td className="px-4 py-3">{totals.m3 > 0 ? fmt(totals.total / totals.m3) : '—'}</td>
              </tr>
            </Table>
          </Card>

          {comparison.length > 1 && (
            <Card className="mt-4">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-800">{t('costs.compareTitle')}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{t('costs.compareHint')}</p>
              </div>
              <Table headers={[t('costs.partner'), `${t('costs.dailyTotal')} (${t('common.baht')})`, `${t('costs.monthlyEstimate')} (${t('common.baht')})`, t('costs.vsCheapest')]}>
                {comparison.map((c, i) => (
                  <tr key={c.partner.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {c.partner.name}
                      {i === 0 && <Badge tone="green">{t('costs.best')}</Badge>}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{fmt(c.total)}</td>
                    <td className="px-4 py-3 text-slate-500">{fmt(c.total * 22)}</td>
                    <td className="px-4 py-3">
                      {i === 0 ? <span className="text-emerald-600">—</span> : (
                        <span className="text-rose-600">+{fmt(c.total - cheapest)} (+{((c.total / cheapest - 1) * 100).toFixed(1)}%)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, primary, tone }: { label: string; value: string; sub?: string; primary?: boolean; tone?: 'green' | 'amber' }) {
  return (
    <div className={`rounded-xl border shadow-sm p-4 ${primary ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-slate-200'}`}>
      <div className={`text-xs font-medium mb-2 ${primary ? 'text-white/80' : 'text-slate-500'}`}>{label}</div>
      <p className={`text-xl font-bold tabular-nums leading-none ${primary ? 'text-white' : tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className={`text-[11px] mt-1.5 truncate ${primary ? 'text-white/70' : 'text-slate-400'}`}>{sub}</p>}
    </div>
  )
}
