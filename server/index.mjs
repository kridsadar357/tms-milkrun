/**
 * TMS Milkrun API server.
 *
 * Owns the Neon Postgres connection (never exposed to the browser) and serves
 * the whole app state as one document per entity table. The frontend loads via
 * GET /api/state and saves via PUT /api/state (debounced full-state upsert).
 */
import express from 'express'
import cors from 'cors'
import pg from 'pg'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedIfEmpty, reseed } from './seed.mjs'
import {
  ROLES, clearCookie, countAdmins, createUser, deleteUser, findUser, listUsers, requireAuth,
  requireRole, seedUsersIfEmpty, sessionCookie, signToken, updateUser, verifyPassword,
} from './auth.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = process.env.PORT || 3001
const conn = (process.env.DATABASE_URL || '').replace(/&?channel_binding=require/, '')
if (!conn) {
  console.error('DATABASE_URL is not set. Start with: node --env-file=.env server/index.mjs')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: conn,
  ssl: { rejectUnauthorized: false },
  max: 5,
  // Hardening: a stuck query can never wedge the write lock indefinitely.
  statement_timeout: 15_000,
  query_timeout: 20_000,
  connectionTimeoutMillis: 10_000,
})

const ENTITY_TABLES = ['partners', 'trucks', 'drivers', 'locations', 'billings', 'pods', 'incidents', 'products']

async function initSchema() {
  for (const table of ENTITY_TABLES) {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, doc jsonb NOT NULL)`)
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS singletons (key text PRIMARY KEY, doc jsonb)`)
}

const app = express()
app.disable('x-powered-by') // don't advertise the framework

// Security headers (a lightweight subset of what helmet provides).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

// CORS: the production app is same-origin (the server serves the frontend), so
// cross-origin access is only enabled in dev, or for an explicit allow-list.
const allowOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
if (allowOrigins.length) app.use(cors({ origin: allowOrigins }))
else if (process.env.NODE_ENV !== 'production') app.use(cors())

app.use(express.json({ limit: '8mb' }))

// Basic in-memory rate limit on writes (per-IP), to blunt abuse of the
// unauthenticated write/seed endpoints.
const hits = new Map()
function rateLimit(req, res, next) {
  const now = Date.now()
  const ip = req.ip || 'anon'
  const win = hits.get(ip)?.filter((t) => now - t < 60_000) ?? []
  if (win.length >= 120) return res.status(429).json({ error: 'rate limited' })
  win.push(now)
  hits.set(ip, win)
  next()
}

// Reject malformed JSON with a clean 400 instead of an Express stack trace.
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'invalid JSON' })
  }
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload too large' })
  next(err)
})

// Serialize all write transactions so a full-state PUT and a reseed never run
// concurrent DELETE+INSERT on the same tables (which would deadlock / 500).
let writeChain = Promise.resolve()
function withWriteLock(fn) {
  const run = writeChain.then(fn, fn)
  writeChain = run.then(
    () => {},
    () => {},
  )
  return run
}

app.get('/api/health', async (_req, res) => {
  try {
    const r = await pool.query('SELECT 1 AS ok')
    res.json({ ok: r.rows[0].ok === 1 })
  } catch {
    res.status(500).json({ ok: false })
  }
})

/* ------------------------------ auth ------------------------------ */

app.post('/api/login', rateLimit, async (req, res) => {
  try {
    const { username, password } = req.body ?? {}
    const user = await findUser(pool, username)
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'invalid credentials' })
    }
    const token = signToken({ sub: user.username, role: user.role, driverId: user.driverId ?? null })
    res.setHeader('Set-Cookie', sessionCookie(token))
    res.json({ username: user.username, role: user.role, driverId: user.driverId ?? null })
  } catch {
    res.status(500).json({ error: 'login failed' })
  }
})

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', clearCookie())
  res.json({ ok: true })
})

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.user.sub, role: req.user.role, driverId: req.user.driverId ?? null })
})

/* -------------------------- user management ------------------------ */
// All admin-only.

app.get('/api/users', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    res.json(await listUsers(pool))
  } catch {
    res.status(500).json({ error: 'failed' })
  }
})

app.post('/api/users', rateLimit, requireAuth, requireRole('admin'), async (req, res) => {
  const { username, role, password, driverId } = req.body ?? {}
  if (!username?.trim() || !password) return res.status(400).json({ error: 'username and password required' })
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid role' })
  try {
    if (await findUser(pool, username.trim())) return res.status(409).json({ error: 'user already exists' })
    await createUser(pool, { username, role, password, driverId })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'failed' })
  }
})

app.put('/api/users/:username', rateLimit, requireAuth, requireRole('admin'), async (req, res) => {
  const target = req.params.username
  const { role, password, driverId } = req.body ?? {}
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'invalid role' })
  try {
    const existing = await findUser(pool, target)
    if (!existing) return res.status(404).json({ error: 'not found' })
    if (role && role !== 'admin' && existing.role === 'admin' && (await countAdmins(pool)) <= 1) {
      return res.status(400).json({ error: 'cannot demote the last admin' })
    }
    await updateUser(pool, target, { role, password, driverId })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'failed' })
  }
})

app.delete('/api/users/:username', rateLimit, requireAuth, requireRole('admin'), async (req, res) => {
  const target = req.params.username
  if (target === req.user.sub) return res.status(400).json({ error: 'cannot delete your own account' })
  try {
    const existing = await findUser(pool, target)
    if (!existing) return res.status(404).json({ error: 'not found' })
    if (existing.role === 'admin' && (await countAdmins(pool)) <= 1) {
      return res.status(400).json({ error: 'cannot delete the last admin' })
    }
    await deleteUser(pool, target)
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'failed' })
  }
})

// All data access requires a valid session.
app.get('/api/state', requireAuth, async (_req, res) => {
  try {
    const entities = await Promise.all(
      ENTITY_TABLES.map((t) => pool.query(`SELECT doc FROM ${t}`)),
    )
    const [partners, trucks, drivers, locations, billings, pods, incidents, products] = entities.map((r) =>
      r.rows.map((x) => x.doc),
    )
    const singletons = await pool.query(`SELECT key, doc FROM singletons`)
    const byKey = Object.fromEntries(singletons.rows.map((r) => [r.key, r.doc]))
    res.json({
      partners,
      trucks,
      drivers,
      locations,
      billings,
      pods,
      incidents,
      products,
      audit: byKey.audit ?? [],
      settings: byKey.settings ?? null,
      plan: byKey.plan ?? null,
      scenarios: byKey.scenarios ?? [],
    })
  } catch (e) {
    res.status(500).json({ error: 'load failed' })
  }
})

// Writes require an authenticated non-viewer (server-enforced read-only viewer).
app.put('/api/state', rateLimit, requireAuth, requireRole('admin', 'dispatcher', 'driver'), async (req, res) => {
  const s = req.body ?? {}
  try {
    await withWriteLock(async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const arrays = {
          partners: s.partners,
          trucks: s.trucks,
          drivers: s.drivers,
          locations: s.locations,
          billings: s.billings,
          pods: s.pods,
          incidents: s.incidents,
          products: s.products,
        }
        for (const table of ENTITY_TABLES) {
          await client.query(`DELETE FROM ${table}`)
          for (const item of arrays[table] ?? []) {
            if (!item || item.id == null) continue
            await client.query(`INSERT INTO ${table} (id, doc) VALUES ($1, $2)`, [
              String(item.id),
              JSON.stringify(item),
            ])
          }
        }
        for (const key of ['settings', 'plan', 'audit', 'scenarios']) {
          await client.query(
            `INSERT INTO singletons (key, doc) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc`,
            [key, JSON.stringify(s[key] ?? null)],
          )
        }
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
    })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'write failed' })
  }
})

// Re-seed the database with the canonical sample dataset (used by the app's
// "Reset to Sample Data"). Returns the fresh state so the client can rehydrate.
// Re-seed is admin-only, and can be disabled entirely in production.
app.post('/api/seed', rateLimit, requireAuth, requireRole('admin'), async (_req, res) => {
  if (process.env.DISABLE_RESET === 'true') return res.status(403).json({ error: 'reset disabled' })
  try {
    await withWriteLock(() => reseed(pool))
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'seed failed' })
  }
})

// In production, serve the built frontend from the same origin as the API so a
// single Node service hosts everything (no separate static host or CORS needed).
if (process.env.NODE_ENV === 'production' || process.env.SERVE_STATIC === 'true') {
  const distDir = path.join(__dirname, '..', 'dist')
  app.use(express.static(distDir))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

initSchema()
  .then(async () => {
    // The server owns seeding: on first run, insert the real dataset into Neon.
    const seeded = await seedIfEmpty(pool)
    if (seeded) console.log('Seeded Neon with the sample dataset (database was empty).')
    const users = await seedUsersIfEmpty(pool)
    if (users) console.log('Seeded default users (admin/dispatcher/viewer) — change the passwords.')
    app.listen(PORT, () => console.log(`TMS server on http://localhost:${PORT} (Neon Postgres)`))
  })
  .catch((e) => {
    console.error('Failed to initialise schema:', e)
    process.exit(1)
  })
