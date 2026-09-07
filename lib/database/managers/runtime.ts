import type { Column, Table } from 'drizzle-orm'
import type { Dialect } from '../query/index.js'

//
// The runtime side of a handle.
//
// The public types (ControlHandle, TenantHandle) are brands: they say WHICH container a call
// works on and carry nothing else, so the core never names an ORM. Inside the data layer the
// same object has a shape, and this is it.
//
// `runtime()` is also where invariant 3 becomes a runtime guarantee: a manager called without
// a handle throws. In v4 the equivalent call fell back to the global connection, which meant
// reading whatever container the pool happened to hand over (D-06).
//
export interface RuntimeHandle {
  kind: 'control' | 'tenant'
  dialect: Dialect
  tenantId?: string
  db: any
  tables: Record<string, Table>
  registry?: Record<string, Table>
}

export function runtime(ctx: unknown, what = 'this operation'): RuntimeHandle {
  const handle = ctx as RuntimeHandle
  if (!handle?.db || !handle?.tables) {
    throw new Error(`${what} needs a data handle: pass req.tenant ?? req.control, never nothing`)
  }
  return handle
}

/** The control plane, demanded explicitly: the registry is not readable from a container. */
export function control(ctx: unknown, what = 'this operation'): RuntimeHandle {
  const handle = runtime(ctx, what)
  if (!handle.registry) throw new Error(`${what} works on the control plane: pass req.control`)
  return handle
}

export const table = (handle: RuntimeHandle, name: string): Table => {
  const found = tableIfKnown(handle, name)
  if (!found) throw new Error(`Table '${name}' is not part of this handle`)
  return found
}

/**
 * The same lookup where NOT knowing the table is an answer rather than a failure.
 *
 * The framework knows its own tables and nothing else: a consumer's entities live in the
 * consumer's schema and are never registered here (v4 had `global.entity`, v5 does not).
 * The tracker needs to tell those two cases apart, because "I cannot read the previous
 * state of your table" is not the same event as "the audit write failed".
 */
export const tableIfKnown = (handle: RuntimeHandle, name: string): Table | null => {
  const key = name in handle.tables || name in (handle.registry ?? {}) ? name : name.toLowerCase()
  return handle.tables[key] ?? handle.registry?.[key] ?? null
}

export const column = (t: Table, name: string): Column => (t as unknown as Record<string, Column>)[name]
