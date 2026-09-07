import pg from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql, type SQLWrapper } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { ControlHandle, TenantHandle, GeneralConfig, Tenant, DataRequestScope } from '../../../../types/global.js'
import { appTables, registryTables, type AppTables, type RegistryTables } from '../../schema/pg.js'
import { RequestLeases } from '../../leases.js'
import { guardPool } from './guard.js'

//
// Postgres adapter (T-2.2).
//
// The one idea in this file: **a container is a set of table objects, not a connection
// setting**. `appTables('tenant_acme')` produces tables that print their own schema into the
// SQL, so choosing a tenant is choosing an object. Nothing is written to the session, so
// nothing has to be undone before the connection goes back to the pool — which is why D-01
// cannot happen here rather than being fixed here.
//
// The two consequences worth stating:
//
//   - a request may be served by any connection of the pool without a preparation step, and
//     without a reset afterwards. That is also what makes PgBouncer in transaction mode
//     usable (T-7.1);
//   - raw SQL that genuinely needs `search_path` (migrations) runs inside a transaction with
//     `SET LOCAL`, which the commit or the rollback undoes by definition. Verified against
//     Postgres 16: inside the transaction the value applies, after it the connection is back
//     to the pinned one.
//
export interface PostgresHandle {
  readonly kind: 'control' | 'tenant'
  /** The dialect the Magic Query builds for: a handle knows its engine, callers do not ask. */
  readonly dialect: 'postgres'
  readonly tenantId?: string
  /** Drizzle bound to the pool. Shared: it holds no per-container state. */
  readonly db: NodePgDatabase
  /** The application tables, already qualified for this container. */
  readonly tables: AppTables
  /** The registry. Present on the control handle only: a container never carries it. */
  readonly registry?: RegistryTables
  execute(query: SQLWrapper | string): Promise<pg.QueryResult>
  transaction<T>(fn: (tx: NodePgDatabase) => Promise<T>): Promise<T>
}

export interface PostgresProviderOptions {
  url?: string
  schema?: string
  poolMax?: number
  idleTimeoutMs?: number
  /** LRU bound on live containers. Only meaningful for the `container` strategy (T-7.1). */
  maxOpenContainers?: number
  /**
   * A pool to use instead of opening one. The seam exists so the session-state rule of
   * T-3.1 can be proved against a double, without a database: a test hands in a recording
   * pool and reads back every statement the data layer emitted.
   */
  pool?: pg.Pool
}

const DEFAULT_SCHEMA = 'public'

function connectionStringFrom(options: PostgresProviderOptions): string {
  if (options.url) return options.url
  const host = process.env.DB_HOST || '127.0.0.1'
  const port = process.env.DB_PORT || '5432'
  const user = process.env.DB_USERNAME || 'vminds'
  const password = process.env.DB_PASSWORD || 'vminds'
  const database = process.env.DB_NAME || 'vminds'
  return `postgres://${user}:${password}@${host}:${port}/${database}`
}

export class PostgresProvider {
  private readonly pool: pg.Pool
  private readonly db: NodePgDatabase
  private readonly controlSchema: string
  private readonly registry: RegistryTables
  private readonly controlHandle: PostgresHandle
  /** Qualified table sets, keyed by schema. Plain objects: no connection is held here. */
  private readonly containers = new Map<string, AppTables>()
  private readonly maxOpenContainers: number
  private readonly leases = new RequestLeases()

  constructor(options: PostgresProviderOptions = {}) {
    this.controlSchema = options.schema || DEFAULT_SCHEMA
    this.maxOpenContainers = options.maxOpenContainers ?? 20

    const pool =
      options.pool ??
      new pg.Pool({
        connectionString: connectionStringFrom(options),
        max: options.poolMax ?? 10,
        idleTimeoutMillis: options.idleTimeoutMs ?? 30000,
        // Pinned once, at connect time, identical on every connection: configuration, not
        // session state. It matters only for the control plane in `public`, which Drizzle
        // cannot qualify (docs/SCHEMA_V5.md §1).
        options: `-c search_path=${this.controlSchema}`
      })

    // From here on the pool refuses to carry a session `search_path` (T-3.1, point 3).
    // The check sits on the driver rather than on this class so it also covers raw SQL
    // written by a consumer through `handle.execute`.
    this.pool = guardPool(pool)

    this.db = drizzle(this.pool)
    this.registry = registryTables(this.controlSchema)
    this.controlHandle = this.buildHandle('control', appTables(this.controlSchema), undefined)
  }

  private buildHandle(kind: 'control' | 'tenant', tables: AppTables, tenantId?: string): PostgresHandle {
    const db = this.db
    return {
      kind,
      dialect: 'postgres',
      tenantId,
      db,
      tables,
      registry: kind === 'control' ? this.registry : undefined,
      execute: (query) => db.execute(query as never) as unknown as Promise<pg.QueryResult>,
      transaction: (fn) => db.transaction(fn as never) as never
    }
  }

  /** The control plane: the registry, the system users, and the application data when there are no tenants. */
  control(): ControlHandle {
    return this.controlHandle as unknown as ControlHandle
  }

  /**
   * A tenant's container. The registry says where it is; the tables are built once per
   * locator and cached, because they are objects and cost nothing to keep — the LRU bound
   * exists for the `container` strategy, where a live container also means a live pool.
   */
  async tenant(tenantId: string, scope?: DataRequestScope): Promise<TenantHandle> {
    const row = await this.lookupTenant(tenantId)
    if (!row) throw new Error(`Tenant '${tenantId}' is not in the registry`)
    if (row.status !== 'active') throw new Error(`Tenant '${row.slug}' is ${row.status}`)

    return this.forLocator(row.locator, row.id, scope) as unknown as TenantHandle
  }

  /** Builds (or reuses) the handle for a container, without going through the registry. */
  forLocator(locator: string, tenantId: string, scope?: DataRequestScope): PostgresHandle {
    // Validated BEFORE it is used as a cache key: the name reaches `pgSchema()`, which
    // prints it into every statement built from these tables. A locator that has not been
    // through here has no business being remembered either (T-3.1, "attenzione").
    assertLocator(locator)
    this.leases.take(scope, locator)

    let tables = this.containers.get(locator)
    if (tables) {
      // Reinsert so the key order is recency, not first use: without this the bound evicts
      // the container the whole deployment is hammering and keeps the idle ones.
      this.containers.delete(locator)
    } else {
      tables = appTables(locator)
    }
    this.containers.set(locator, tables)
    this.evictContainers()

    return this.buildHandle('tenant', tables, tenantId)
  }

  /** Trims the cache to its bound, never dropping a container a live request is holding. */
  private evictContainers(): void {
    if (this.containers.size <= this.maxOpenContainers) return
    for (const locator of [...this.containers.keys()]) {
      if (this.containers.size <= this.maxOpenContainers) break
      if (this.leases.inUse(locator)) continue
      this.containers.delete(locator)
    }
  }

  /**
   * The single release point (T-3.1, point 4).
   *
   * On this adapter it gives back bookkeeping and nothing else, and that is the whole
   * result of the task rather than an omission: a container is a set of qualified table
   * objects, so a request never holds a connection between statements: each one is checked
   * out and returned by the driver, unchanged. There is no session state to undo, so no
   * ordering to get right, which is precisely what v4 got wrong (D-01).
   *
   * `error` is accepted, and ignored here, for the day T-7.1 gives a container its own pool:
   * a connection handed back after the client went away must be destroyed, not reused, and
   * this is the method that will do it. Nothing else may.
   */
  async releaseRequestScope(scope: DataRequestScope, _error?: Error): Promise<void> {
    if (!scope || scope.released) return
    scope.released = true
    this.leases.release(scope)
    this.evictContainers()
  }

  private async lookupTenant(tenantId: string): Promise<Tenant | null> {
    const rows = await this.db.select().from(this.registry.tenant).where(eq(this.registry.tenant.id, tenantId)).limit(1)
    return (rows[0] as unknown as Tenant) ?? null
  }

  /**
   * Creates a tenant's schema. Used by provisioning (T-6.1) and by the test harness.
   * The name is quoted through the driver's identifier escaping, never concatenated raw.
   */
  async createSchema(locator: string): Promise<void> {
    await this.db.execute(sql.raw(`create schema if not exists ${escapeIdentifier(locator)}`))
  }

  async dropSchema(locator: string): Promise<void> {
    await this.db.execute(sql.raw(`drop schema if exists ${escapeIdentifier(locator)} cascade`))
  }

  async shutdown(): Promise<void> {
    await this.pool.end()
  }
}

/** Postgres identifiers cannot be parameterized: they are validated, then quoted. */
export function escapeIdentifier(name: string): string {
  assertLocator(name)
  return `"${name}"`
}

/**
 * The one gate a schema name goes through. Same rule as v4, which was already correct
 * (appendix B), applied in one more place: v5 also uses the name as a cache key, and a key
 * is a name that outlives the request that brought it.
 */
export function assertLocator(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(name)) {
    throw new Error(`Invalid identifier '${name}': it must match [a-z_][a-z0-9_]{0,62}`)
  }
  return name
}

export function createPostgresProvider(options: GeneralConfig['options']): PostgresProvider {
  const control = options?.control
  const containers = options?.tenants?.containers
  return new PostgresProvider({
    url: control?.url,
    schema: control?.schema,
    poolMax: control?.pool?.max,
    idleTimeoutMs: control?.pool?.idleTimeoutMs,
    maxOpenContainers: containers?.maxOpen
  })
}
