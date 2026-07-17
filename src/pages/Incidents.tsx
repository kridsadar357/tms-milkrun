import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { newId, useTms } from '../store'
import { exportCsv } from '../lib/csv'
import {
  Badge, Button, Card, EmptyRow, Field, Modal, PageHeader, Table, inputClass,
} from '../components/ui'
import type { Incident, IncidentSeverity, IncidentType } from '../types'

const TYPES: IncidentType[] = ['breakdown', 'delay', 'accident', 'damage', 'other']
const SEVERITIES: IncidentSeverity[] = ['low', 'medium', 'high']
const SEV_TONE: Record<IncidentSeverity, 'slate' | 'amber' | 'red'> = {
  low: 'slate', medium: 'amber', high: 'red',
}

const todayIso = () => new Date().toISOString().slice(0, 10)

const emptyForm = {
  date: '', type: 'breakdown' as IncidentType, severity: 'medium' as IncidentSeverity,
  truckId: '', description: '', resolved: false,
}

export default function Incidents() {
  const { t } = useTranslation()
  const { incidents, trucks, upsertIncident, deleteIncident } = useTms()
  const [editing, setEditing] = useState<Incident | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)

  const plate = (id: string | null) => (id ? trucks.find((tr) => tr.id === id)?.plateNumber ?? '—' : '—')

  const open = (inc: Incident | 'new') => {
    setForm(
      inc === 'new'
        ? { ...emptyForm, date: todayIso() }
        : {
            date: inc.date, type: inc.type, severity: inc.severity,
            truckId: inc.truckId ?? '', description: inc.description, resolved: inc.resolved,
          },
    )
    setEditing(inc)
  }

  const submit = () => {
    upsertIncident({
      id: editing === 'new' || !editing ? newId() : editing.id,
      date: form.date || todayIso(),
      type: form.type,
      severity: form.severity,
      truckId: form.truckId || null,
      routeId: editing !== 'new' && editing ? editing.routeId : null,
      description: form.description.trim(),
      resolved: form.resolved,
    })
    setEditing(null)
  }

  const sorted = [...incidents].sort((a, b) => b.date.localeCompare(a.date))

  const exportRows = () =>
    exportCsv(
      `tms-incidents-${todayIso()}`,
      ['Date', 'Type', 'Severity', 'Truck', 'Description', 'Resolved'],
      sorted.map((i) => [
        i.date, i.type, i.severity, plate(i.truckId), i.description, i.resolved,
      ]),
    )

  return (
    <div>
      <PageHeader
        title={t('incidents.title')}
        actions={
          <>
            {incidents.length > 0 && (
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
            t('incidents.date'), t('incidents.type'), t('incidents.severity'), t('incidents.truck'),
            t('incidents.description'), t('common.status'), t('common.actions'),
          ]}
        >
          {sorted.length === 0 && <EmptyRow colSpan={7} message={t('common.noData')} />}
          {sorted.map((inc) => (
            <tr key={inc.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 whitespace-nowrap">{inc.date}</td>
              <td className="px-4 py-3">{t(`incidents.types.${inc.type}`)}</td>
              <td className="px-4 py-3">
                <Badge tone={SEV_TONE[inc.severity]}>{t(`incidents.severities.${inc.severity}`)}</Badge>
              </td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{plate(inc.truckId)}</td>
              <td className="px-4 py-3 text-slate-600 max-w-md">{inc.description}</td>
              <td className="px-4 py-3">
                <Badge tone={inc.resolved ? 'green' : 'amber'}>
                  {inc.resolved ? t('incidents.resolved') : t('incidents.open')}
                </Badge>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <Button variant="ghost" onClick={() => open(inc)} aria-label={t('common.edit')}>
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => confirm(t('common.confirmDelete')) && deleteIncident(inc.id)}
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
          title={`${editing === 'new' ? t('common.add') : t('common.edit')} — ${t('incidents.title')}`}
          onClose={() => setEditing(null)}
          wide
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('incidents.date')}>
              <input type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label={t('incidents.truck')}>
              <select className={inputClass} value={form.truckId} onChange={(e) => setForm({ ...form, truckId: e.target.value })}>
                <option value="">{t('incidents.none')}</option>
                {trucks.map((tr) => <option key={tr.id} value={tr.id}>{tr.plateNumber}</option>)}
              </select>
            </Field>
            <Field label={t('incidents.type')}>
              <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as IncidentType })}>
                {TYPES.map((ty) => <option key={ty} value={ty}>{t(`incidents.types.${ty}`)}</option>)}
              </select>
            </Field>
            <Field label={t('incidents.severity')}>
              <select className={inputClass} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as IncidentSeverity })}>
                {SEVERITIES.map((sv) => <option key={sv} value={sv}>{t(`incidents.severities.${sv}`)}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('incidents.description')}>
                <input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.resolved} onChange={(e) => setForm({ ...form, resolved: e.target.checked })} />
              {t('incidents.resolved')}
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
