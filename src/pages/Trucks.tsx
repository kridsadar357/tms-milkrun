import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { newId, useTms } from '../store'
import {
  Badge, Button, Card, EmptyRow, Field, Modal, PageHeader, Table, inputClass,
} from '../components/ui'
import type { Truck, TruckType } from '../types'

const TYPES: TruckType[] = ['4W', '4WJ', '6W', '10W', 'Trailer']

/** Sensible capacity presets per truck type (editable after selection). */
const TYPE_PRESETS: Record<TruckType, { m3: number; kg: number }> = {
  '4W': { m3: 8, kg: 2000 },
  '4WJ': { m3: 12, kg: 2800 },
  '6W': { m3: 22, kg: 5500 },
  '10W': { m3: 38, kg: 12000 },
  Trailer: { m3: 60, kg: 25000 },
}

const emptyForm = {
  plateNumber: '', type: '6W' as TruckType, partnerId: '',
  capacityM3: '22', capacityKg: '5500', roundsPerDay: '1',
  fixedCostPerRound: '1200', costPerKm: '10', active: true,
}

export default function Trucks() {
  const { t, i18n } = useTranslation()
  const { trucks, partners, drivers, upsertTruck, deleteTruck } = useTms()
  const [editing, setEditing] = useState<Truck | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? '—'
  const driverName = (truckId: string) => {
    const d = drivers.find((dr) => dr.truckId === truckId)
    return d ? (i18n.language === 'th' ? d.nameTh || d.name : d.name) : '—'
  }

  const open = (truck: Truck | 'new') => {
    setErrors({})
    setForm(
      truck === 'new'
        ? { ...emptyForm, partnerId: partners[0]?.id ?? '' }
        : {
            plateNumber: truck.plateNumber, type: truck.type, partnerId: truck.partnerId,
            capacityM3: String(truck.capacityM3), capacityKg: String(truck.capacityKg),
            roundsPerDay: String(truck.roundsPerDay),
            fixedCostPerRound: String(truck.fixedCostPerRound), costPerKm: String(truck.costPerKm),
            active: truck.active,
          },
    )
    setEditing(truck)
  }

  const onTypeChange = (type: TruckType) => {
    const preset = TYPE_PRESETS[type]
    setForm({ ...form, type, capacityM3: String(preset.m3), capacityKg: String(preset.kg) })
  }

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!form.plateNumber.trim()) errs.plateNumber = t('common.required')
    if (!form.partnerId) errs.partnerId = t('common.required')
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    upsertTruck({
      id: editing === 'new' || !editing ? newId() : editing.id,
      plateNumber: form.plateNumber.trim(),
      type: form.type,
      partnerId: form.partnerId,
      capacityM3: Math.max(0.1, Number(form.capacityM3) || 1),
      capacityKg: Math.max(1, Number(form.capacityKg) || 1),
      roundsPerDay: Math.max(1, Math.round(Number(form.roundsPerDay) || 1)),
      fixedCostPerRound: Math.max(0, Number(form.fixedCostPerRound) || 0),
      costPerKm: Math.max(0, Number(form.costPerKm) || 0),
      active: form.active,
    })
    setEditing(null)
  }

  return (
    <div>
      <PageHeader
        title={t('trucks.title')}
        actions={
          <Button onClick={() => open('new')} disabled={partners.length === 0}>
            <Plus size={16} /> {t('common.add')}
          </Button>
        }
      />

      <Card>
        <Table
          headers={[
            t('trucks.plate'), t('trucks.type'), t('trucks.partner'), t('trucks.driver'),
            t('trucks.capacity'), t('trucks.roundsPerDay'), t('trucks.fixedCost'), t('trucks.costPerKm'),
            t('common.status'), t('common.actions'),
          ]}
        >
          {trucks.length === 0 && <EmptyRow colSpan={10} message={t('common.noData')} />}
          {trucks.map((tr) => (
            <tr key={tr.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{tr.plateNumber}</td>
              <td className="px-4 py-3"><Badge tone="slate">{tr.type}</Badge></td>
              <td className="px-4 py-3 text-slate-600">{partnerName(tr.partnerId)}</td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{driverName(tr.id)}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {tr.capacityM3} {t('common.m3')} · {tr.capacityKg.toLocaleString()} {t('common.kg')}
              </td>
              <td className="px-4 py-3 text-center">{tr.roundsPerDay}</td>
              <td className="px-4 py-3">{tr.fixedCostPerRound.toLocaleString()}</td>
              <td className="px-4 py-3">{tr.costPerKm}</td>
              <td className="px-4 py-3">
                <Badge tone={tr.active ? 'green' : 'red'}>
                  {tr.active ? t('common.active') : t('common.inactive')}
                </Badge>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <Button variant="ghost" onClick={() => open(tr)} aria-label={t('common.edit')}>
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => confirm(t('common.confirmDelete')) && deleteTruck(tr.id)}
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
          title={`${editing === 'new' ? t('common.add') : t('common.edit')} — ${t('trucks.title')}`}
          onClose={() => setEditing(null)}
          wide
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('trucks.plate')} error={errors.plateNumber}>
              <input className={inputClass} value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value })} placeholder="70-1234 ชบ" />
            </Field>
            <Field label={t('trucks.type')}>
              <select className={inputClass} value={form.type} onChange={(e) => onTypeChange(e.target.value as TruckType)}>
                {TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
              </select>
            </Field>
            <Field label={t('trucks.partner')} error={errors.partnerId}>
              <select className={inputClass} value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value })}>
                <option value="">—</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label={t('trucks.roundsPerDay')}>
              <input className={inputClass} type="number" min="1" max="10" step="1" value={form.roundsPerDay} onChange={(e) => setForm({ ...form, roundsPerDay: e.target.value })} />
            </Field>
            <Field label={t('trucks.capacityM3')}>
              <input className={inputClass} type="number" min="0" step="0.5" value={form.capacityM3} onChange={(e) => setForm({ ...form, capacityM3: e.target.value })} />
            </Field>
            <Field label={t('trucks.capacityKg')}>
              <input className={inputClass} type="number" min="0" step="100" value={form.capacityKg} onChange={(e) => setForm({ ...form, capacityKg: e.target.value })} />
            </Field>
            <Field label={t('trucks.fixedCost')}>
              <input className={inputClass} type="number" min="0" step="50" value={form.fixedCostPerRound} onChange={(e) => setForm({ ...form, fixedCostPerRound: e.target.value })} />
            </Field>
            <Field label={t('trucks.costPerKm')}>
              <input className={inputClass} type="number" min="0" step="0.5" value={form.costPerKm} onChange={(e) => setForm({ ...form, costPerKm: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
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
