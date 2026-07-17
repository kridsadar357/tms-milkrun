import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogIn, Truck } from 'lucide-react'
import { login, type AuthUser } from '../lib/auth'
import { Button, inputClass } from './ui'

export default function Login({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const user = await login(username.trim(), password)
    setBusy(false)
    if (user) onLogin(user)
    else setError(t('auth.invalid'))
  }

  return (
    <div className="h-full flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <div className="w-10 h-10 rounded-lg bg-brand-500 flex items-center justify-center text-white">
            <Truck size={22} />
          </div>
          <div>
            <p className="font-semibold text-slate-900 leading-tight">{t('app.title')}</p>
            <p className="text-xs text-slate-500 leading-tight">{t('app.subtitle')}</p>
          </div>
        </div>

        <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h1 className="text-lg font-semibold text-slate-900">{t('auth.signIn')}</h1>

          <label className="block">
            <span className="block text-sm font-medium text-slate-700 mb-1">{t('auth.username')}</span>
            <input
              className={inputClass}
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-slate-700 mb-1">{t('auth.password')}</span>
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={busy || !username || !password} className="w-full justify-center">
            <LogIn size={16} /> {busy ? t('auth.signingIn') : t('auth.signIn')}
          </Button>

          <p className="text-xs text-slate-400 text-center pt-1">{t('auth.demoHint')}</p>
        </form>
      </div>
    </div>
  )
}
