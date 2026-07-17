import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { useTms } from '../store'

export interface AlertItem {
  key: string
  tone: 'red' | 'amber' | 'blue'
  text: string
  page: string
}

/** Derive live operational alerts from the current store state. */
export function useAlerts(): AlertItem[] {
  const { billings, plan, incidents, drivers, pods } = useTms()
  const { t } = useTranslation()
  const today = new Date().toISOString().slice(0, 10)

  return useMemo(() => {
    const items: AlertItem[] = []
    const overdue = billings.filter((b) => b.status !== 'paid' && b.dueDate < today)
    if (overdue.length)
      items.push({ key: 'overdue', tone: 'red', page: 'payments', text: t('alerts.overdueInvoices', { n: overdue.length }) })

    const unassigned = plan?.unassignedLocationIds.length ?? 0
    if (unassigned)
      items.push({ key: 'unassigned', tone: 'amber', page: 'planner', text: t('alerts.unassignedStops', { n: unassigned }) })

    const highOpen = incidents.filter((i) => !i.resolved && i.severity === 'high')
    if (highOpen.length)
      items.push({ key: 'high', tone: 'red', page: 'incidents', text: t('alerts.highIncidents', { n: highOpen.length }) })

    const open = incidents.filter((i) => !i.resolved && i.severity !== 'high')
    if (open.length)
      items.push({ key: 'open', tone: 'amber', page: 'incidents', text: t('alerts.openIncidents', { n: open.length }) })

    const failed = pods.filter((p) => p.status === 'failed')
    if (failed.length)
      items.push({ key: 'failed', tone: 'red', page: 'operations', text: t('alerts.failedPods', { n: failed.length }) })

    const inTransit = (plan?.routes ?? []).filter((r) => r.status === 'in-transit' || r.status === 'dispatched')
    if (inTransit.length)
      items.push({ key: 'transit', tone: 'blue', page: 'operations', text: t('alerts.inTransit', { n: inTransit.length }) })

    const noTruck = drivers.filter((d) => d.active && !d.truckId)
    if (noTruck.length)
      items.push({ key: 'notruck', tone: 'amber', page: 'drivers', text: t('alerts.driversNoTruck', { n: noTruck.length }) })

    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billings, plan, incidents, drivers, pods, t])
}

const TONE_DOT: Record<AlertItem['tone'], string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  blue: 'bg-brand-500',
}

export default function AlertCenter({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { t } = useTranslation()
  const alerts = useAlerts()
  const [open, setOpen] = useState(false)
  const hasRed = alerts.some((a) => a.tone === 'red')

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg hover:bg-slate-800/60 text-slate-300 hover:text-white cursor-pointer transition-colors"
        aria-label={t('alerts.title')}
      >
        <Bell size={18} />
        {alerts.length > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold text-white flex items-center justify-center ${hasRed ? 'bg-red-500' : 'bg-amber-500'}`}
          >
            {alerts.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-slate-800 text-sm">
              {t('alerts.title')}
            </div>
            {alerts.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-400 text-center">{t('alerts.empty')}</div>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {alerts.map((a) => (
                  <li key={a.key}>
                    <button
                      onClick={() => {
                        onNavigate(a.page)
                        setOpen(false)
                      }}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-2.5 hover:bg-slate-50 cursor-pointer text-sm text-slate-700"
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[a.tone]}`} />
                      {a.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
