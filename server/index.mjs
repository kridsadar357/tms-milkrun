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
import { seedIfEmpty, reseed } from './seed.mjs'

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
})

const ENTITY_TABLES = ['partners', 'trucks', 'drivers', 'locations', 'billings', 'pods', 'incidents', 'products']

async function initSchema() {
  for (const table of ENTITY_TABLES) {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, doc jsonb NOT NULL)`)
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS singletons (key text PRIMARY KEY, doc jsonb)`)
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' }))

app.get('/api/health', async (_req, res) => {
  try {
    const r = await pool.query('SELECT 1 AS ok')
    res.json({ ok: r.rows[0].ok === 1 })
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.get('/api/state', async (_req, res) => {
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
    })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.put('/api/state', async (req, res) => {
  const s = req.body ?? {}
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
    for (const key of ['settings', 'plan', 'audit']) {
      await client.query(
        `INSERT INTO singletons (key, doc) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc`,
        [key, JSON.stringify(s[key] ?? null)],
      )
    }
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    res.status(500).json({ error: String(e) })
  } finally {
    client.release()
  }
})

// Re-seed the database with the canonical sample dataset (used by the app's
// "Reset to Sample Data"). Returns the fresh state so the client can rehydrate.
app.post('/api/seed', async (_req, res) => {
  try {
    await reseed(pool)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

initSchema()
  .then(async () => {
    // The server owns seeding: on first run, insert the real dataset into Neon.
    const seeded = await seedIfEmpty(pool)
    if (seeded) console.log('Seeded Neon with the sample dataset (database was empty).')
    app.listen(PORT, () => console.log(`TMS API on http://localhost:${PORT} (Neon Postgres)`))
  })
  .catch((e) => {
    console.error('Failed to initialise schema:', e)
    process.exit(1)
  })
