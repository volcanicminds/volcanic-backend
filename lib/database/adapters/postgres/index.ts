import pg from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql, type SQLWrapper } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { ControlHandle, TenantHandle, GeneralConfig, Tenant } from '../../../../types/global.js'
import { appTables, registryTables, type AppTables, type RegistryTables } from '../../schema/pg.js'

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

  constructor(options: PostgresProviderOptions = {}) {
    this.controlSchema = options.schema || DEFAULT_SCHEMA
    this.maxOpenContainers = options.maxOpenContainers ?? 20

    this.pool = new pg.Pool({
      connectionString: connectionStringFrom(options),
      max: options.poolMax ?? 10,
      idleTimeoutMillis: options.idleTimeoutMs ?? 30000,
      // Pinned once, at connect time, identical on every connection: configuration, not
      // session state. It matters only for the control plane in `public`, which Drizzle
      // cannot qualify (docs/SCHEMA_V5.md §1).
      options: `-c search_path=${this.controlSchema}`
    })

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
  async tenant(tenantId: string): Promise<TenantHandle> {
    const row = await this.lookupTenant(tenantId)
    if (!row) throw new Error(`Tenant '${tenantId}' is not in the registry`)
    if (row.status !== 'active') throw new Error(`Tenant '${row.slug}' is ${row.status}`)

    return this.forLocator(row.locator, row.id) as unknown as TenantHandle
  }

  /** Builds (or reuses) the handle for a container, without going through the registry. */
  forLocator(locator: string, tenantId: string): PostgresHandle {
    let tables = this.containers.get(locator)
    if (!tables) {
      tables = appTables(locator)
      this.containers.set(locator, tables)
      if (this.containers.size > this.maxOpenContainers) {
        // Map preserves insertion order, so the first key is the least recently added.
        const oldest = this.containers.keys().next().value
        if (oldest) this.containers.delete(oldest)
      }
    }
    return this.buildHandle('tenant', tables, tenantId)
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
  if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(name)) {
    throw new Error(`Invalid identifier '${name}': it must match [a-z_][a-z0-9_]{0,62}`)
  }
  return `"${name}"`
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
