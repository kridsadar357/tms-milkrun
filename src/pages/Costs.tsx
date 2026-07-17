import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSpreadsheet, Info } from 'lucide-react'
import { useTms } from '../store'
import { exportToExcel } from '../lib/excel'
import { Badge, Button, Card, PageHeader, Table } from '../components/ui'

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
      const fixed = truck?.fixedCostPerRound ?? 0
      return {
        key: r.id,
        label: `${truck?.plateNumber ?? r.truckId} · ${t('planner.round')} ${r.round}`,
        partnerId: truck?.partnerId ?? '',
        truckId: r.truckId,
        routes: 1,
        distanceKm: r.distanceKm,
        m3: r.totalM3,
        kg: r.totalKg,
        fixed,
        variable: r.cost - fixed,
        total: r.cost,
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <Card className="p-5">
              <p className="text-sm text-slate-500 mb-1">{t('costs.dailyTotal')}</p>
              <p className="text-2xl font-semibold text-slate-900">
                {fmt(totals.total)} <span className="text-base font-normal text-slate-400">{t('common.baht')}</span>
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-sm text-slate-500 mb-1">{t('costs.monthlyEstimate')}</p>
              <p className="text-2xl font-semibold text-slate-900">
                {fmt(totals.total * 22)} <span className="text-base font-normal text-slate-400">{t('common.baht')}</span>
              </p>
              <Badge tone="slate">×22</Badge>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
