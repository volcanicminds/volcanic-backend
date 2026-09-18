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
/**
 * The Drizzle instance of either dialect. The managers run one query code path over Postgres and
 * SQLite against tables looked up by name, and the two database classes share no callable
 * supertype for `select`/`insert`/`update` over a `Table` chosen at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CrossDialectDb = any

export interface RuntimeHandle {
  kind: 'control' | 'tenant'
  dialect: Dialect
  tenantId?: string
  db: CrossDialectDb
  tables: Record<string, Table>
  registry?: Record<string, Table>
}

export function runtime(ctx: unknown, what = 'this operation'): RuntimeHandle {
  const handle = ctx as RuntimeHandle
  if (!handle?.db || !handle?.tables) {
    // It suggests `dataContext(req)` and not `req.tenant ?? req.control`, which is what this
    // message said until T-10.2: the second form answers a request that lost its container
    // with the control plane, so a message written to fix one defect was teaching another.
    throw new Error(`${what} needs a data handle: pass dataContext(req), never nothing`)
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
