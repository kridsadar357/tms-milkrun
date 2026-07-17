/** Client auth — talks to the server's cookie-session endpoints (same-origin). */

import type { Role } from '../types'

export interface AuthUser {
  username: string
  role: Role
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
