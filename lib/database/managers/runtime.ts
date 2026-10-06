import type { Column, Table } from 'drizzle-orm'

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
 * The Drizzle instance of a handle, on node-postgres or on PGlite. The managers look their tables
 * up by name, as a plain `Table`, and the typed `select`/`insert`/`update` accept only a `PgTable`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UntypedDb = any

export interface RuntimeHandle {
  kind: 'control' | 'tenant'
  tenantId?: string
  db: UntypedDb
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

/** A handle as the adapter builds it, with its own transaction. */
export type TransactionalHandle = RuntimeHandle & {
  execute(query: unknown): Promise<unknown>
  transaction<T>(fn: (tx: UntypedDb) => Promise<T>): Promise<T>
}

/**
 * Runs `fn` in one transaction of the handle and hands it the same handle bound to that
 * transaction, so a manager called with it writes inside the transaction without knowing it is in
 * one. A nested `transaction` is a savepoint. The bound handle must not outlive `fn`.
 */
export async function inTransaction<T>(ctx: unknown, what: string, fn: (bound: TransactionalHandle) => Promise<T>): Promise<T> {
  const handle = runtime(ctx, what) as TransactionalHandle
  return await handle.transaction(
    async (tx) =>
      await fn({
        ...handle,
        db: tx,
        execute: (query) => tx.execute(query),
        transaction: (inner) => tx.transaction(inner)
      })
  )
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
