/** Core domain types for the TMS Milkrun system. */

/**
 * Detailed transporter rate card for one truck type — the components of a real
 * milkrun trip price. When a partner has one for a truck's type, it overrides the
 * simple fixedCostPerRound + costPerKm estimate in cost reporting.
 */
export interface RateCard {
  laborPerHr: number // driver labor THB/hr (first 8h)
  otPerHr: number // overtime THB/hr (beyond 8h)
  dropCost: number // THB per drop point (stop)
  allowancePerKm: number // THB/km allowance
  tripSafety: number // flat THB per trip (trip/safety/NGV)
  fuelKmPerL: number // fuel economy km per litre
  fuelRatePerL: number // diesel THB/litre
  otherPerDay: number // fixed other cost THB/day
  adminPct: number // admin overhead as a fraction (0.08 = 8%)
  // Night-shift overrides (fall back to the day values when unset)
  nightLaborPerHr?: number
  nightOtPerHr?: number
  nightFuelKmPerL?: number
}

export type Shift = 'day' | 'night'

export interface TransportPartner {
  id: string
  code: string
  name: string
  contactPerson: string
  phone: string
  email: string
  active: boolean
  // Rate card & payment terms
  ratePerKm: number // negotiated THB/km (0 = use each truck's costPerKm)
  ratePerTrip: number // flat THB per trip/round (0 = none)
  minCharge: number // minimum THB per invoice (0 = none)
  creditDays: number // payment terms in days
  // Detailed milkrun rate card keyed by truck type ('6W' | '10W' | …)
  costProfile?: Record<string, RateCard>
  // Bank details for payment batch files
  bankName: string
  bankAccountNo: string
  bankAccountName: string
}

export interface Driver {
  id: string
  code: string
  name: string
  nameTh: string
  licenseNo: string
  licenseType: string // Thai class, e.g. ท.2 / บ.2
  phone: string
  truckId: string | null // assigned truck
  active: boolean
}

export type TruckType = '4W' | '4WJ' | '6W' | '10W' | 'Trailer'

export type AssignmentMode = 'dynamic' | 'fixed'

/** What Auto Route optimizes for. `cost` = cheapest total delivery cost (฿). */
export type OptimizeObjective = 'cost' | 'distance' | 'balanced'

export interface Truck {
  id: string
  plateNumber: string
  type: TruckType
  partnerId: string
  capacityM3: number
  capacityKg: number
  roundsPerDay: number
  fixedCostPerRound: number // THB per round (driver + fixed)
  costPerKm: number // THB per km (fuel + variable)
  active: boolean
  // Milkrun assignment: 'fixed' runs the same cyclic route (fixedStops) every
  // plan; 'dynamic' (default) is assigned by the optimizer.
  assignmentMode?: AssignmentMode
  fixedStops?: string[] // location ids forming the fixed cycle
}

export type LocationKind = 'supplier' | 'plant' | 'warehouse' | 'customer'

export interface DeliveryLocation {
  id: string
  code: string
  name: string
  nameTh: string
  kind: LocationKind
  zone: string // delivery zone / region grouping
  lat: number
  lng: number
  demandM3: number // daily volume to move
  demandKg: number // daily weight to move
  serviceMinutes: number // handling time at the stop
  windowStart: string // earliest delivery 'HH:MM' ('' = none)
  windowEnd: string // latest delivery 'HH:MM' ('' = none)
  windowStartNight?: string // night-shift pickup window (falls back to the day window)
  windowEndNight?: string
  deliveryDays: number[] // weekdays served, 0=Sun..6=Sat ([] = every day)
  active: boolean
  roundsPerDay?: number // milkrun pickup frequency (default 1); loop runs this often
  // Milkrun: the plant (a kind:'plant' location) this supplier's goods are delivered
  // to. When set, Auto Route builds a loop that starts/ends at that plant instead of
  // the global depot. Empty = use the global depot (single-depot mode).
  deliveryPlantId?: string
}

export interface RouteStop {
  locationId: string
  sequence: number
  distanceFromPrevKm: number
  etaMinutes: number // minutes from route start (includes any waiting for a window)
  lateBy?: number // minutes past the delivery window's end (0 / undefined = on time)
}

export type TripStatus = 'planned' | 'dispatched' | 'in-transit' | 'completed'

export interface PlannedRoute {
  id: string
  truckId: string
  round: number // 1-based round of the day
  stops: RouteStop[]
  totalM3: number
  totalKg: number
  distanceKm: number
  durationMinutes: number
  cost: number
  colorIndex: number // categorical palette slot
  roundsPerDay?: number // milkrun: times this loop runs per day (default 1)
  shift?: Shift // which shift this loop was planned/priced for (default 'day')
  status?: TripStatus // execution status (defaults to 'planned')
  startTime?: string // planned departure clock 'HH:MM' (defaults to 08:00)
  locked?: boolean // excluded from Auto Route re-optimization
  geometry?: [number, number][] // road geometry from Mapbox Directions, [lng, lat]
  loadPlan?: CargoPlacement[]
}

export interface CargoPlacement {
  id: string
  x: number
  y: number
  z: number
  w: number
  h: number
  l: number
  isLoaded: boolean
}

export type PodStatus = 'pending' | 'delivered' | 'failed'

/** Proof of delivery for one stop on a route. id = `${routeId}:${locationId}`. */
export interface PodRecord {
  id: string
  routeId: string
  locationId: string
  status: PodStatus
  arrival: string // actual arrival clock 'HH:MM' ('' = not yet)
  receivedBy: string
  note: string
  photoDataUrl?: string // optional captured/attached photo
  recordedAt: string // ISO timestamp of last update
}

export type IncidentType = 'breakdown' | 'delay' | 'accident' | 'damage' | 'other'
export type IncidentSeverity = 'low' | 'medium' | 'high'

export interface Incident {
  id: string
  date: string // ISO date
  type: IncidentType
  severity: IncidentSeverity
  truckId: string | null
  routeId: string | null
  description: string
  resolved: boolean
}

/** Minutes a POD arrival is late (+) or early (−) vs the planned ETA. */
export function podDelayMinutes(
  route: PlannedRoute,
  etaMinutes: number,
  arrival: string,
): number | null {
  if (!arrival) return null
  const start = route.startTime || '08:00'
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  const plannedClock = toMin(start) + etaMinutes
  return toMin(arrival) - plannedClock
}

export interface PlanResult {
  routes: PlannedRoute[]
  unassignedLocationIds: string[]
  plannedAt: string
}

export type BillingStatus = 'draft' | 'approved' | 'paid'

export interface BillingRecord {
  id: string
  invoiceNo: string
  partnerId: string
  billingDate: string // ISO date the plan was billed
  dueDate: string // ISO date, billingDate + credit terms
  routesCount: number
  distanceKm: number
  totalM3: number
  totalKg: number
  subtotal: number // sum of route costs (THB)
  fuelSurchargePct: number // % on subtotal
  vatPct: number // Thailand VAT, default 7
  whtPct: number // withholding tax for transport services, default 1
  status: BillingStatus
  paidDate?: string
  note: string
}

/** Derived amounts for a billing record. */
export interface BillingAmounts {
  base: number // subtotal + fuel surcharge
  vat: number
  wht: number
  netPayable: number // base + VAT − WHT
}

export interface Settings {
  language: 'en' | 'th'
  theme: 'light' | 'dark'
  mapboxToken: string
  depotName: string
  depotLat: number
  depotLng: number
  avgSpeedKmh: number
  planStartTime: string // planned depot departure clock 'HH:MM' (default 08:00)
  shift: Shift // day or night shift — sets departure time, windows, and rates
  optimizeObjective: OptimizeObjective // what Auto Route minimizes (default 'cost')
  useRoadGeometry: boolean
  // Fuel & emissions
  dieselPricePerLiter: number // THB per liter
  fuelConsumptionKmPerL: number // fleet average km per liter
  co2KgPerLiter: number // kg CO₂ per liter diesel (~2.68)
  // Company details for printed documents (invoices, statements, manifests)
  companyName: string
  companyTaxId: string
  companyAddress: string
  // Access role for the current session
  role: Role
}

export type Role = 'admin' | 'dispatcher' | 'viewer'

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'plan' | 'billing' | 'status' | 'settings' | 'import'

export interface AuditEntry {
  id: string
  at: string // ISO timestamp
  actor: Role
  action: AuditAction
  entity: string // e.g. 'location', 'truck', 'invoice'
  label: string // human-readable description
}

/** kg CO₂ estimate for a distance, from fleet fuel economy. */
export function estimateCo2Kg(distanceKm: number, s: Settings): number {
  if (s.fuelConsumptionKmPerL <= 0) return 0
  const liters = distanceKm / s.fuelConsumptionKmPerL
  return Math.round(liters * s.co2KgPerLiter * 100) / 100
}

export interface Product {
  id: string
  code: string
  name: string
  nameTh: string
  supplierId: string // DeliveryLocation.id
  width: number      // meters
  length: number     // meters
  height: number     // meters
  weight: number     // kg
  active: boolean
  images?: string[]  // base64 strings (max 3)
  palletType?: 'wooden' | 'plastic' | 'none'
  unitsPerPallet?: number
}
