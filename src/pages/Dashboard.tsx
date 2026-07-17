import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Banknote, Gauge, Info, Leaf, MapPin, Route as RouteIcon, Ruler, Truck as TruckIcon } from 'lucide-react'
import { useTms } from '../store'
import { estimateCo2Kg } from '../types'
import { ROUTE_COLORS } from '../components/MapView'
import { Card, PageHeader } from '../components/ui'
import type { ReactNode } from 'react'

export default function Dashboard() {
  const { t, i18n } = useTranslation()
  const { plan, trucks, locations, partners, settings } = useTms()

  const truckById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks])
  const fmt = (n: number) =>
    n.toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-US', { maximumFractionDigits: 0 })

  const routes = plan?.routes ?? []
  const totalDistance = routes.reduce((s, r) => s + r.distanceKm, 0)
  const totalCost = routes.reduce((s, r) => s + r.cost, 0)
  const totalCo2 = routes.reduce((s, r) => s + estimateCo2Kg(r.distanceKm, settings), 0)

  const utilRows = routes.map((r) => {
    const truck = truckById.get(r.truckId)
    return {
      id: r.id,
      label: `${truck?.plateNumber ?? r.truckId} · R${r.round}`,
      pct: truck ? Math.min(100, Math.round((r.totalM3 / truck.capacityM3) * 100)) : 0,
      colorIndex: r.colorIndex,
    }
  })
  const avgUtil = utilRows.length
    ? Math.round(utilRows.reduce((s, r) => s + r.pct, 0) / utilRows.length)
    : 0

  const costByPartner = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of routes) {
      const truck = truckById.get(r.truckId)
      const pid = truck?.partnerId ?? ''
      map.set(pid, (map.get(pid) ?? 0) + r.cost)
    }
    return [...map.entries()]
      .map(([pid, cost]) => ({
        name: partners.find((p) => p.id === pid)?.name ?? '—',
        cost,
      }))
      .sort((a, b) => b.cost - a.cost)
  }, [routes, truckById, partners])
  const maxPartnerCost = Math.max(1, ...costByPartner.map((c) => c.cost))

  return (
    <div>
      <PageHeader title={t('dashboard.title')} />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4 mb-6">
        <Kpi icon={<MapPin size={18} />} label={t('dashboard.kpiLocations')} value={String(locations.filter((l) => l.active).length)} />
        <Kpi icon={<TruckIcon size={18} />} label={t('dashboard.kpiTrucks')} value={String(trucks.filter((tr) => tr.active).length)} />
        <Kpi icon={<RouteIcon size={18} />} label={t('dashboard.kpiRoutes')} value={String(routes.length)} />
        <Kpi icon={<Ruler size={18} />} label={t('dashboard.kpiDistance')} value={routes.length ? `${fmt(totalDistance)} ${t('common.km')}` : '—'} />
        <Kpi icon={<Banknote size={18} />} label={t('dashboard.kpiCost')} value={routes.length ? `${fmt(totalCost)} ${t('common.baht')}` : '—'} />
        <Kpi icon={<Leaf size={18} />} label={t('dashboard.kpiCo2')} value={routes.length ? `${fmt(totalCo2)} ${t('common.kg')}` : '—'} />
        <Kpi icon={<Gauge size={18} />} label={t('dashboard.kpiUtilization')} value={routes.length ? `${avgUtil}%` : '—'} />
      </div>

      {routes.length === 0 ? (
        <Card className="p-8 flex items-center gap-3 text-slate-500">
          <Info size={20} />
          {t('dashboard.noPlan')}
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Utilization per route — magnitude, single-scale bars; the color
              dot carries route identity consistent with the map. */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900">{t('dashboard.utilizationTitle')}</h2>
            <p className="text-xs text-slate-500 mb-4">{t('dashboard.utilizationHint')}</p>
            <div className="space-y-3">
              {utilRows.map((r) => (
                <div key={r.id} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3">
                  <span className="flex items-center gap-2 text-sm text-slate-700 truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: ROUTE_COLORS[r.colorIndex % ROUTE_COLORS.length] }}
                    />
                    <span className="truncate">{r.label}</span>
                  </span>
                  <div className="h-4 rounded-r bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-r bg-brand-500"
                      style={{ width: `${r.pct}%` }}
                    />
                  </div>
                  <span className="text-sm text-slate-600 text-right tabular-nums">{r.pct}%</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Cost by partner — magnitude, single hue */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 mb-4">{t('dashboard.costByPartner')}</h2>
            <div className="space-y-3">
              {costByPartner.map((c) => (
                <div key={c.name} className="grid grid-cols-[minmax(0,10rem)_1fr_6rem] items-center gap-3">
                  <span className="text-sm text-slate-700 truncate">{c.name}</span>
                  <div className="h-4 rounded-r bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-r bg-brand-500"
                      style={{ width: `${Math.round((c.cost / maxPartnerCost) * 100)}%` }}
                    />
                  </div>
                  <span className="text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">
                    {fmt(c.cost)} {t('common.baht')}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function Kpi({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-slate-400 mb-2">
        {icon}
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <p className="text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
    </Card>
  )
}
