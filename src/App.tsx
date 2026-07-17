import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Banknote, ClipboardCheck, Handshake, LayoutDashboard, MapPin, Moon, Receipt, Route as RouteIcon,
  Settings as SettingsIcon, Sun, TriangleAlert, Truck as TruckIcon, UserRound, Boxes, Package
} from 'lucide-react'
import { useTms } from './store'
import Dashboard from './pages/Dashboard'
import Planner from './pages/Planner'
import Locations from './pages/Locations'
import Products from './pages/Products'
import Trucks from './pages/Trucks'
import Drivers from './pages/Drivers'
import Partners from './pages/Partners'
import Costs from './pages/Costs'
import Payments from './pages/Payments'
import Operations from './pages/Operations'
import Incidents from './pages/Incidents'
import SettingsPage from './pages/SettingsPage'
// 3D Visual Truck simulator
import VisualTruck from './pages/VisualTruck'
import AlertCenter from './components/AlertCenter'

type Page =
  | 'dashboard' | 'planner' | 'visualTruck' | 'operations' | 'incidents' | 'locations'
  | 'trucks' | 'drivers' | 'partners' | 'costs' | 'payments' | 'settings' | 'products'

const PAGES: Record<Page, () => ReactNode> = {
  dashboard: () => <Dashboard />,
  planner: () => <Planner />,
  visualTruck: () => <VisualTruck />,
  operations: () => <Operations />,
  incidents: () => <Incidents />,
  locations: () => <Locations />,
  trucks: () => <Trucks />,
  drivers: () => <Drivers />,
  partners: () => <Partners />,
  costs: () => <Costs />,
  payments: () => <Payments />,
  settings: () => <SettingsPage />,
  products: () => <Products />,
}

export default function App() {
  const { t, i18n } = useTranslation()
  const language = useTms((s) => s.settings.language)
  const theme = useTms((s) => s.settings.theme)
  const [page, setPage] = useState<Page>('dashboard')

  // Restore persisted language on first load.
  useEffect(() => {
    if (i18n.language !== language) i18n.changeLanguage(language)
  }, [language, i18n])

  // Apply the persisted colour theme to the document root.
  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
  }, [theme])

  const nav: { id: Page; label: string; icon: ReactNode; section?: string }[] = [
    { id: 'dashboard', label: t('nav.dashboard'), icon: <LayoutDashboard size={18} /> },
    { id: 'planner', label: t('nav.planner'), icon: <RouteIcon size={18} /> },
    { id: 'costs', label: t('nav.costs'), icon: <Banknote size={18} /> },
    { id: 'payments', label: t('nav.payments'), icon: <Receipt size={18} /> },
    { id: 'operations', label: t('nav.operations'), icon: <ClipboardCheck size={18} />, section: t('nav.ops') },
    { id: 'visualTruck', label: t('nav.visualTruck'), icon: <Boxes size={18} /> },
    { id: 'incidents', label: t('nav.incidents'), icon: <TriangleAlert size={18} /> },
    { id: 'locations', label: t('nav.locations'), icon: <MapPin size={18} />, section: t('nav.master') },
    { id: 'products', label: t('nav.products'), icon: <Package size={18} /> },
    { id: 'trucks', label: t('nav.trucks'), icon: <TruckIcon size={18} /> },
    { id: 'drivers', label: t('nav.drivers'), icon: <UserRound size={18} /> },
    { id: 'partners', label: t('nav.partners'), icon: <Handshake size={18} /> },
    { id: 'settings', label: t('nav.settings'), icon: <SettingsIcon size={18} /> },
  ]

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-slate-900 text-slate-300 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-brand-500 flex items-center justify-center text-white">
              <TruckIcon size={20} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-white leading-tight truncate">{t('app.title')}</p>
              <p className="text-[11px] text-slate-400 leading-tight truncate">{t('app.subtitle')}</p>
            </div>
            <div className="ml-auto">
              <AlertCenter onNavigate={(p) => setPage(p as Page)} />
            </div>
          </div>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto">
          {nav.map((item) => (
            <div key={item.id}>
              {item.section && (
                <p className="px-5 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {item.section}
                </p>
              )}
              <button
                onClick={() => setPage(item.id)}
                className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors cursor-pointer ${
                  page === item.id
                    ? 'bg-slate-800 text-white border-r-2 border-brand-500'
                    : 'hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            </div>
          ))}
        </nav>

        {/* Language switch + theme toggle */}
        <div className="px-5 py-4 border-t border-slate-800 flex items-center gap-1">
          {(['en', 'th'] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => {
                i18n.changeLanguage(lang)
                useTms.getState().updateSettings({ language: lang })
              }}
              className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                language === lang ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {lang === 'en' ? 'EN' : 'ไทย'}
            </button>
          ))}
          <button
            onClick={() => useTms.getState().updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
            className="ml-auto p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
            aria-label={t('settings.theme')}
            title={t('settings.theme')}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-6 h-full">{PAGES[page]()}</div>
      </main>
    </div>
  )
}
