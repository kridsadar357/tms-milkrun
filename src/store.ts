import { create } from 'zustand'
import { drainSaves, loadState, reseedDatabase, saveState } from './lib/api'
import type {
  AuditAction,
  AuditEntry,
  BillingAmounts,
  BillingRecord,
  DeliveryLocation,
  Driver,
  Incident,
  PlannedRoute,
  PlanResult,
  PodRecord,
  Settings,
  TransportPartner,
  TripStatus,
  Truck,
  Product,
} from './types'

/* ------------------------------------------------------------------ */
/* Default backfills — used both for seed data and to migrate persisted */
/* records saved before newer fields existed.                          */
/* ------------------------------------------------------------------ */

type PartnerInput = Omit<
  TransportPartner,
  'ratePerKm' | 'ratePerTrip' | 'minCharge' | 'creditDays' | 'bankName' | 'bankAccountNo' | 'bankAccountName'
> &
  Partial<TransportPartner>
export const withPartnerDefaults = (p: PartnerInput): TransportPartner => ({
  ratePerKm: 0,
  ratePerTrip: 0,
  minCharge: 0,
  creditDays: 30,
  bankName: '',
  bankAccountNo: '',
  bankAccountName: '',
  ...p,
})

type LocationInput = Omit<DeliveryLocation, 'zone' | 'windowStart' | 'windowEnd' | 'deliveryDays'> &
  Partial<DeliveryLocation>
export const withLocationDefaults = (l: LocationInput): DeliveryLocation => ({
  zone: '',
  windowStart: '',
  windowEnd: '',
  deliveryDays: [],
  ...l,
})

/* ------------------------------------------------------------------ */
/* No mock data lives here — the canonical dataset is defined in         */
/* server/seed.mjs and inserted into Neon Postgres by the API server on  */
/* first run. The store loads real data from the database via initStore. */
/* ------------------------------------------------------------------ */

const seedPartners: TransportPartner[] = []
const seedDrivers: Driver[] = []
const seedTrucks: Truck[] = []
const seedLocations: DeliveryLocation[] = []
const seedProducts: Product[] = []

const defaultSettings: Settings = {
  language: 'en',
  theme: 'light',
  mapboxToken: (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '',
  depotName: 'AISIN Plant — Amata City Chonburi',
  depotLat: 13.1544,
  depotLng: 100.9319,
  avgSpeedKmh: 45,
  useRoadGeometry: true,
  dieselPricePerLiter: 32,
  fuelConsumptionKmPerL: 4,
  co2KgPerLiter: 2.68,
  companyName: 'AISIN (Thailand) Co., Ltd.',
  companyTaxId: '0-1055-00000-00-0',
  companyAddress: '700/1 Amata City Chonburi Industrial Estate, Chonburi 20000, Thailand',
  role: 'admin',
}

/* ------------------------------------------------------------------ */

export interface TmsState {
  partners: TransportPartner[]
  trucks: Truck[]
  drivers: Driver[]
  locations: DeliveryLocation[]
  plan: PlanResult | null
  billings: BillingRecord[]
  pods: PodRecord[]
  incidents: Incident[]
  products: Product[]
  audit: AuditEntry[]
  settings: Settings

  logAudit: (action: AuditAction, entity: string, label: string) => void
  upsertPartner: (p: TransportPartner) => void
  deletePartner: (id: string) => void
  upsertTruck: (t: Truck) => void
  deleteTruck: (id: string) => void
  upsertDriver: (d: Driver) => void
  deleteDriver: (id: string) => void
  upsertLocation: (l: DeliveryLocation) => void
  deleteLocation: (id: string) => void
  upsertProduct: (p: Product) => void
  deleteProduct: (id: string) => void
  setPlan: (plan: PlanResult | null) => void
  updateRouteStatus: (routeId: string, status: TripStatus) => void
  patchRoute: (routeId: string, patch: Partial<PlannedRoute>) => void
  updatePlanRoutes: (routes: PlannedRoute[], unassignedLocationIds?: string[]) => void
  createBillingsFromPlan: () => number
  upsertBilling: (b: BillingRecord) => void
  deleteBilling: (id: string) => void
  upsertPod: (p: PodRecord) => void
  deletePod: (id: string) => void
  upsertIncident: (i: Incident) => void
  deleteIncident: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  resetToSeed: () => void
  clearAll: () => void
}

const CREDIT_DAYS = 30

/** Compute VAT / WHT / net for a billing record. */
export function billingAmounts(b: BillingRecord): BillingAmounts {
  const base = b.subtotal * (1 + b.fuelSurchargePct / 100)
  const vat = base * (b.vatPct / 100)
  const wht = base * (b.whtPct / 100)
  const r = (n: number) => Math.round(n * 100) / 100
  return { base: r(base), vat: r(vat), wht: r(wht), netPayable: r(base + vat - wht) }
}

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => {
  const i = list.findIndex((x) => x.id === item.id)
  return i === -1 ? [...list, item] : list.map((x) => (x.id === item.id ? item : x))
}

export const useTms = create<TmsState>()((set, get) => ({
      partners: seedPartners,
      trucks: seedTrucks,
      drivers: seedDrivers,
      locations: seedLocations,
      plan: null as PlanResult | null,
      billings: [] as BillingRecord[],
      pods: [] as PodRecord[],
      incidents: [] as Incident[],
      products: seedProducts,
      audit: [] as AuditEntry[],
      settings: defaultSettings,

      logAudit: (action, entity, label) =>
        set((s) => ({
          audit: [
            {
              id: newId(),
              at: new Date().toISOString(),
              actor: s.settings.role ?? 'admin',
              action,
              entity,
              label,
            },
            ...s.audit,
          ].slice(0, 300),
        })),

      upsertPartner: (p) => {
        const existed = get().partners.some((x) => x.id === p.id)
        set((s) => ({ partners: upsert(s.partners, p) }))
        get().logAudit(existed ? 'update' : 'create', 'partner', p.name)
      },
      deletePartner: (id) => {
        const label = get().partners.find((x) => x.id === id)?.name ?? id
        set((s) => ({ partners: s.partners.filter((x) => x.id !== id) }))
        get().logAudit('delete', 'partner', label)
      },
      upsertTruck: (t) => {
        const existed = get().trucks.some((x) => x.id === t.id)
        set((s) => ({ trucks: upsert(s.trucks, t), plan: null }))
        get().logAudit(existed ? 'update' : 'create', 'truck', t.plateNumber)
      },
      deleteTruck: (id) => {
        const label = get().trucks.find((x) => x.id === id)?.plateNumber ?? id
        set((s) => ({ trucks: s.trucks.filter((x) => x.id !== id), plan: null }))
        get().logAudit('delete', 'truck', label)
      },
      upsertDriver: (d) => {
        const existed = get().drivers.some((x) => x.id === d.id)
        set((s) => ({ drivers: upsert(s.drivers, d) }))
        get().logAudit(existed ? 'update' : 'create', 'driver', d.name)
      },
      deleteDriver: (id) => {
        const label = get().drivers.find((x) => x.id === id)?.name ?? id
        set((s) => ({ drivers: s.drivers.filter((x) => x.id !== id) }))
        get().logAudit('delete', 'driver', label)
      },
      upsertLocation: (l) => {
        const existed = get().locations.some((x) => x.id === l.id)
        set((s) => ({ locations: upsert(s.locations, l), plan: null }))
        get().logAudit(existed ? 'update' : 'create', 'location', `${l.code} — ${l.name}`)
      },
      deleteLocation: (id) => {
        const label = get().locations.find((x) => x.id === id)?.code ?? id
        set((s) => ({ locations: s.locations.filter((x) => x.id !== id), plan: null }))
        get().logAudit('delete', 'location', label)
      },
      upsertProduct: (p) => set((s) => ({ products: upsert(s.products, p) })),
      deleteProduct: (id) => set((s) => ({ products: s.products.filter((x) => x.id !== id) })),
      setPlan: (plan) => set({ plan }),

      patchRoute: (routeId, patch) =>
        set((s) =>
          s.plan
            ? {
                plan: {
                  ...s.plan,
                  routes: s.plan.routes.map((r) => (r.id === routeId ? { ...r, ...patch } : r)),
                },
              }
            : {},
        ),

      updatePlanRoutes: (routes, unassignedLocationIds) =>
        set((s) =>
          s.plan
            ? {
                plan: {
                  ...s.plan,
                  routes,
                  unassignedLocationIds: unassignedLocationIds ?? s.plan.unassignedLocationIds,
                },
              }
            : {},
        ),

      updateRouteStatus: (routeId, status) =>
        set((s) =>
          s.plan
            ? {
                plan: {
                  ...s.plan,
                  routes: s.plan.routes.map((r) =>
                    r.id === routeId
                      ? {
                          ...r,
                          status,
                          // Stamp a planned departure clock the first time it leaves.
                          startTime:
                            status === 'dispatched' && !r.startTime
                              ? new Date().toTimeString().slice(0, 5)
                              : r.startTime,
                        }
                      : r,
                  ),
                },
              }
            : {},
        ),

      /**
       * Roll the current plan into one billing record per transport partner.
       * Charge per route uses the partner rate card when set (THB/km and/or
       * THB/trip); otherwise the planned route cost. A partner minimum charge
       * and per-partner credit terms are applied.
       */
      createBillingsFromPlan: (): number => {
        const { plan, trucks, partners, billings } = get()
        if (!plan || plan.routes.length === 0) return 0
        const truckById = new Map(trucks.map((tr) => [tr.id, tr]))
        const partnerById = new Map(partners.map((p) => [p.id, p]))
        const byPartner = new Map<string, BillingRecord>()
        const today = new Date()
        const iso = today.toISOString().slice(0, 10)

        for (const r of plan.routes) {
          const truck = truckById.get(r.truckId)
          if (!truck) continue
          const pid = truck.partnerId
          const partner = partnerById.get(pid)
          // Route charge from rate card, falling back to planned cost.
          const rateCharge =
            partner && partner.ratePerKm > 0 ? partner.ratePerKm * r.distanceKm : r.cost
          const tripCharge = partner ? partner.ratePerTrip : 0
          const charge = rateCharge + tripCharge

          const existing = byPartner.get(pid)
          if (existing) {
            existing.routesCount += 1
            existing.distanceKm += r.distanceKm
            existing.totalM3 += r.totalM3
            existing.totalKg += r.totalKg
            existing.subtotal += charge
          } else {
            const seq = billings.length + byPartner.size + 1
            const creditDays = partner?.creditDays ?? CREDIT_DAYS
            byPartner.set(pid, {
              id: newId(),
              invoiceNo: `INV-${iso.replaceAll('-', '')}-${String(seq).padStart(3, '0')}`,
              partnerId: pid,
              billingDate: iso,
              dueDate: new Date(today.getTime() + creditDays * 86400000).toISOString().slice(0, 10),
              routesCount: 1,
              distanceKm: r.distanceKm,
              totalM3: r.totalM3,
              totalKg: r.totalKg,
              subtotal: charge,
              fuelSurchargePct: 0,
              vatPct: 7,
              whtPct: 1,
              status: 'draft',
              note: '',
            })
          }
        }
        const created = [...byPartner.values()].map((b) => {
          const minCharge = partnerById.get(b.partnerId)?.minCharge ?? 0
          return {
            ...b,
            distanceKm: Math.round(b.distanceKm * 100) / 100,
            totalM3: Math.round(b.totalM3 * 100) / 100,
            totalKg: Math.round(b.totalKg * 100) / 100,
            subtotal: Math.round(Math.max(b.subtotal, minCharge) * 100) / 100,
          }
        })
        set((s) => ({ billings: [...s.billings, ...created] }))
        if (created.length) get().logAudit('billing', 'invoice', `${created.length} invoice(s) from plan`)
        return created.length
      },
      upsertBilling: (b) => {
        const existed = get().billings.some((x) => x.id === b.id)
        set((s) => ({ billings: upsert(s.billings, b) }))
        get().logAudit('billing', 'invoice', `${b.invoiceNo} (${existed ? 'update' : 'create'})`)
      },
      deleteBilling: (id) => {
        const label = get().billings.find((x) => x.id === id)?.invoiceNo ?? id
        set((s) => ({ billings: s.billings.filter((x) => x.id !== id) }))
        get().logAudit('delete', 'invoice', label)
      },

      upsertPod: (p) => set((s) => ({ pods: upsert(s.pods, p) })),
      deletePod: (id) => set((s) => ({ pods: s.pods.filter((x) => x.id !== id) })),
      upsertIncident: (i) => {
        const existed = get().incidents.some((x) => x.id === i.id)
        set((s) => ({ incidents: upsert(s.incidents, i) }))
        get().logAudit(existed ? 'update' : 'create', 'incident', `${i.type} (${i.severity})`)
      },
      deleteIncident: (id) => {
        set((s) => ({ incidents: s.incidents.filter((x) => x.id !== id) }))
        get().logAudit('delete', 'incident', id)
      },

      updateSettings: (patch) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
        // Only audit meaningful config changes, not the language/theme toggles.
        const keys = Object.keys(patch).filter((k) => k !== 'language' && k !== 'theme')
        if (keys.length) get().logAudit('settings', 'settings', keys.join(', '))
      },
      // Re-seed the database with the canonical dataset (server/seed.mjs),
      // then reload the fresh data from Neon into the store.
      resetToSeed: async () => {
        const role = get().settings.role // keep the logged-in user's role
        await drainSaves() // finish/cancel any pending client save first
        await reseedDatabase()
        const remote = await loadState()
        if (remote) hydrateFromRemote(remote, role)
      },
      clearAll: () =>
        set({
          partners: [], trucks: [], drivers: [], locations: [], plan: null,
          billings: [], pods: [], incidents: [], products: [], audit: [],
        }),
    }),
)

/* ------------------------------------------------------------------ */
/* Persistence — Neon Postgres via the API server (src/lib/api.ts).    */
/* Loads once on startup; autosaves (debounced) on every change.       */
/* ------------------------------------------------------------------ */

/** Data slice of the state (no action functions) sent to the server. */
function snapshot(s: TmsState) {
  return {
    partners: s.partners,
    trucks: s.trucks,
    drivers: s.drivers,
    locations: s.locations,
    billings: s.billings,
    pods: s.pods,
    incidents: s.incidents,
    products: s.products,
    audit: s.audit,
    settings: s.settings,
    plan: s.plan,
  }
}

let applyingRemote = false
let subscribed = false

/**
 * Apply a loaded snapshot from Neon into the store (normalising records). The
 * authenticated role always overrides any persisted role in settings.
 */
function hydrateFromRemote(
  remote: NonNullable<Awaited<ReturnType<typeof loadState>>>,
  authRole?: Settings['role'],
) {
  applyingRemote = true
  useTms.setState({
    partners: (remote.partners ?? []).map((x) => withPartnerDefaults(x as PartnerInput)),
    trucks: (remote.trucks ?? []) as Truck[],
    drivers: (remote.drivers ?? []) as Driver[],
    locations: (remote.locations ?? []).map((x) => withLocationDefaults(x as LocationInput)),
    billings: (remote.billings ?? []) as BillingRecord[],
    pods: (remote.pods ?? []) as PodRecord[],
    incidents: (remote.incidents ?? []) as Incident[],
    products: (remote.products ?? []) as Product[],
    audit: (remote.audit ?? []) as AuditEntry[],
    settings: {
      ...defaultSettings,
      ...(remote.settings ?? {}),
      ...(authRole ? { role: authRole } : {}),
    } as Settings,
    plan: (remote.plan ?? null) as PlanResult | null,
  })
  applyingRemote = false
}

/**
 * Load real data from Neon after login, applying the authenticated role, then
 * keep the store in sync. Safe to call again on re-login.
 */
export async function initStore(authRole?: Settings['role']): Promise<void> {
  const remote = await loadState()
  if (remote) hydrateFromRemote(remote, authRole)

  if (!subscribed) {
    subscribed = true
    useTms.subscribe((s) => {
      if (!applyingRemote) saveState(snapshot(s))
    })
  }
}

/** Token entered in Settings wins; falls back to the .env token. */
export const effectiveMapboxToken = (settings: Settings): string =>
  settings.mapboxToken || ((import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '')

export const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
