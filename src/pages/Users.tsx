import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createUser, deleteUser, listUsers, me, updateUser, type ManagedUser,
} from '../lib/auth'
import { ROLES } from '../lib/permissions'
import {
  Badge, Button, Card, EmptyRow, Field, Modal, PageHeader, Table, inputClass,
} from '../components/ui'
import type { Role } from '../types'

const ROLE_TONE: Record<Role, 'green' | 'blue' | 'slate'> = {
  admin: 'green',
  dispatcher: 'blue',
  viewer: 'slate',
}

export default function Users() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [current, setCurrent] = useState<string>('')
  const [editing, setEditing] = useState<ManagedUser | 'new' | null>(null)
  const [form, setForm] = useState({ username: '', role: 'viewer' as Role, password: '' })
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const load = async () => {
    setUsers(await listUsers())
    setCurrent((await me())?.username ?? '')
  }
  useEffect(() => {
    load()
  }, [])

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const open = (u: ManagedUser | 'new') => {
    setError('')
    setForm(
      u === 'new'
        ? { username: '', role: 'viewer', password: '' }
        : { username: u.username, role: u.role, password: '' },
    )
    setEditing(u)
  }

  const submit = async () => {
    setError('')
    const res =
      editing === 'new'
        ? await createUser(form.username.trim(), form.role, form.password)
        : await updateUser(form.username, {
            role: form.role,
            password: form.password || undefined,
          })
    if (res.ok) {
      setEditing(null)
      await load()
      flash(t('common.save'))
    } else {
      setError(res.error ? t(`users.errors.${res.error}`, { defaultValue: res.error }) : t('users.failed'))
    }
  }

  const remove = async (u: ManagedUser) => {
    if (!confirm(t('common.confirmDelete'))) return
    const res = await deleteUser(u.username)
    if (res.ok) await load()
    else flash(res.error ? t(`users.errors.${res.error}`, { defaultValue: res.error }) : t('users.failed'))
  }

  return (
    <div>
      <PageHeader
        title={t('users.title')}
        actions={
          <Button onClick={() => open('new')}>
            <Plus size={16} /> {t('common.add')}
          </Button>
        }
      />

      {toast && (
        <Card className="p-3 mb-4 text-sm text-brand-700 bg-brand-50 border-brand-100">{toast}</Card>
      )}

      <Card>
        <Table headers={[t('users.username'), t('users.role'), t('common.actions')]}>
          {users.length === 0 && <EmptyRow colSpan={3} message={t('common.noData')} />}
          {users.map((u) => (
            <tr key={u.username} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-800">
                {u.username}
                {u.username === current && (
                  <span className="ml-2 text-xs text-slate-400">({t('users.you')})</span>
                )}
              </td>
              <td className="px-4 py-3">
                <Badge tone={ROLE_TONE[u.role]}>{t(`roles.${u.role}`)}</Badge>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <Button variant="ghost" onClick={() => open(u)} aria-label={t('common.edit')}>
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => remove(u)}
                  aria-label={t('common.delete')}
                  disabled={u.username === current}
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
          title={`${editing === 'new' ? t('common.add') : t('common.edit')} — ${t('users.title')}`}
          onClose={() => setEditing(null)}
        >
          <div className="space-y-4">
            <Field label={t('users.username')}>
              <input
                className={inputClass}
                value={form.username}
                disabled={editing !== 'new'}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </Field>
            <Field label={t('users.role')}>
              <select
                className={inputClass}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={editing === 'new' ? t('users.password') : t('users.newPassword')}
              hint={editing === 'new' ? undefined : t('users.leaveBlank')}
            >
              <div className="relative">
                <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${inputClass} pl-9`}
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={submit}
              disabled={!form.username.trim() || (editing === 'new' && !form.password)}
            >
              {t('common.save')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
