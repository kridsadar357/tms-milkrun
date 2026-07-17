/** Role-based access — three roles with a small capability matrix. */

import type { Role } from '../types'

export type Capability =
  | 'master' // create/edit/delete master data (locations, trucks, drivers, partners, products)
  | 'plan' // run Auto Route, edit routes, operations, POD, incidents
  | 'billing' // create/edit invoices, mark paid
  | 'admin' // settings data management, role change, fuel apply

const MATRIX: Record<Role, Capability[]> = {
  admin: ['master', 'plan', 'billing', 'admin'],
  dispatcher: ['plan', 'billing'],
  viewer: [],
}

export function can(role: Role | undefined, cap: Capability): boolean {
  return MATRIX[role ?? 'admin'].includes(cap)
}

export const ROLES: Role[] = ['admin', 'dispatcher', 'viewer']
