import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { newId, useTms } from '../store'
import { exportCsv } from '../lib/csv'
import {
  Badge, Button, Card, EmptyRow, Field, Modal, PageHeader, Table, inputClass,
} from '../components/ui'
import type { Driver } from '../types'

const LICENSE_TYPES = ['ท.1', 'ท.2', 'ท.3', 'ท.4', 'บ.2', 'บ.3']

const emptyForm = {
  code: '', name: '', nameTh: '', licenseNo: '', licenseType: 'ท.2',
  phone: '', truckId: '', active: true,
}

export default function Drivers() {
  const { t, i18n } = useTranslation()
  const { drivers, trucks, upsertDriver, deleteDriver } = useTms()
  const [editing, setEditing] = useState<Driver | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const truckPlate = (id: string | null) =>
    id ? (trucks.find((tr) => tr.id === id)?.plateNumber ?? '—') : t('drivers.unassigned')

  const open = (d: Driver | 'new') => {
    setErrors({})
    setForm(
      d === 'new'
        ? emptyForm
        : {
            code: d.code, name: d.name, nameTh: d.nameTh, licenseNo: d.licenseNo,
            licenseType: d.licenseType, phone: d.phone, truckId: d.truckId ?? '', active: d.active,
          },
    )
    setEditing(d)
  }

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!form.code.trim()) errs.code = t('common.required')
    if (!form.name.trim()) errs.name = t('common.required')
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    upsertDriver({
      id: editing === 'new' || !editing ? newId() : editing.id,
      code: form.code.trim(),
      name: form.name.trim(),
      nameTh: form.nameTh.trim(),
      licenseNo: form.licenseNo.trim(),
      licenseType: form.licenseType,
      phone: form.phone.trim(),
      truckId: form.truckId || null,
      active: form.active,
    })
    setEditing(null)
  }

  const exportRows = () =>
    exportCsv(
      `tms-drivers-${new Date().toISOString().slice(0, 10)}`,
      ['Code', 'Name', 'NameTH', 'LicenseNo', 'LicenseType', 'Phone', 'Truck', 'Active'],
      drivers.map((d) => [
        d.code, d.name, d.nameTh, d.licenseNo, d.licenseType, d.phone,
        truckPlate(d.truckId), d.active,
      ]),
    )

  return (
    <div>
      <PageHeader
        title={t('drivers.title')}
        actions={
          <>
            {drivers.length > 0 && (
              <Button variant="secondary" onClick={exportRows}>
                <FileDown size={16} /> {t('common.exportCsv')}
              </Button>
            )}
            <Button onClick={() => open('new')}>
              <Plus size={16} /> {t('common.add')}
            </Button>
          </>
        }
      />

      <Card>
        <Table
          headers={[
            t('drivers.code'), t('drivers.name'), t('drivers.licenseNo'), t('drivers.licenseType'),
            t('drivers.phone'), t('drivers.truck'), t('common.status'), t('common.actions'),
          ]}
        >
          {drivers.length === 0 && <EmptyRow colSpan={8} message={t('common.noData')} />}
          {drivers.map((d) => (
            <tr key={d.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{d.code}</td>
              <td className="px-4 py-3">
                <div className="text-slate-800">{i18n.language === 'th' ? d.nameTh || d.name : d.name}</div>
                <div className="text-xs text-slate-400">{i18n.language === 'th' ? d.name : d.nameTh}</div>
              </td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{d.licenseNo}</td>
              <td className="px-4 py-3"><Badge tone="slate">{d.licenseType}</Badge></td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{d.phone}</td>
              <td className="px-4 py-3">
                {d.truckId ? (
                  <Badge tone="blue">{truckPlate(d.truckId)}</Badge>
                ) : (
                  <span className="text-slate-400 text-xs">{t('drivers.unassigned')}</span>
                )}
              </td>
              <td className="px-4 py-3">
                <Badge tone={d.active ? 'green' : 'red'}>
                  {d.active ? t('common.active') : t('common.inactive')}
                </Badge>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <Button variant="ghost" onClick={() => open(d)} aria-label={t('common.edit')}>
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => confirm(t('common.confirmDelete')) && deleteDriver(d.id)}
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
          title={`${editing === 'new' ? t('common.add') : t('common.edit')} — ${t('drivers.title')}`}
          onClose={() => setEditing(null)}
          wide
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('drivers.code')} error={errors.code}>
              <input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label={t('drivers.truck')}>
              <select className={inputClass} value={form.truckId} onChange={(e) => setForm({ ...form, truckId: e.target.value })}>
                <option value="">{t('drivers.unassigned')}</option>
                {trucks.map((tr) => <option key={tr.id} value={tr.id}>{tr.plateNumber}</option>)}
              </select>
            </Field>
            <Field label={t('drivers.name')} error={errors.name}>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('drivers.nameTh')}>
              <input className={inputClass} value={form.nameTh} onChange={(e) => setForm({ ...form, nameTh: e.target.value })} />
            </Field>
            <Field label={t('drivers.licenseNo')}>
              <input className={inputClass} value={form.licenseNo} onChange={(e) => setForm({ ...form, licenseNo: e.target.value })} />
            </Field>
            <Field label={t('drivers.licenseType')}>
              <select className={inputClass} value={form.licenseType} onChange={(e) => setForm({ ...form, licenseType: e.target.value })}>
                {LICENSE_TYPES.map((lt) => <option key={lt} value={lt}>{lt}</option>)}
              </select>
            </Field>
            <Field label={t('drivers.phone')}>
              <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              {t('common.active')}
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button onClick={submit}>{t('common.save')}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
