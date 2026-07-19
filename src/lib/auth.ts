/** Client auth — talks to the server's cookie-session endpoints (same-origin). */

import type { Role } from '../types'

export interface AuthUser {
  username: string
  role: Role
  driverId?: string | null
}

/** Current session, or null if not logged in. */
export async function me(): Promise<AuthUser | null> {
  try {
    const res = await fetch('/api/me')
    if (!res.ok) return null
    return (await res.json()) as AuthUser
  } catch {
    return null
  }
}

/** Log in; returns the user on success or null on bad credentials. */
export async function login(username: string, password: string): Promise<AuthUser | null> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) return null
    return (await res.json()) as AuthUser
  } catch {
    return null
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/logout', { method: 'POST' })
  } catch {
    /* ignore */
  }
}

/* -------------------------- user management (admin) ------------------ */

export interface ManagedUser {
  username: string
  role: Role
  driverId?: string | null
}

type Result = { ok: true } | { ok: false; error?: string }

async function toResult(res: Response): Promise<Result> {
  if (res.ok) return { ok: true }
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return { ok: false, error: body.error }
}

export async function listUsers(): Promise<ManagedUser[]> {
  try {
    const res = await fetch('/api/users')
    if (!res.ok) return []
    return (await res.json()) as ManagedUser[]
  } catch {
    return []
  }
}

export async function createUser(
  username: string, role: Role, password: string, driverId?: string | null,
): Promise<Result> {
  return toResult(
    await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, role, password, driverId }),
    }),
  )
}

export async function updateUser(
  username: string,
  patch: { role?: Role; password?: string; driverId?: string | null },
): Promise<Result> {
  return toResult(
    await fetch(`/api/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  )
}

export async function deleteUser(username: string): Promise<Result> {
  return toResult(await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' }))
}
