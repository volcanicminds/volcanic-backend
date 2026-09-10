import pg from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql, type SQLWrapper } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { ControlHandle, TenantHandle, GeneralConfig, Tenant, DataRequestScope } from '../../../../types/global.js'
import { appTables, registryTables, type AppTables, type RegistryTables } from '../../schema/pg.js'
import { RequestLeases } from '../../leases.js'
import { exportPostgresSchema } from '../../containers/export.js'
import { guardPool } from './guard.js'
import { envInt, envString } from '../../env.js'

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
  /** The schema this handle addresses, when it addresses one. Raw SQL is run inside it. */
  readonly locator?: string
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
  /** `schema` (containers are schemas of one database) or `container` (one database each). */
  strategy?: 'schema' | 'container'
  /** Pool size of ONE container's database, under the `container` strategy. */
  containerPoolMax?: number
  /** A container idle for this long is closed and its connections given back. */
  containerIdleMs?: number
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
  private readonly url: string
  readonly strategy: 'schema' | 'container'
  private readonly containerPoolMax: number
  private readonly containerIdleMs: number

  //
  // Live container databases, most recently used last (T-7.1).
  //
  // Only the `container` strategy has these, and only they cost anything: under `schema` a
  // container is a set of table objects on the shared pool, so "open" means nothing. Here an
  // open container is a POOL, which is at least one connection held on the server, and the
  // measured constraint of appendix A.3 is the connection and not the ORM: at
  // `max_connections = 100`, 150 containers each holding one fail with "too many clients".
  //
  // So they are opened on demand, bounded by an LRU well below what the server allows, and
  // closed when idle. Twenty live containers serving three hundred tenants is the shape; one
  // pool per tenant is the shape that stops working on the day the sales team succeeds.
  //
  private readonly openContainers = new Map<string, { pool: pg.Pool; db: NodePgDatabase; tables: AppTables; usedAt: number }>()
  private sweeper: ReturnType<typeof setInterval> | null = null

  constructor(options: PostgresProviderOptions = {}) {
    this.controlSchema = options.schema || DEFAULT_SCHEMA
    this.maxOpenContainers = options.maxOpenContainers ?? 20
    this.strategy = options.strategy || 'schema'
    this.containerPoolMax = options.containerPoolMax ?? 2
    this.containerIdleMs = options.containerIdleMs ?? 300000

    this.url = connectionStringFrom(options)

    const pool =
      options.pool ??
      new pg.Pool({
        connectionString: this.url,
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
    this.controlHandle = this.buildHandle('control', appTables(this.controlSchema), undefined, this.controlSchema)
  }

  private buildHandle(kind: 'control' | 'tenant', tables: AppTables, tenantId?: string, locator?: string): PostgresHandle {
    const db = this.db

    //
    // RAW SQL on a tenant handle runs inside the container, and this is the reason it needs
    // saying (T-6.1, found by the bench of T-0.2).
    //
    // Choosing a container is choosing table objects, and that works because drizzle prints
    // the schema into the SQL it builds. Raw SQL has no table objects: `execute('select ...
    // from widget')` is a string, so it resolved against the connection's pinned
    // `search_path` and read the CONTROL plane, silently, from a handle whose whole meaning
    // is "inside this customer's data". An implicit context is exactly what this rewrite
    // exists to remove, and it had grown back in the one place qualification cannot reach.
    //
    // So a raw statement on a tenant handle is wrapped in a transaction with `SET LOCAL`,
    // which is the use of `search_path` T-3.1 sanctions: undone by the commit, never left on
    // a pooled connection. Statements built from the qualified tables are unaffected, because
    // they already name their schema.
    //
    const enter = async (tx: any) => {
      if (locator) await tx.execute(sql.raw(`set local search_path to ${escapeIdentifier(locator)}`))
    }

    const execute: PostgresHandle['execute'] =
      kind === 'tenant' && locator
        ? (query) =>
            db.transaction(async (tx) => {
              await enter(tx)
              return (await tx.execute(query as never)) as unknown as pg.QueryResult
            }) as Promise<pg.QueryResult>
        : (query) => db.execute(query as never) as unknown as Promise<pg.QueryResult>

    const transaction: PostgresHandle['transaction'] =
      kind === 'tenant' && locator
        ? (fn) =>
            db.transaction(async (tx) => {
              await enter(tx)
              return await fn(tx as never)
            }) as never
        : (fn) => db.transaction(fn as never) as never

    return {
      kind,
      dialect: 'postgres',
      tenantId,
      locator,
      db,
      tables,
      registry: kind === 'control' ? this.registry : undefined,
      execute,
      transaction
    }
  }

  /**
   * Refuses to start when the configured pools cannot fit in the server (T-7.1, point 3).
   *
   * The arithmetic is the measured constraint of appendix A.3: what runs out first is
   * connections, not memory and not ORM objects. `maxOpen` live containers times the pool of
   * each, plus the control pool, has to fit under `max_connections` with room for everything
   * else that talks to this server. Discovering that at the two-hundredth tenant means
   * discovering it in production, so it is checked once, at boot, and it is fatal.
   *
   * The reserve is not a safety blanket: `max_connections` includes superuser slots,
   * replication, the monitoring agent and the operator's own psql. A framework that plans to
   * use all of it plans to be the reason nobody can log in to fix it.
   */
  async assertConnectionBudget(onFatal?: (message: string) => void): Promise<void> {
    if (this.strategy !== 'container') return

    const fail =
      onFatal ||
      ((message: string) => {
        if (globalThis.log?.f) globalThis.log.fatal(message)
        process.exit(1)
      })

    let available: number
    try {
      const result: any = await this.db.execute(sql.raw('show max_connections'))
      available = Number(result.rows?.[0]?.max_connections ?? 0)
    } catch (e) {
      return fail(`Startup: cannot read max_connections to size the container pools: ${(e as Error)?.message}`)
    }
    if (!Number.isFinite(available) || available <= 0) return

    const RESERVE = 20
    const controlPool = Number((this.pool as unknown as { options?: { max?: number } }).options?.max ?? 10)
    const wanted = this.maxOpenContainers * this.containerPoolMax + controlPool
    if (wanted + RESERVE > available) {
      return fail(
        `Startup: the container pools do not fit. ${this.maxOpenContainers} live containers x ${this.containerPoolMax} ` +
          `connections plus the control pool is ${wanted}, the server allows ${available}, and ${RESERVE} are left for ` +
          'everything else that talks to it. Lower tenants.containers.maxOpen or poolMax, or raise max_connections.'
      )
    }

    if (this.maxOpenContainers > 100 && globalThis.log?.w) {
      globalThis.log.warn(
        `Postgres: ${this.maxOpenContainers} live containers is past where PgBouncer in transaction mode is the ` +
          'recommended configuration. The framework holds no session state, so it is already compatible.'
      )
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

    return (await this.forLocator(row.locator, row.id, scope)) as unknown as TenantHandle
  }

  /**
   * Builds (or reuses) the handle for a container, without going through the registry.
   *
   * Async because under the `container` strategy it may have to open a pool, and one entry
   * point that sometimes opens a connection is better than two that differ by strategy: the
   * caller asks for a container, and where that container lives is the adapter's business.
   */
  async forLocator(locator: string, tenantId: string, scope?: DataRequestScope): Promise<PostgresHandle> {
    // Validated BEFORE it is used as a cache key or a database name: it reaches `pgSchema()`,
    // which prints it into every statement built from these tables, and `CREATE DATABASE`,
    // which cannot parameterise it. A locator that has not been through here has no business
    // being remembered either (T-3.1, "attenzione").
    assertLocator(locator)
    this.leases.take(scope, locator)

    if (this.strategy === 'container') return await this.openContainer_(locator, tenantId)

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

    return this.buildHandle('tenant', tables, tenantId, locator)
  }

  /**
   * One database per tenant: its own pool, opened on demand and closed when idle (T-7.1).
   *
   * The tables are UNQUALIFIED here, deliberately. Under `schema` the container is a schema
   * name printed into the SQL; under `container` the container is the database the connection
   * is attached to, so qualifying would name a schema that does not exist. That is also why
   * this handle carries no locator: there is no `SET LOCAL search_path` to do, because raw SQL
   * is already inside the right database.
   */
  private async openContainer_(locator: string, tenantId: string): Promise<PostgresHandle> {
    const live = this.openContainers.get(locator)
    if (live) {
      live.usedAt = Date.now()
      this.openContainers.delete(locator)
      this.openContainers.set(locator, live)
      return this.buildContainerHandle(live.db, live.tables, tenantId)
    }

    const pool = guardPool(
      new pg.Pool({
        connectionString: databaseUrl(this.url, locator),
        max: this.containerPoolMax,
        idleTimeoutMillis: 10000
      })
    )

    const entry = { pool, db: drizzle(pool), tables: appTables('public'), usedAt: Date.now() }
    this.openContainers.set(locator, entry)
    await this.closeSurplusContainers()
    this.startSweeper()

    return this.buildContainerHandle(entry.db, entry.tables, tenantId)
  }

  private buildContainerHandle(db: NodePgDatabase, tables: AppTables, tenantId: string): PostgresHandle {
    return {
      kind: 'tenant',
      dialect: 'postgres',
      tenantId,
      db,
      tables,
      registry: undefined,
      execute: (query) => db.execute(query as never) as unknown as Promise<pg.QueryResult>,
      transaction: (fn) => db.transaction(fn as never) as never
    }
  }

  /**
   * Closes the containers past the bound, oldest first, never one a request is holding.
   *
   * Closing means giving connections back to the server, which is the resource the whole
   * bound exists to protect. A container in use stays open even over the bound: exceeding a
   * cache limit costs memory, closing a pool under a running query costs the request.
   */
  private async closeSurplusContainers(): Promise<void> {
    for (const locator of [...this.openContainers.keys()]) {
      if (this.openContainers.size <= this.maxOpenContainers) break
      if (this.leases.inUse(locator)) continue
      await this.closeContainer_(locator)
    }
  }

  private async closeContainer_(locator: string): Promise<void> {
    const entry = this.openContainers.get(locator)
    if (!entry) return
    this.openContainers.delete(locator)
    try {
      await entry.pool.end()
    } catch (e) {
      if (globalThis.log?.w) globalThis.log.warn(`Postgres: could not close the container ${locator}: ${(e as Error)?.message}`)
    }
  }

  /** Closes what nobody has touched for a while: an idle pool is connections held for nothing. */
  private startSweeper(): void {
    if (this.sweeper || this.containerIdleMs <= 0) return
    this.sweeper = setInterval(() => void this.closeIdleContainers(), Math.max(30000, Math.floor(this.containerIdleMs / 4)))
    // Never keep the process alive just to close idle pools.
    this.sweeper.unref?.()
  }

  /**
   * The sweep itself, separate from the timer that calls it, so it can be asked for directly.
   * A test of "an idle container is closed" that waits for a thirty-second interval is a test
   * nobody runs, and one that checks the timer was scheduled proves the schedule.
   */
  async closeIdleContainers(now = Date.now()): Promise<string[]> {
    const closed: string[] = []
    if (this.containerIdleMs <= 0) return closed

    const cutoff = now - this.containerIdleMs
    for (const [locator, entry] of [...this.openContainers.entries()]) {
      if (entry.usedAt >= cutoff || this.leases.inUse(locator)) continue
      await this.closeContainer_(locator)
      closed.push(locator)
    }
    return closed
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
   * Takes a customer's data out, through `pg_dump`, limited to their schema (T-6.2).
   *
   * The connection string is the provider's, not the caller's: an export route reachable over
   * HTTP must not decide which database it reads from any more than it decides where it
   * writes.
   */
  async exportContainer(tenant: Tenant, request: { directory?: string; schemaVersion: string | null }) {
    return await exportPostgresSchema(tenant, { ...request, url: this.url })
  }

  /**
   * What is in a container, for the preview of phase 1 (T-6.3).
   *
   * Exact row counts, not estimates from the planner statistics: an operator is about to type
   * a slug by hand to destroy this, and "about 40,000 rows" is not a number to make that
   * decision on. It costs a sequential scan per table, and this runs once per destruction.
   */
  async inspectContainer(tenant: Tenant) {
    assertLocator(tenant.locator)
    const handle: any = await this.forLocator(tenant.locator, tenant.id)

    const tables: any = await handle.execute(
      sql.raw(
        `select table_name from information_schema.tables ` +
          `where table_schema = '${tenant.locator}' and table_type = 'BASE TABLE' order by table_name`
      )
    )

    const rowCounts: Record<string, number> = {}
    for (const row of tables.rows ?? []) {
      const counted: any = await handle.execute(sql.raw(`select count(*)::int as n from ${escapeIdentifier(row.table_name)}`))
      rowCounts[row.table_name] = Number(counted.rows?.[0]?.n ?? 0)
    }

    const size: any = await this.db.execute(
      sql.raw(
        `select coalesce(sum(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))), 0)::bigint as bytes ` +
          `from pg_tables where schemaname = '${tenant.locator}'`
      )
    )

    return {
      locator: tenant.locator,
      sizeBytes: Number(size.rows?.[0]?.bytes ?? 0),
      rowCounts,
      schemaVersion: tenant.schemaVersion ?? null
    }
  }

  /** Opens a tenant's container by id. The name the manager port uses (T-6.1). */
  async openContainer(tenantId: string): Promise<TenantHandle> {
    return await this.tenant(tenantId)
  }

  /** Creates the container of a tenant that is being provisioned (T-6.1). */
  async createContainer(tenant: Tenant): Promise<void> {
    await this.createSchema(tenant.locator)
  }

  /**
   * Removes a container that was created moments ago and could not be finished (T-6.1).
   *
   * NOT how a tenant's data is destroyed: that is T-6.3, two phases, an export first and a
   * second factor. This undoes a provisioning that failed before the registry row was
   * written, so what it drops is a schema that has never held a customer's data and that
   * nothing points at.
   */
  async dropContainer(locator: string): Promise<void> {
    await this.dropSchema(locator)
    this.containers.delete(locator)
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

  /**
   * Runs `fn` while holding an advisory lock on a container, or answers `null` when someone
   * else already holds it (T-5.3).
   *
   * A DEDICATED client, not a pooled query: a Postgres advisory lock belongs to the session
   * that took it, so taking one on a connection that goes back to the pool would leave the
   * lock on a connection any later request could be handed. That is D-01 wearing a different
   * hat, and it is why the client is checked out for the whole of `fn` and released in a
   * `finally`.
   *
   * `pg_try_advisory_lock` and not `pg_advisory_lock`: a fleet migrator that BLOCKS on a
   * container someone else is migrating turns two operators into a deadlock with a queue.
   * Not acquiring is an outcome to report, not a reason to wait.
   */
  async withContainerLock<T>(locator: string, fn: () => Promise<T>): Promise<T | null> {
    assertLocator(locator)
    const client = await this.pool.connect()
    try {
      const key = advisoryKey(locator)
      const taken = await client.query('select pg_try_advisory_lock($1) as ok', [key])
      if (!taken.rows[0]?.ok) return null
      try {
        return await fn()
      } finally {
        await client.query('select pg_advisory_unlock($1)', [key])
      }
    } finally {
      client.release()
    }
  }

  async shutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
    for (const locator of [...this.openContainers.keys()]) await this.closeContainer_(locator)
    await this.pool.end()
  }
}

/**
 * A stable 64-bit key for a container name.
 *
 * Computed here rather than with `hashtext()` so the value does not depend on a Postgres
 * internal that is explicitly documented as not stable across versions: an advisory lock
 * whose key changes with a server upgrade is a lock that stops locking on the day of the
 * upgrade, silently.
 */
export function advisoryKey(locator: string): string {
  let hash = 0n
  for (const char of locator) {
    hash = (hash * 131n + BigInt(char.charCodeAt(0))) % 9223372036854775783n
  }
  // Postgres advisory keys are signed 64-bit; the modulus above keeps it in range.
  return hash.toString()
}

/**
 * The same server, a different database.
 *
 * Under the `container` strategy a tenant's data is a database of its own, so the connection
 * string is the control one with the database swapped. Built with the URL parser rather than
 * by string surgery: a password with a `/` in it is not a reason to connect somewhere else.
 */
export function databaseUrl(controlUrl: string, database: string): string {
  const url = new URL(controlUrl)
  url.pathname = `/${database}`
  return url.toString()
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
  const tenants = options?.tenants
  const containers = tenants?.containers
  return new PostgresProvider({
    url: control?.url,
    schema: control?.schema,
    poolMax: control?.pool?.max,
    idleTimeoutMs: control?.pool?.idleTimeoutMs,
    // The environment is the fallback, not the override: a deployment that declared the
    // number in its configuration meant that number. The variable exists for the deployments
    // that tune from outside the repository, and until T-9.4 it was documented and read by
    // nobody (D-11 in another shape).
    maxOpenContainers: containers?.maxOpen ?? envInt('TENANT_CONTAINERS_MAX_OPEN', 20, { min: 1, max: 10_000 }),
    // One database per tenant only where the configuration says so: `schema` stays the
    // default and the shape everything else in the framework was built around.
    strategy: tenants?.strategy === 'container' ? 'container' : 'schema',
    containerPoolMax: containers?.poolMax,
    containerIdleMs: containers?.idleTimeoutMs
  })
}
