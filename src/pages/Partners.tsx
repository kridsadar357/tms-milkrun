import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { newId, useTms } from '../store'
import {
  Badge, Button, Card, EmptyRow, Field, Modal, PageHeader, Stat, Table, inputClass,
} from '../components/ui'
import type { RateCard, TransportPartner } from '../types'

const emptyForm = {
  code: '', name: '', contactPerson: '', phone: '', email: '', active: true,
  ratePerKm: '0', ratePerTrip: '0', minCharge: '0', creditDays: '30',
  bankName: '', bankAccountNo: '', bankAccountName: '',
}

/** Rate-card fields (key, numeric step). adminPct is edited as a percentage. */
const RATE_FIELDS: [keyof RateCard, string][] = [
  ['laborPerHr', '1'], ['otPerHr', '1'], ['dropCost', '5'], ['allowancePerKm', '0.1'], ['tripSafety', '1'],
  ['fuelKmPerL', '0.1'], ['fuelRatePerL', '0.1'], ['otherPerDay', '10'], ['adminPct', '0.5'],
]
type RateForm = Record<string, Record<string, string>>

export default function Partners() {
  const { t } = useTranslation()
  const { partners, trucks, upsertPartner, deletePartner } = useTms()
  const [editing, setEditing] = useState<TransportPartner | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [rate, setRate] = useState<RateForm>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const truckCount = (id: string) => trucks.filter((tr) => tr.partnerId === id).length

  // Truck types that can have a rate card: those in the fleet + any already on
  // the partner, falling back to the common 6W / 10W pair.
  const rateTypes = useMemo(() => {
    const set = new Set<string>(trucks.map((tr) => tr.type))
    if (editing && editing !== 'new') Object.keys(editing.costProfile ?? {}).forEach((k) => set.add(k))
    if (set.size === 0) return ['6W', '10W']
    return [...set]
  }, [trucks, editing])

  const open = (p: TransportPartner | 'new') => {
    setErrors({})
    const rf: RateForm = {}
    if (p !== 'new' && p.costProfile) {
      for (const [ty, c] of Object.entries(p.costProfile)) {
        rf[ty] = Object.fromEntries(RATE_FIELDS.map(([k]) => [k, String(k === 'adminPct' ? c[k] * 100 : c[k])]))
      }
    }
    setRate(rf)
    setForm(
      p === 'new'
        ? emptyForm
        : {
            code: p.code, name: p.name, contactPerson: p.contactPerson, phone: p.phone,
            email: p.email, active: p.active,
            ratePerKm: String(p.ratePerKm), ratePerTrip: String(p.ratePerTrip),
            minCharge: String(p.minCharge), creditDays: String(p.creditDays),
            bankName: p.bankName ?? '', bankAccountNo: p.bankAccountNo ?? '',
            bankAccountName: p.bankAccountName ?? '',
          },
    )
    setEditing(p)
  }

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!form.code.trim()) errs.code = t('common.required')
    if (!form.name.trim()) errs.name = t('common.required')
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    // Build the rate card, keeping only truck types with a meaningful entry.
    const costProfile: Record<string, RateCard> = {}
    for (const [ty, c] of Object.entries(rate)) {
      const n = (k: keyof RateCard) => Math.max(0, Number(c[k]) || 0)
      const card: RateCard = {
        laborPerHr: n('laborPerHr'), otPerHr: n('otPerHr'), dropCost: n('dropCost'),
        allowancePerKm: n('allowancePerKm'), tripSafety: n('tripSafety'),
        fuelKmPerL: n('fuelKmPerL') || 4.5, fuelRatePerL: n('fuelRatePerL') || 31.73,
        otherPerDay: n('otherPerDay'), adminPct: n('adminPct') / 100,
      }
      if (card.laborPerHr || card.allowancePerKm || card.dropCost || card.otherPerDay) costProfile[ty] = card
    }

    upsertPartner({
      id: editing === 'new' || !editing ? newId() : editing.id,
      code: form.code.trim(),
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      active: form.active,
      ratePerKm: Math.max(0, Number(form.ratePerKm) || 0),
      ratePerTrip: Math.max(0, Number(form.ratePerTrip) || 0),
      minCharge: Math.max(0, Number(form.minCharge) || 0),
      creditDays: Math.max(0, Math.round(Number(form.creditDays) || 0)),
      costProfile: Object.keys(costProfile).length ? costProfile : undefined,
      bankName: form.bankName.trim(),
      bankAccountNo: form.bankAccountNo.trim(),
      bankAccountName: form.bankAccountName.trim(),
    })
    setEditing(null)
  }

  return (
    <div>
      <PageHeader
        title={t('partners.title')}
        actions={
          <Button onClick={() => open('new')}>
            <Plus size={16} /> {t('common.add')}
          </Button>
        }
      />

      {(() => {
        const withCard = partners.filter((p) => p.costProfile && Object.keys(p.costProfile).length > 0)
        const assigned = trucks.filter((tr) => partners.some((p) => p.id === tr.partnerId)).length
        const avgCredit = partners.length ? Math.round(partners.reduce((s, p) => s + p.creditDays, 0) / partners.length) : 0
        const cheap6 = withCard.map((p) => {
          const c = p.costProfile!['6W']
          return c ? { name: p.name, km: (c.fuelKmPerL > 0 ? c.fuelRatePerL / c.fuelKmPerL : 0) + c.allowancePerKm } : null
        }).filter((x): x is { name: string; km: number } => !!x).sort((a, b) => a.km - b.km)[0]
        return partners.length === 0 ? null : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
            <Stat primary label={t('partners.title')} value={String(partners.length)} sub={`${partners.filter((p) => p.active).length} ${t('common.active').toLowerCase()}`} />
            <Stat label={t('partners.rateCardMilkrun')} value={`${withCard.length}/${partners.length}`} tone={withCard.length > 0 ? 'green' : undefined} />
            <Stat label={t('partners.trucksCount')} value={String(assigned)} />
            <Stat label={t('partners.creditDays')} value={`${avgCredit}`} sub={t('dashboard.day')} />
            {cheap6 && <Stat label={`${t('costs.best')} 6W ฿/${t('common.km')}`} value={`฿${cheap6.km.toFixed(2)}`} sub={cheap6.name} tone="green" />}
          </div>
        )
      })()}

      <Card>
        <Table
          headers={[
            t('partners.code'), t('partners.name'), t('partners.contact'), t('partners.phone'),
            t('partners.email'), t('partners.trucksCount'), t('partners.creditDays'),
            t('common.status'), t('common.actions'),
          ]}
        >
          {partners.length === 0 && <EmptyRow colSpan={9} message={t('common.noData')} />}
          {partners.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-800">{p.code}</td>
              <td className="px-4 py-3 text-slate-800">{p.name}</td>
              <td className="px-4 py-3 text-slate-600">{p.contactPerson}</td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{p.phone}</td>
              <td className="px-4 py-3 text-slate-600">{p.email}</td>
              <td className="px-4 py-3 text-center">{truckCount(p.id)}</td>
              <td className="px-4 py-3 text-center">{p.creditDays}</td>
              <td className="px-4 py-3">
                <Badge tone={p.active ? 'green' : 'red'}>
                  {p.active ? t('common.active') : t('common.inactive')}
                </Badge>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <Button variant="ghost" onClick={() => open(p)} aria-label={t('common.edit')}>
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => confirm(t('common.confirmDelete')) && deletePartner(p.id)}
                  aria-label={t('common.delete')}
                >
                  <Trash2 size={15} />
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {editing && (
        <Modal
          title={`${editing === 'new' ? t('common.add') : t('common.edit')} — ${t('partners.title')}`}
          onClose={() => setEditing(null)}
          wide
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('partners.code')} error={errors.code}>
              <input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label={t('partners.name')} error={errors.name}>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('partners.contact')}>
              <input className={inputClass} value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            </Field>
            <Field label={t('partners.phone')}>
              <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label={t('partners.email')}>
              <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              {t('common.active')}
            </label>
          </div>

          <fieldset className="mt-5">
            <legend className="text-sm font-semibold text-slate-800 mb-1">{t('partners.rateCard')}</legend>
            <p className="text-xs text-slate-500 mb-3">{t('partners.rateHint')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label={t('partners.ratePerKm')}>
                <input className={inputClass} type="number" min="0" step="0.5" value={form.ratePerKm} onChange={(e) => setForm({ ...form, ratePerKm: e.target.value })} />
              </Field>
              <Field label={t('partners.ratePerTrip')}>
                <input className={inputClass} type="number" min="0" step="50" value={form.ratePerTrip} onChange={(e) => setForm({ ...form, ratePerTrip: e.target.value })} />
              </Field>
              <Field label={t('partners.minCharge')}>
                <input className={inputClass} type="number" min="0" step="100" value={form.minCharge} onChange={(e) => setForm({ ...form, minCharge: e.target.value })} />
              </Field>
              <Field label={t('partners.creditDays')}>
                <input className={inputClass} type="number" min="0" step="1" value={form.creditDays} onChange={(e) => setForm({ ...form, creditDays: e.target.value })} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-semibold text-slate-800 mb-3">{t('partners.bank')}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label={t('partners.bankName')}>
                <input className={inputClass} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
              </Field>
              <Field label={t('partners.bankAccountNo')}>
                <input className={inputClass} value={form.bankAccountNo} onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })} />
              </Field>
              <Field label={t('partners.bankAccountName')}>
                <input className={inputClass} value={form.bankAccountName} onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-semibold text-slate-800 mb-1">{t('partners.rateCardMilkrun')}</legend>
            <p className="text-xs text-slate-500 mb-3">{t('partners.rateCardMilkrunHint')}</p>
            {rateTypes.map((ty) => (
              <div key={ty} className="mb-4 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-brand-600 mb-2">{ty}</div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {RATE_FIELDS.map(([k, step]) => (
                    <Field key={k} label={t(`partners.rc.${k}`)}>
                      <input
                        className={inputClass}
                        type="number"
                        min="0"
                        step={step}
                        value={rate[ty]?.[k] ?? ''}
                        onChange={(e) => setRate((pr) => ({ ...pr, [ty]: { ...pr[ty], [k]: e.target.value } }))}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>

          <div className="flex justify-end gap-2 mt-6">
            <Button variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button onClick={submit}>{t('common.save')}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
