import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2, Search } from 'lucide-react'
import { newId, useTms } from '../store'
import {
  Badge, Button, Card, EmptyRow, Field, Modal, PageHeader, Stat, Table, inputClass,
} from '../components/ui'
import type { Product } from '../types'

const emptyForm = {
  code: '', name: '', nameTh: '', supplierId: '',
  weight: '50', width: '0.8', length: '1.2', height: '1.0', active: true,
  images: [] as string[],
  palletType: 'none' as 'wooden' | 'plastic' | 'none',
  unitsPerPallet: '1',
}

export default function Products() {
  const { t, i18n } = useTranslation()
  const { products, locations, upsertProduct, deleteProduct } = useTms()
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')

  // Filter supplier locations to only show supplier kinds for mapping
  const suppliersList = useMemo(() => {
    return locations.filter(l => l.kind === 'supplier')
  }, [locations])

  const supplierName = (id: string) => {
    const loc = locations.find((l) => l.id === id)
    return loc ? (i18n.language === 'th' ? loc.nameTh || loc.name : loc.name) : '—'
  }

  // Filtered Products list
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = 
        p.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.nameTh.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesSupplier = supplierFilter === '' || p.supplierId === supplierFilter
      
      return matchesSearch && matchesSupplier
    })
  }, [products, searchQuery, supplierFilter])

  const open = (prod: Product | 'new') => {
    setErrors({})
    setForm(
      prod === 'new'
        ? { ...emptyForm, supplierId: suppliersList[0]?.id ?? '', images: [], palletType: 'none', unitsPerPallet: '1' }
        : {
            code: prod.code,
            name: prod.name,
            nameTh: prod.nameTh,
            supplierId: prod.supplierId,
            weight: String(prod.weight),
            width: String(prod.width),
            length: String(prod.length),
            height: String(prod.height),
            active: prod.active,
            images: prod.images || [],
            palletType: prod.palletType || 'none',
            unitsPerPallet: String(prod.unitsPerPallet || 1),
          },
    )
    setEditing(prod)
  }

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!form.code.trim()) errs.code = t('common.required')
    if (!form.name.trim()) errs.name = t('common.required')
    if (!form.supplierId) errs.supplierId = t('common.required')
    
    // Check code uniqueness
    const isNew = editing === 'new'
    const editingId = (editing && editing !== 'new') ? editing.id : null
    const exists = products.some(p => {
      if (p.code.toLowerCase() !== form.code.trim().toLowerCase()) return false
      if (isNew) return true
      if (editingId) return editingId !== p.id
      return false
    })
    if (exists) {
      errs.code = 'Product code must be unique'
    }

    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    upsertProduct({
      id: editing === 'new' || !editing ? newId() : editing.id,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      nameTh: form.nameTh.trim() || form.name.trim(),
      supplierId: form.supplierId,
      weight: Math.max(0.1, Number(form.weight) || 1),
      width: Math.max(0.1, Number(form.width) || 0.5),
      length: Math.max(0.1, Number(form.length) || 0.5),
      height: Math.max(0.1, Number(form.height) || 0.5),
      active: form.active,
      images: form.images,
      palletType: form.palletType,
      unitsPerPallet: Math.max(1, Math.round(Number(form.unitsPerPallet) || 1)),
    })
    setEditing(null)
  }

  return (
    <div>
      <PageHeader
        title={t('products.title')}
        actions={
          <Button onClick={() => open('new')} disabled={suppliersList.length === 0}>
            <Plus size={16} /> {t('common.add')}
          </Button>
        }
      />

      {(() => {
        const active = products.filter((p) => p.active)
        const wooden = active.filter((p) => p.palletType === 'wooden').length
        const plastic = active.filter((p) => p.palletType === 'plastic').length
        const none = active.filter((p) => (p.palletType ?? 'none') === 'none').length
        const returnable = wooden + plastic
        const withProducts = new Set(active.map((p) => p.supplierId)).size
        const pct = active.length ? Math.round((returnable / active.length) * 100) : 0
        return products.length === 0 ? null : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
            <Stat primary label={t('products.title')} value={String(active.length)} sub={`${products.length - active.length} ${t('common.inactive').toLowerCase()}`} />
            <Stat label={t('analytics.returnable')} value={`${pct}%`} sub={`${returnable} ${t('common.of')} ${active.length}`} tone="green" />
            <Stat label={t('analytics.wooden')} value={String(wooden)} />
            <Stat label={t('analytics.plastic')} value={String(plastic)} />
            <Stat label={t('analytics.oneWay')} value={String(none)} sub={`${withProducts} ${t('dashboard.suppliers').toLowerCase()}`} tone={none > 0 ? 'amber' : undefined} />
          </div>
        )
      })()}

      {/* SEARCH AND FILTERS */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search size={16} />
          </span>
          <input
            type="text"
            className={`${inputClass} pl-10`}
            placeholder={t('common.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className={`${inputClass} sm:w-60`}
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
        >
          <option value="">{t('common.all')}</option>
          {suppliersList.map(s => (
            <option key={s.id} value={s.id}>{supplierName(s.id)}</option>
          ))}
        </select>
      </div>

      <Card>
        <Table stickyActions
          headers={[
            t('products.code'), t('products.name'), t('products.supplier'), 
            t('products.weight'), t('products.dimensions'), 'Volume (m³)',
            t('products.pallet') || 'Pallet',
            t('common.status'), t('common.actions'),
          ]}
        >
          {filteredProducts.length === 0 && <EmptyRow colSpan={9} message={t('common.noData')} />}
          {filteredProducts.map((prod) => {
            const vol = Math.round(prod.width * prod.length * prod.height * 100) / 100
            const displayPallet = prod.palletType && prod.palletType !== 'none' 
              ? `${prod.palletType === 'wooden' ? (i18n.language === 'th' ? 'ไม้' : 'Wooden') : (i18n.language === 'th' ? 'พลาสติก' : 'Plastic')} (${prod.unitsPerPallet || 1} u/p)`
              : '—'
            return (
              <tr key={prod.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">{prod.code}</td>
                <td className="px-4 py-3 text-slate-700">
                  <p className="font-medium">{i18n.language === 'th' ? prod.nameTh || prod.name : prod.name}</p>
                  <p className="text-xs text-slate-400 font-mono">{prod.name}</p>
                </td>
                <td className="px-4 py-3 text-slate-600">{supplierName(prod.supplierId)}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap font-medium">
                  {prod.weight.toLocaleString()} {t('common.weight') || 'kg'}
                </td>
                <td className="px-4 py-3 text-slate-600 font-mono text-xs whitespace-nowrap">
                  {prod.width}m × {prod.length}m × {prod.height}m
                </td>
                <td className="px-4 py-3 text-slate-600 font-medium font-mono text-xs">{vol}</td>
                <td className="px-4 py-3 text-slate-600 font-medium whitespace-nowrap text-xs">{displayPallet}</td>
                <td className="px-4 py-3">
                  <Badge tone={prod.active ? 'green' : 'red'}>
                    {prod.active ? t('common.active') : t('common.inactive')}
                  </Badge>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Button variant="ghost" onClick={() => open(prod)} aria-label={t('common.edit')}>
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => confirm(t('common.confirmDelete')) && deleteProduct(prod.id)}
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

      {editing && (
        <Modal
          title={`${editing === 'new' ? t('common.add') : t('common.edit')} — ${t('products.title')}`}
          onClose={() => setEditing(null)}
          wide
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('products.code')} error={errors.code}>
              <input 
                className={inputClass} 
                value={form.code} 
                onChange={(e) => setForm({ ...form, code: e.target.value })} 
                placeholder="SKU-STMP-101" 
                style={{ textTransform: 'uppercase' }}
              />
            </Field>
            <Field label={t('products.supplier')} error={errors.supplierId}>
              <select className={inputClass} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">—</option>
                {suppliersList.map((p) => <option key={p.id} value={p.id}>{supplierName(p.id)}</option>)}
              </select>
            </Field>
            <Field label={t('products.name')} error={errors.name}>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Hood Panel Pallet" />
            </Field>
            <Field label={t('products.nameTh')}>
              <input className={inputClass} value={form.nameTh} onChange={(e) => setForm({ ...form, nameTh: e.target.value })} placeholder="พาเลทแผงฝากระโปรง" />
            </Field>
            <Field label={t('products.weight')}>
              <input className={inputClass} type="number" min="0.1" step="0.5" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </Field>
            <Field label={t('products.width')}>
              <input className={inputClass} type="number" min="0.1" step="0.1" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
            </Field>
            <Field label={t('products.length')}>
              <input className={inputClass} type="number" min="0.1" step="0.1" value={form.length} onChange={(e) => setForm({ ...form, length: e.target.value })} />
            </Field>
            <Field label={t('products.height')}>
              <input className={inputClass} type="number" min="0.1" step="0.1" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
            </Field>
            <Field label={t('products.palletType') || 'Pallet Base Type'}>
              <select className={inputClass} value={form.palletType} onChange={(e) => setForm({ ...form, palletType: e.target.value as any })}>
                <option value="none">{i18n.language === 'th' ? 'ไม่มี (แบบกล่องเดี่ยว)' : 'None (Single Box)'}</option>
                <option value="wooden">{i18n.language === 'th' ? 'พาเลทไม้ (1.2m x 1.0m)' : 'Wooden Pallet (1.2m x 1.0m)'}</option>
                <option value="plastic">{i18n.language === 'th' ? 'พาเลทพลาสติก (1.2m x 1.0m)' : 'Plastic Pallet (1.2m x 1.0m)'}</option>
              </select>
            </Field>
            <Field label={t('products.unitsPerPallet') || 'Units per Pallet'}>
              <input className={inputClass} type="number" min="1" step="1" value={form.unitsPerPallet} onChange={(e) => setForm({ ...form, unitsPerPallet: e.target.value })} disabled={form.palletType === 'none'} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              {t('common.active')}
            </label>

            {/* Product Image Upload Section */}
            <div className="sm:col-span-2 border-t border-slate-100 pt-4 mt-2">
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                {i18n.language === 'th' ? 'รูปภาพสินค้า (สูงสุด 3 รูป)' : 'Product Images (Max 3)'}
              </label>
              
              <div className="flex flex-wrap gap-3 items-center">
                {(form.images || []).map((img, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 group hover:border-red-300 transition-colors">
                    <img src={img} alt="product" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white"
                      onClick={() => {
                        const nextImages = form.images.filter((_, i) => i !== idx)
                        setForm({ ...form, images: nextImages })
                      }}
                      title="Remove image"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}

                {(form.images || []).length < 3 && (
                  <label className="w-20 h-20 rounded-lg border-2 border-dashed border-slate-300 hover:border-brand-500 hover:bg-slate-50 flex flex-col items-center justify-center cursor-pointer transition-all text-slate-400 hover:text-brand-600">
                    <Plus size={20} />
                    <span className="text-[10px] mt-1 font-medium">{i18n.language === 'th' ? 'อัปโหลด' : 'Upload'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || [])
                        const remaining = 3 - form.images.length
                        const allowedFiles = files.slice(0, remaining)
                        
                        if (files.length > remaining) {
                          alert(i18n.language === 'th' ? 'สามารถอัปโหลดได้สูงสุด 3 รูปเท่านั้น' : 'Maximum 3 images allowed')
                        }

                        allowedFiles.forEach(file => {
                          const reader = new FileReader()
                          reader.onloadend = () => {
                            const res = reader.result
                            if (typeof res === 'string') {
                              setForm(prev => ({
                                ...prev,
                                images: [...prev.images, res].slice(0, 3)
                              }))
                            }
                          }
                          reader.readAsDataURL(file)
                        })
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
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
