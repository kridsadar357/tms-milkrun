import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

/** Compact summary tile for master-data overview bands. */
export function Stat({ label, value, sub, tone, primary }: {
  label: string; value: ReactNode; sub?: ReactNode
  tone?: 'green' | 'amber' | 'red' | 'brand'; primary?: boolean
}) {
  const v = primary ? 'text-white'
    : tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600'
    : tone === 'red' ? 'text-rose-600' : tone === 'brand' ? 'text-brand-600' : 'text-slate-900'
  return (
    <div className={`rounded-xl border shadow-sm p-4 ${primary ? 'bg-brand-500 border-brand-500' : 'bg-white border-slate-200'}`}>
      <div className={`text-xs font-medium mb-2 ${primary ? 'text-white/80' : 'text-slate-500'}`}>{label}</div>
      <p className={`text-xl font-bold tabular-nums leading-none ${v}`}>{value}</p>
      {sub && <p className={`text-[11px] mt-1.5 truncate ${primary ? 'text-white/70' : 'text-slate-400'}`}>{sub}</p>}
    </div>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  )
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
      {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 bg-white'

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} mt-10 mb-10`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode
  tone?: 'green' | 'red' | 'slate' | 'blue' | 'amber'
}) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    slate: 'bg-slate-100 text-slate-600 border-slate-200',
    blue: 'bg-brand-50 text-brand-700 border-brand-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Table({ headers, children }: { headers: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-3 font-medium text-slate-500 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  )
}

export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
        {message}
      </td>
    </tr>
  )
}
