import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Banknote, CheckCircle2, CircleAlert, FilePlus2, FileSpreadsheet, FileText, Pencil,
  Printer, Trash2,
} from 'lucide-react'
import { billingAmounts, useTms } from '../store'
import { exportBillingsToExcel } from '../lib/excel'
import { exportBankBatch } from '../lib/bank'
import { printInvoice, printStatement } from '../lib/documents'
import { Landmark } from 'lucide-react'
import {
  Badge, Button, Card, EmptyRow, Field, Modal, PageHeader, Table, inputClass,
} from '../components/ui'
import type { BillingRecord, BillingStatus } from '../types'
import type { ReactNode } from 'react'

const STATUS_TONE: Record<BillingStatus, 'slate' | 'blue' | 'green'> = {
  draft: 'slate',
  approved: 'blue',
  paid: 'green',
}

export default function Payments() {
  const { t, i18n } = useTranslation()
  const { billings, partners, plan, settings, createBillingsFromPlan, upsertBilling, deleteBilling } = useTms()
  const [editing, setEditing] = useState<BillingRecord | null>(null)
  const [detail, setDetail] = useState<BillingRecord | null>(null)
  const [form, setForm] = useState({ invoiceNo: '', fuelSurchargePct: '0', note: '' })
  const [toast, setToast] = useState<string | null>(null)
  const [statementOpen, setStatementOpen] = useState(false)

  const partnerById = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners])
  const locale = i18n.language === 'th' ? 'th-TH' : 'en-US'
  const fmt = (n: number) => n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(locale)
  const today = new Date().toISOString().slice(0, 10)

  const totals = useMemo(() => {
    let outstanding = 0
    let paidThisMonth = 0
    let totalBilled = 0
    let overdue = 0
    const month = today.slice(0, 7)
    for (const b of billings) {
      const { netPayable } = billingAmounts(b)
      totalBilled += netPayable
      if (b.status === 'paid') {
        if (b.paidDate?.startsWith(month)) paidThisMonth += netPayable
      } else {
        outstanding += netPayable
        if (b.dueDate < today) overdue += netPayable
      }
    }
    return { outstanding, paidThisMonth, totalBilled, overdue }
  }, [billings, today])

  const sorted = useMemo(
    () => [...billings].sort((a, b) => b.billingDate.localeCompare(a.billingDate) || b.invoiceNo.localeCompare(a.invoiceNo)),
    [billings],
  )

  const ar = useMemo(() => {
    const byStatus: Record<BillingStatus, { n: number; amt: number }> = {
      draft: { n: 0, amt: 0 }, approved: { n: 0, amt: 0 }, paid: { n: 0, amt: 0 },
    }
    const byPartner = new Map<string, number>()
    for (const b of billings) {
      const { netPayable } = billingAmounts(b)
      byStatus[b.status].n++; byStatus[b.status].amt += netPayable
      if (b.status !== 'paid') byPartner.set(b.partnerId, (byPartner.get(b.partnerId) ?? 0) + netPayable)
    }
    const partners = [...byPartner.entries()]
      .map(([pid, amt]) => ({ name: partnerById.get(pid)?.name ?? '—', amt }))
      .sort((a, b) => b.amt - a.amt)
    return { byStatus, partners, maxPartner: Math.max(1, ...partners.map((p) => p.amt)) }
  }, [billings, partnerById])

  const createFromPlan = () => {
    const n = createBillingsFromPlan()
    setToast(n > 0 ? `${n} ${t('payments.createdN')}` : t('payments.noPlanToBill'))
    setTimeout(() => setToast(null), 3000)
  }

  const openEdit = (b: BillingRecord) => {
    setForm({ invoiceNo: b.invoiceNo, fuelSurchargePct: String(b.fuelSurchargePct), note: b.note })
    setEditing(b)
  }

  const saveEdit = () => {
    if (!editing) return
    upsertBilling({
      ...editing,
      invoiceNo: form.invoiceNo.trim() || editing.invoiceNo,
      fuelSurchargePct: Math.max(0, Number(form.fuelSurchargePct) || 0),
      note: form.note,
    })
    setEditing(null)
  }

  const setStatus = (b: BillingRecord, status: BillingStatus) =>
    upsertBilling({ ...b, status, paidDate: status === 'paid' ? today : undefined })

  return (
    <div>
      <PageHeader
        title={t('payments.title')}
        actions={
          <>
            {billings.length > 0 && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const n = exportBankBatch(billings, partners)
                    setToast(n > 0 ? t('payments.bankBatchDone', { n }) : t('payments.bankBatchEmpty'))
                    setTimeout(() => setToast(null), 3000)
                  }}
                >
                  <Landmark size={16} /> {t('payments.bankBatch')}
                </Button>
                <Button variant="secondary" onClick={() => setStatementOpen(true)}>
                  <FileText size={16} /> {t('payments.statement')}
                </Button>
                <Button variant="secondary" onClick={() => exportBillingsToExcel(billings, partners)}>
                  <FileSpreadsheet size={16} /> {t('common.exportExcel')}
                </Button>
              </>
            )}
            <Button onClick={createFromPlan} disabled={!plan || plan.routes.length === 0}>
              <FilePlus2 size={16} /> {t('payments.createFromPlan')}
            </Button>
          </>
        }
      />

      {toast && (
        <Card className="p-3 mb-4 text-sm text-brand-700 bg-brand-50 border-brand-100">{toast}</Card>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Kpi icon={<Banknote size={18} />} label={t('payments.totalBilled')} value={`${fmt(totals.totalBilled)} ${t('common.baht')}`} />
        <Kpi icon={<CircleAlert size={18} />} label={t('payments.outstanding')} value={`${fmt(totals.outstanding)} ${t('common.baht')}`} />
        <Kpi
          icon={<CircleAlert size={18} />}
          label={t('payments.overdue')}
          value={`${fmt(totals.overdue)} ${t('common.baht')}`}
          alert={totals.overdue > 0}
        />
        <Kpi icon={<CheckCircle2 size={18} />} label={t('payments.paidThisMonth')} value={`${fmt(totals.paidThisMonth)} ${t('common.baht')}`} />
      </div>

      {billings.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Collection status */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 mb-1">{t('payments.collectionStatus')}</h2>
            <p className="text-xs text-slate-500 mb-4">{t('payments.collectionNote')}</p>
            {(() => {
              const total = ar.byStatus.draft.amt + ar.byStatus.approved.amt + ar.byStatus.paid.amt || 1
              const seg: [BillingStatus, string][] = [['paid', '#1baf7a'], ['approved', '#2a78d6'], ['draft', '#94a3b8']]
              return (
                <>
                  <div className="flex h-5 rounded-lg overflow-hidden mb-4">
                    {seg.map(([st, c]) => ar.byStatus[st].amt > 0 && (
                      <div key={st} style={{ width: `${(ar.byStatus[st].amt / total) * 100}%`, background: c }} title={`${t(`payments.statuses.${st}`)} ${fmt(ar.byStatus[st].amt)}`} />
                    ))}
                  </div>
                  <div className="space-y-2">
                    {seg.map(([st, c]) => (
                      <div key={st} className="flex items-center gap-2 text-sm">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c }} />
                        <span className="text-slate-600 flex-1">{t(`payments.statuses.${st}`)} <span className="text-slate-400">({ar.byStatus[st].n})</span></span>
                        <span className="text-slate-800 tabular-nums font-medium">{fmt(ar.byStatus[st].amt)} {t('common.baht')}</span>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </Card>

          {/* Outstanding by partner */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 mb-1">{t('payments.outstandingByPartner')}</h2>
            <p className="text-xs text-slate-500 mb-4">{t('payments.outstandingByPartnerNote')}</p>
            {ar.partners.length ? (
              <div className="space-y-2.5">
                {ar.partners.map((p) => (
                  <div key={p.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="text-slate-700 truncate">{p.name}</span>
                    <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-amber-500" style={{ width: `${(p.amt / ar.maxPartner) * 100}%` }} />
                    </div>
                    <span className="text-slate-800 tabular-nums whitespace-nowrap font-medium">{fmt(p.amt)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="py-8 text-center text-sm text-emerald-600">{t('payments.allCollected')}</p>}
          </Card>
        </div>
      )}

      <Card>
        <Table stickyActions
          headers={[
            t('payments.invoiceNo'), t('payments.partner'), t('payments.billingDate'), t('payments.dueDate'),
            t('payments.routes'), `${t('payments.subtotal')} (${t('common.baht')})`,
            `${t('payments.vat')} ${'7%'}`, `${t('payments.wht')} ${'1%'}`,
            `${t('payments.netPayable')} (${t('common.baht')})`,
            t('common.status'), t('common.actions'),
          ]}
        >
          {sorted.length === 0 && <EmptyRow colSpan={11} message={t('payments.noBillings')} />}
          {sorted.map((b) => {
            const a = billingAmounts(b)
            const isOverdue = b.status !== 'paid' && b.dueDate < today
            return (
              <tr key={b.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetail(b)} title={t('payments.viewDetail')}>
                <td className="px-4 py-3 font-medium text-brand-600 whitespace-nowrap underline decoration-transparent hover:decoration-inherit underline-offset-2">{b.invoiceNo}</td>
                <td className="px-4 py-3 text-slate-600">{partnerById.get(b.partnerId)?.name ?? '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap">{fmtDate(b.billingDate)}</td>
                <td className={`px-4 py-3 whitespace-nowrap ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
                  {fmtDate(b.dueDate)}
                </td>
                <td className="px-4 py-3 text-center">{b.routesCount}</td>
                <td className="px-4 py-3 tabular-nums">{fmt(b.subtotal)}</td>
                <td className="px-4 py-3 tabular-nums text-slate-500">{fmt(a.vat)}</td>
                <td className="px-4 py-3 tabular-nums text-slate-500">−{fmt(a.wht)}</td>
                <td className="px-4 py-3 tabular-nums font-semibold text-slate-900">{fmt(a.netPayable)}</td>
                <td className="px-4 py-3">
                  <Badge tone={STATUS_TONE[b.status]}>{t(`payments.statuses.${b.status}`)}</Badge>
                  {b.status === 'paid' && b.paidDate && (
                    <div className="text-[11px] text-slate-400 mt-0.5">{fmtDate(b.paidDate)}</div>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {b.status === 'draft' && (
                    <Button variant="secondary" className="!px-2.5 !py-1 text-xs" onClick={() => setStatus(b, 'approved')}>
                      {t('payments.approve')}
                    </Button>
                  )}
                  {b.status === 'approved' && (
                    <Button className="!px-2.5 !py-1 text-xs" onClick={() => setStatus(b, 'paid')}>
                      {t('payments.markPaid')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => printInvoice(b, partnerById.get(b.partnerId), settings)}
                    aria-label={t('payments.invoicePdf')}
                    title={t('payments.invoicePdf')}
                  >
                    <Printer size={15} />
                  </Button>
                  <Button variant="ghost" onClick={() => openEdit(b)} aria-label={t('common.edit')}>
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => confirm(t('common.confirmDelete')) && deleteBilling(b.id)}
                    aria-label={t('common.delete')}
                  >
                    <Trash2 size={15} />
                  </Button>
                </td>
              </tr>
            )
          })}
        </Table>
      </Card>

      <p className="text-xs text-slate-400 mt-3">{t('payments.taxNote')} · {t('payments.whtHint')}</p>

      {editing && (
        <Modal title={`${t('common.edit')} — ${editing.invoiceNo}`} onClose={() => setEditing(null)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('payments.invoiceNo')}>
              <input className={inputClass} value={form.invoiceNo} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} />
            </Field>
            <Field label={t('payments.fuelSurcharge')}>
              <input className={inputClass} type="number" min="0" step="0.5" value={form.fuelSurchargePct} onChange={(e) => setForm({ ...form, fuelSurchargePct: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('payments.note')}>
                <input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
            </div>
          </div>
          {/* live preview of recalculated amounts */}
          <PreviewAmounts record={{ ...editing, fuelSurchargePct: Math.max(0, Number(form.fuelSurchargePct) || 0) }} fmt={fmt} />
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button onClick={saveEdit}>{t('common.save')}</Button>
          </div>
        </Modal>
      )}

      {detail && (() => {
        const a = billingAmounts(detail)
        const partner = partnerById.get(detail.partnerId)
        const Row = ({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) => (
          <div className={`flex items-center justify-between gap-4 py-1.5 text-sm ${strong ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
            <span className="text-slate-500">{label}</span>
            <span className={`tabular-nums ${strong ? '' : 'text-slate-800'}`}>{value}</span>
          </div>
        )
        return (
          <Modal title={`${t('payments.viewDetail')} — ${detail.invoiceNo}`} onClose={() => setDetail(null)} wide>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <div>
                <div className="font-semibold text-slate-900">{partner?.name ?? '—'}</div>
                <div className="text-xs text-slate-500">{partner?.contactPerson} {partner?.phone ? `· ${partner.phone}` : ''}</div>
              </div>
              <Badge tone={STATUS_TONE[detail.status]}>{t(`payments.statuses.${detail.status}`)}</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              <div>
                <Row label={t('payments.billingDate')} value={fmtDate(detail.billingDate)} />
                <Row label={t('payments.dueDate')} value={fmtDate(detail.dueDate)} />
                {detail.status === 'paid' && detail.paidDate && <Row label={t('payments.statuses.paid')} value={fmtDate(detail.paidDate)} />}
                <Row label={t('payments.routes')} value={detail.routesCount} />
                <Row label={t('planner.distance')} value={`${fmt(detail.distanceKm)} ${t('common.km')}`} />
                <Row label={`${t('common.m3')} / ${t('common.kg')}`} value={`${detail.totalM3.toFixed(1)} / ${fmt(detail.totalKg)}`} />
              </div>
              <div className="rounded-xl border border-slate-200 p-4 mt-3 sm:mt-0">
                <Row label={t('payments.subtotal')} value={`฿${fmt(detail.subtotal)}`} />
                {detail.fuelSurchargePct > 0 && <Row label={`${t('payments.fuelSurcharge')} (${detail.fuelSurchargePct}%)`} value={`฿${fmt(a.base - detail.subtotal)}`} />}
                <Row label={`${t('payments.vat')} ${detail.vatPct}%`} value={`฿${fmt(a.vat)}`} />
                <Row label={`${t('payments.wht')} ${detail.whtPct}%`} value={`−฿${fmt(a.wht)}`} />
                <div className="border-t border-slate-200 mt-2 pt-2">
                  <Row label={t('payments.netPayable')} value={`฿${fmt(a.netPayable)}`} strong />
                </div>
              </div>
            </div>
            {detail.note && <div className="mt-4 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{detail.note}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="secondary" onClick={() => { printInvoice(detail, partner, settings) }}><Printer size={15} /> {t('payments.invoicePdf')}</Button>
              <Button variant="secondary" onClick={() => { setDetail(null); openEdit(detail) }}><Pencil size={15} /> {t('common.edit')}</Button>
              <Button onClick={() => setDetail(null)}>{t('common.cancel')}</Button>
            </div>
          </Modal>
        )
      })()}

      {statementOpen && (
        <StatementModal
          billings={billings}
          partners={partners}
          settings={settings}
          onClose={() => setStatementOpen(false)}
        />
      )}
    </div>
  )
}

function StatementModal({
  billings, partners, settings, onClose,
}: {
  billings: BillingRecord[]
  partners: import('../types').TransportPartner[]
  settings: import('../types').Settings
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const withBillings = useMemo(
    () => partners.filter((p) => billings.some((b) => b.partnerId === p.id)),
    [partners, billings],
  )
  const months = useMemo(
    () => [...new Set(billings.map((b) => b.billingDate.slice(0, 7)))].sort().reverse(),
    [billings],
  )
  const [partnerId, setPartnerId] = useState(withBillings[0]?.id ?? '')
  const [month, setMonth] = useState(months[0] ?? '')
  const [err, setErr] = useState('')

  const monthLabel = (ym: string) =>
    new Date(ym + '-01T00:00:00').toLocaleDateString(i18n.language === 'th' ? 'th-TH' : 'en-US', {
      year: 'numeric', month: 'long',
    })

  const generate = () => {
    const partner = partners.find((p) => p.id === partnerId)
    const rows = billings.filter((b) => b.partnerId === partnerId && b.billingDate.startsWith(month))
    if (!partner || rows.length === 0) {
      setErr(t('payments.noStatementData'))
      return
    }
    printStatement(partner, rows, monthLabel(month), settings)
    onClose()
  }

  return (
    <Modal title={t('payments.statement')} onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('payments.partner')}>
          <select className={inputClass} value={partnerId} onChange={(e) => { setPartnerId(e.target.value); setErr('') }}>
            {withBillings.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={t('payments.month')}>
          <select className={inputClass} value={month} onChange={(e) => { setMonth(e.target.value); setErr('') }}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </Field>
      </div>
      {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={generate}>{t('payments.generate')}</Button>
      </div>
    </Modal>
  )
}

function PreviewAmounts({ record, fmt }: { record: BillingRecord; fmt: (n: number) => string }) {
  const { t } = useTranslation()
  const a = billingAmounts(record)
  const rows: [string, string][] = [
    [t('payments.subtotal'), fmt(record.subtotal)],
    [`${t('payments.fuelSurcharge')}`, `${record.fuelSurchargePct}%`],
    [`${t('payments.vat')} ${record.vatPct}%`, fmt(a.vat)],
    [`${t('payments.wht')} ${record.whtPct}%`, `−${fmt(a.wht)}`],
    [t('payments.netPayable'), fmt(a.netPayable)],
  ]
  return (
    <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm space-y-1">
      {rows.map(([label, value], i) => (
        <div key={label} className={`flex justify-between ${i === rows.length - 1 ? 'font-semibold text-slate-900 border-t border-slate-200 pt-2 mt-2' : 'text-slate-600'}`}>
          <span>{label}</span>
          <span className="tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  )
}

function Kpi({ icon, label, value, alert = false }: { icon: ReactNode; label: string; value: string; alert?: boolean }) {
  return (
    <Card className={`p-4 ${alert ? 'border-red-200 bg-red-50' : ''}`}>
      <div className={`flex items-center gap-2 mb-2 ${alert ? 'text-red-500' : 'text-slate-400'}`}>
        {icon}
        <span className={`text-xs font-medium ${alert ? 'text-red-600' : 'text-slate-500'}`}>{label}</span>
      </div>
      <p className={`text-lg font-semibold tabular-nums ${alert ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
    </Card>
  )
}
