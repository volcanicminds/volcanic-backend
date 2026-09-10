/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataHandle } from '../../types/global.js'
import type { Dialect } from './query/index.js'
import { runtime } from './managers/runtime.js'
import type { SQLWrapper } from 'drizzle-orm'

//
// The inside of a handle, for the code that owns its own tables.
//
// `ControlHandle` and `TenantHandle` are brands in the core: they say WHICH container a call
// works on and carry nothing else, which is what keeps the word "Drizzle" out of every file
// outside this folder (invariant 10). That is right for the core and useless for a consuming
// project, whose own tables are not the framework's to know: without a way in, the only way
// in is a cast into `lib/`, and a cast into `lib/` is a consumer coupled to an internal path.
//
// So the data layer — where naming the ORM is allowed — offers this one door. It is the
// answer to "how does my `partner` table reach the right container", and the `locator` is the
// load-bearing part of that answer: under the `schema` strategy a consumer builds its table
// objects per schema, exactly as `appTables` does, because Drizzle prints the schema name
// into the SQL and that is what makes choosing a container a choice of object rather than a
// mutation of the connection (T-3.1).
//

export interface DataAccess {
  readonly kind: 'control' | 'tenant'
  /** The engine this handle speaks, for a consumer that keeps one schema module per dialect. */
  readonly dialect: Dialect
  readonly tenantId?: string
  /**
   * What this handle addresses: a Postgres schema, or a SQLite file. `undefined` where the
   * engine has no such thing to name — on Postgres under the `container` strategy the
   * container **is** the database the connection is attached to, so nothing is qualified.
   */
  readonly locator?: string
  /** The Drizzle instance bound to this container. */
  readonly db: any
  /** Raw SQL inside this container, for the query an ORM has no business expressing. */
  execute(query: SQLWrapper | string): Promise<any>
  transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>
}

/**
 * Open a handle. Throws — never falls back to a global — when handed nothing, which is the
 * same refusal every manager makes (invariant 3, defect D-06).
 */
export function access(handle: DataHandle, what = 'this operation'): DataAccess {
  const h = runtime(handle, what) as any
  return {
    kind: h.kind,
    dialect: h.dialect,
    tenantId: h.tenantId,
    // Postgres names a schema, SQLite names a file: both are "the thing this handle
    // addresses", and a consumer keying a table cache by it wants one field, not two.
    locator: h.locator ?? h.file,
    db: h.db,
    execute: (query: SQLWrapper | string) => h.execute(query),
    transaction: <T>(fn: (tx: any) => Promise<T>) => h.transaction(fn)
  }
}
