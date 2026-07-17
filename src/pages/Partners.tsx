import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { newId, useTms } from '../store'
import {
  Badge, Button, Card, EmptyRow, Field, Modal, PageHeader, Table, inputClass,
} from '../components/ui'
import type { TransportPartner } from '../types'

const emptyForm = {
  code: '', name: '', contactPerson: '', phone: '', email: '', active: true,
  ratePerKm: '0', ratePerTrip: '0', minCharge: '0', creditDays: '30',
  bankName: '', bankAccountNo: '', bankAccountName: '',
}

export default function Partners() {
  const { t } = useTranslation()
  const { partners, trucks, upsertPartner, deletePartner } = useTms()
  const [editing, setEditing] = useState<TransportPartner | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const truckCount = (id: string) => trucks.filter((tr) => tr.partnerId === id).length

  const open = (p: TransportPartner | 'new') => {
    setErrors({})
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

          <div className="flex justify-end gap-2 mt-6">
            <Button variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button onClick={submit}>{t('common.save')}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
