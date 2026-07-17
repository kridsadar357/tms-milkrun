/**
 * Client data layer — talks to the TMS API server (which owns the Neon
 * Postgres connection). The whole app state is loaded once and saved back as a
 * debounced full-state upsert whenever the store changes.
 */

export interface ApiState {
  partners?: unknown[]
  trucks?: unknown[]
  drivers?: unknown[]
  locations?: unknown[]
  billings?: unknown[]
  pods?: unknown[]
  incidents?: unknown[]
  products?: unknown[]
  audit?: unknown[]
  settings?: Record<string, unknown> | null
  plan?: unknown
}

/** Re-seed the database with the canonical sample dataset (server-side). */
export async function reseedDatabase(): Promise<void> {
  await fetch('/api/seed', { method: 'POST' })
}

/** Load the full state, or null if the server is unreachable. */
export async function loadState(): Promise<ApiState | null> {
  try {
    const res = await fetch('/api/state')
    if (!res.ok) return null
    return (await res.json()) as ApiState
  } catch {
    return null
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
let latest: unknown = null
let inFlight = false
let dirty = false

/**
 * Debounced full-state save. Guarantees only ONE PUT is in flight at a time —
 * overlapping full-state upserts would run concurrent DELETE+INSERT
 * transactions on the same tables and collide. Changes that arrive mid-flight
 * schedule one more save afterwards with the latest state.
 */
export function saveState(state: unknown) {
  latest = state
  schedule()
}

function schedule() {
  if (timer) return
  timer = setTimeout(flush, 400)
}

async function flush() {
  timer = null
  if (inFlight) {
    dirty = true // a save is running; remember to send the newest state after
    return
  }
  inFlight = true
  const body = latest
  try {
    await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    dirty = true // offline / failed — retry on the next tick
  } finally {
    inFlight = false
    if (dirty) {
      dirty = false
      schedule()
    }
  }
}
