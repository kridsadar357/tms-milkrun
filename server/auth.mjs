/**
 * Authentication — scrypt-hashed passwords, HMAC-signed session tokens in an
 * httpOnly cookie, and role enforcement. No external dependencies (Node crypto).
 *
 * Default accounts (seeded if the users table is empty) — CHANGE THESE:
 *   admin / admin        (role: admin)
 *   dispatcher / dispatcher (role: dispatcher)
 *   viewer / viewer      (role: viewer)
 * Override with ADMIN_PASSWORD / DISPATCHER_PASSWORD / VIEWER_PASSWORD.
 */
import crypto from 'node:crypto'

const SECRET = process.env.AUTH_SECRET || 'dev-insecure-secret-change-me'
if (SECRET === 'dev-insecure-secret-change-me' && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: AUTH_SECRET is not set — set a strong secret in production.')
}
const COOKIE = 'tms_session'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/* ---------------------------- passwords ---------------------------- */

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16)
  const dk = crypto.scryptSync(String(pw), salt, 32)
  return `${salt.toString('hex')}:${dk.toString('hex')}`
}

export function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored).split(':')
  if (!saltHex || !hashHex) return false
  const dk = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32)
  const a = Buffer.from(hashHex, 'hex')
  return a.length === dk.length && crypto.timingSafeEqual(a, dk)
}

/* ------------------------------ tokens ----------------------------- */

const b64url = (s) => Buffer.from(s).toString('base64url')

export function signToken(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + SESSION_MS }))
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyToken(token) {
  if (!token || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (obj.exp && Date.now() > obj.exp) return null
    return obj
  } catch {
    return null
  }
}

/* ------------------------------ cookies ---------------------------- */

export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : ''
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/;${secure} Max-Age=${SESSION_MS / 1000}`
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

function userFromReq(req) {
  const raw = req.headers.cookie || ''
  const m = raw.match(/(?:^|;\s*)tms_session=([^;]+)/)
  if (!m) return null
  return verifyToken(decodeURIComponent(m[1]))
}

/* ---------------------------- middleware --------------------------- */

export function requireAuth(req, res, next) {
  const user = userFromReq(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })
  req.user = user
  next()
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' })
    }
    next()
  }
}

/* ------------------------------ users ------------------------------ */

const DEFAULT_USERS = [
  { username: 'admin', role: 'admin', password: process.env.ADMIN_PASSWORD || 'admin' },
  { username: 'dispatcher', role: 'dispatcher', password: process.env.DISPATCHER_PASSWORD || 'dispatcher' },
  { username: 'viewer', role: 'viewer', password: process.env.VIEWER_PASSWORD || 'viewer' },
]

export async function ensureUsersTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (username text PRIMARY KEY, doc jsonb NOT NULL)`)
}

export async function seedUsersIfEmpty(pool) {
  await ensureUsersTable(pool)
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users')
  if (rows[0].n > 0) return false
  for (const u of DEFAULT_USERS) {
    await pool.query(`INSERT INTO users (username, doc) VALUES ($1, $2)`, [
      u.username,
      JSON.stringify({ username: u.username, role: u.role, passwordHash: hashPassword(u.password) }),
    ])
  }
  return true
}

export async function findUser(pool, username) {
  const { rows } = await pool.query(`SELECT doc FROM users WHERE username = $1`, [String(username)])
  return rows[0]?.doc ?? null
}

export const ROLES = ['admin', 'dispatcher', 'viewer']

/** List users without password hashes. */
export async function listUsers(pool) {
  const { rows } = await pool.query(`SELECT doc FROM users ORDER BY username`)
  return rows.map((r) => ({ username: r.doc.username, role: r.doc.role }))
}

export async function countAdmins(pool) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE doc->>'role' = 'admin'`)
  return rows[0].n
}

export async function createUser(pool, { username, role, password }) {
  const u = String(username).trim()
  await pool.query(`INSERT INTO users (username, doc) VALUES ($1, $2)`, [
    u,
    JSON.stringify({ username: u, role, passwordHash: hashPassword(password) }),
  ])
}

export async function updateUser(pool, username, { role, password }) {
  const existing = await findUser(pool, username)
  if (!existing) return false
  const doc = { ...existing, role: role ?? existing.role }
  if (password) doc.passwordHash = hashPassword(password)
  await pool.query(`UPDATE users SET doc = $2 WHERE username = $1`, [username, JSON.stringify(doc)])
  return true
}

export async function deleteUser(pool, username) {
  await pool.query(`DELETE FROM users WHERE username = $1`, [username])
}
