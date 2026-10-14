import pg from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type { PGlite } from '@electric-sql/pglite'
import { sql, type SQLWrapper } from 'drizzle-orm'
import type { ControlHandle, TenantHandle, GeneralConfig, Tenant, DataRequestScope } from '../../../../types/global.js'
import { appTables, registryTables, type AppTables, type RegistryTables } from '../../schema/pg.js'
import { RequestLeases } from '../../leases.js'
import { exportPostgres } from '../../containers/export.js'
import { guardPglite, guardPool } from './guard.js'
import { firstBy } from '../../prepared.js'
import { envInt } from '../../env.js'

//
// Postgres adapter.
//
// The one idea in this file: **a container is a set of table objects, not a connection
// setting**. `appTables('tenant_acme')` produces tables that print their own schema into the
// SQL, so choosing a tenant is choosing an object. Nothing is written to the session, so
// nothing has to be undone before the connection goes back to the pool.
//
// The two consequences worth stating:
//
//   - a request may be served by any connection of the pool without a preparation step, and
//     without a reset afterwards. That is also what makes PgBouncer in transaction mode
//     usable;
//   - raw SQL that genuinely needs `search_path` (migrations) runs inside a transaction with
//     `SET LOCAL`, which the commit or the rollback undoes by definition. Verified against
//     Postgres 16: inside the transaction the value applies, after it the connection is back
//     to the pinned one.
//
// The same code runs on PGlite: Postgres compiled to WebAssembly, inside the process,
// for development and tests. Same dialect, same tables, same migrations, same session guard;
// what it lacks is a server, so there is no pool to size, no database per tenant, no
// `pg_dump`.
//

/** Drizzle bound to PGlite, as `openPglite()` returns it. */
export type PgliteDb = PgliteDatabase & { $client: PGlite }

/** Drizzle over either driver: a pool of `pg` connections, or one PGlite instance. */
export type PgDb = NodePgDatabase | PgliteDb

/** What raw SQL answers on both drivers: `pg` and PGlite agree on `rows`, and on little else. */
export interface RawRows<T = Record<string, unknown>> {
  rows: T[]
}

export interface PostgresHandle {
  readonly kind: 'control' | 'tenant'
  readonly tenantId?: string
  /** The schema this handle addresses, when it addresses one. Raw SQL is run inside it. */
  readonly locator?: string
  /** Drizzle bound to the pool, or to PGlite. Shared: it holds no per-container state. */
  readonly db: PgDb
  /** The application tables, already qualified for this container. */
  readonly tables: AppTables
  /** The registry. Present on the control handle only: a container never carries it. */
  readonly registry?: RegistryTables
  execute<T = Record<string, unknown>>(query: SQLWrapper | string): Promise<RawRows<T>>
  transaction<T>(fn: (tx: PgDb) => Promise<T>): Promise<T>
  /** Text SQL with bound `$n` parameters, inside this container like `execute`. */
  readonly raw: RawSql
}

/** One statement of text SQL with its bound parameters. */
export type RawQuery = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<RawRows<T>>

/**
 * SQL written by hand, with bound parameters, for code that owns its own tables and writes its own
 * statements: a package that is not built on the ORM. Same container rule as `execute`: on a
 * tenant handle under the `schema` strategy every statement runs in a transaction with `SET LOCAL
 * search_path`, so an unqualified table is the tenant's and never the control plane's.
 */
export interface RawSql {
  query: RawQuery
  /** `run` in one transaction: committed if it resolves, rolled back if it throws. */
  transaction<T>(run: (query: RawQuery) => Promise<T>): Promise<T>
}

export interface PostgresProviderOptions {
  url?: string
  schema?: string
  poolMax?: number
  idleTimeoutMs?: number
  /** LRU bound on live containers. Only meaningful for the `container` strategy. */
  maxOpenContainers?: number
  /** `schema` (containers are schemas of one database) or `container` (one database each). */
  strategy?: 'schema' | 'container'
  /** Pool size of ONE container's database, under the `container` strategy. */
  containerPoolMax?: number
  /** A container idle for this long is closed and its connections given back. */
  containerIdleMs?: number
  /**
   * A pool to use instead of opening one. The seam exists so the session-state rule can be
   * proved against a double, without a database: a test hands in a recording pool and reads
   * back every statement the data layer emitted.
   */
  pool?: pg.Pool
  /**
   * Drizzle on a PGlite instance, used instead of a pool; `openPglite()` builds one.
   * The provider owns it from here on: `shutdown()` closes it.
   */
  pglite?: PgliteDb
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
  /** Absent on PGlite, which has one session and no pool. */
  private readonly pool: pg.Pool | null
  /** Present on PGlite only. */
  private readonly pglite: PGlite | null
  private readonly db: PgDb
  /** Which driver runs underneath. The dialect is Postgres either way. */
  readonly engine: 'postgres' | 'pglite'
  /** Container locks held by this process: the PGlite form of an advisory lock (`withContainerLock`). */
  private readonly heldLocks = new Set<string>()
  private readonly controlSchema: string
  private readonly registry: RegistryTables
  private readonly controlHandle: PostgresHandle
  /** Qualified table sets, keyed by schema. Plain objects: no connection is held here. */
  private readonly containers = new Map<string, AppTables>()
  private readonly maxOpenContainers: number
  private readonly leases = new RequestLeases()
  /** Absent on PGlite: there is no server, so what needs one asks `serverUrl()` and is refused by name. */
  private readonly url: string | null
  readonly strategy: 'schema' | 'container'
  private readonly containerPoolMax: number
  private readonly containerIdleMs: number

  //
  // Live container databases, most recently used last.
  //
  // Only the `container` strategy has these, and only they cost anything: under `schema` a
  // container is a set of table objects on the shared pool, so "open" means nothing. Here an
  // open container is a POOL, which is at least one connection held on the server, and the
  // measured constraint is the connection and not the ORM: at `max_connections = 100`, 150
  // containers each holding one fail with "too many clients".
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

    if (options.pglite) {
      refuseContainersOnPglite(this.strategy)
      this.engine = 'pglite'
      this.url = null
      this.pool = null
      // The pool's refusal below, on the one session PGlite has.
      this.pglite = guardPglite(options.pglite.$client)
      this.db = options.pglite
    } else {
      this.engine = 'postgres'
      this.url = connectionStringFrom(options)
      this.pglite = null

      // A pool handed in is the caller's, and so are its listeners.
      const pool =
        options.pool ??
        reportIdleErrors(
          new pg.Pool({
            connectionString: this.url,
            max: options.poolMax ?? 10,
            idleTimeoutMillis: options.idleTimeoutMs ?? 30000,
            // Pinned once, at connect time, identical on every connection: configuration, not
            // session state. It matters only for the control plane in `public`, which Drizzle
            // cannot qualify (docs/SCHEMA_V5.md §1).
            options: `-c search_path=${this.controlSchema}`
          }),
          'the control plane'
        )

      // From here on the pool refuses to carry a session `search_path`.
      // The check sits on the driver rather than on this class so it also covers raw SQL
      // written by a consumer through `handle.execute`.
      this.pool = guardPool(pool)
      this.db = drizzle(this.pool)
    }

    this.registry = registryTables(this.controlSchema)
    this.controlHandle = this.buildHandle('control', appTables(this.controlSchema), undefined, this.controlSchema)
  }

  private buildHandle(kind: 'control' | 'tenant', tables: AppTables, tenantId?: string, locator?: string): PostgresHandle {
    const db = this.db

    //
    // RAW SQL on a tenant handle runs inside the container.
    //
    // Choosing a container is choosing table objects, and that works because drizzle prints
    // the schema into the SQL it builds. Raw SQL has no table objects: `execute('select ...
    // from widget')` is a string, so on its own it resolves against the connection's pinned
    // `search_path` and reads the CONTROL plane, silently, from a handle whose whole meaning
    // is "inside this customer's data". That is the one place qualification cannot reach.
    //
    // So a raw statement on a tenant handle is wrapped in a transaction with `SET LOCAL`,
    // which is the use of `search_path` the session-state rule allows: undone by the commit,
    // never left on a pooled connection. Statements built from the qualified tables are
    // unaffected, because they already name their schema.
    //
    const enter = async (tx: { execute(query: SQLWrapper): Promise<unknown> }) => {
      if (locator) await tx.execute(sql.raw(`set local search_path to ${escapeIdentifier(locator)}`))
    }

    const execute: PostgresHandle['execute'] =
      kind === 'tenant' && locator
        ? (query) =>
            db.transaction(async (tx) => {
              await enter(tx)
              return (await tx.execute(query as never)) as never
            }) as never
        : (query) => db.execute(query as never) as never

    const transaction: PostgresHandle['transaction'] =
      kind === 'tenant' && locator
        ? (fn) =>
            db.transaction(async (tx) => {
              await enter(tx)
              return await fn(tx as never)
            }) as never
        : (fn) => db.transaction(fn as never) as never

    // The control handle needs no `SET LOCAL`: its pool is pinned to the control schema already.
    const inside = kind === 'tenant' ? locator : undefined
    const raw = this.pglite ? pgliteRawSql(this.pglite, inside) : poolRawSql(this.pool!, inside)

    return {
      kind,
      tenantId,
      locator,
      db,
      tables,
      registry: kind === 'control' ? this.registry : undefined,
      execute,
      transaction,
      raw
    }
  }

  /**
   * Refuses to start when the configured pools cannot fit in the server.
   *
   * The arithmetic is the measured constraint: what runs out first is connections, not memory
   * and not ORM objects. `maxOpen` live containers times the pool of each, plus the control
   * pool, has to fit under `max_connections` with room for everything else that talks to this
   * server. Discovering that at the two-hundredth tenant means
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
      const result = await this.db.execute(sql.raw('show max_connections'))
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
   * A tenant's container. The registry row says where it is, and the caller has just read it:
   * reading it again here would be a second registry query on every request. The tables
   * are built once per locator and cached, because they are objects and cost nothing to keep;
   * the LRU bound exists for the `container` strategy, where a live container also means a
   * live pool.
   */
  async tenant(row: Tenant, scope?: DataRequestScope): Promise<TenantHandle> {
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
    // being remembered either.
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
   * One database per tenant: its own pool, opened on demand and closed when idle.
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
      return this.buildContainerHandle(live, tenantId)
    }

    const pool = guardPool(
      reportIdleErrors(
        new pg.Pool({
          connectionString: databaseUrl(this.serverUrl('A database per tenant'), locator),
          max: this.containerPoolMax,
          idleTimeoutMillis: 10000
        }),
        `the container ${locator}`
      )
    )

    const entry = { pool, db: drizzle(pool), tables: appTables('public'), usedAt: Date.now() }
    this.openContainers.set(locator, entry)
    await this.closeSurplusContainers()
    this.startSweeper()

    return this.buildContainerHandle(entry, tenantId)
  }

  private buildContainerHandle(
    { pool, db, tables }: { pool: pg.Pool; db: NodePgDatabase; tables: AppTables },
    tenantId: string
  ): PostgresHandle {
    return {
      kind: 'tenant',
      tenantId,
      db,
      tables,
      registry: undefined,
      execute: (query) => db.execute(query as never) as never,
      transaction: (fn) => db.transaction(fn as never) as never,
      raw: poolRawSql(pool)
    }
  }

  /** The server's connection string. PGlite has none, so whatever needs a server is refused by name. */
  private serverUrl(what: string): string {
    if (this.url === null) {
      throw new Error(`${what} needs a Postgres server: PGlite runs inside this process and has none`)
    }
    return this.url
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
   * The single release point.
   *
   * On this adapter it gives back bookkeeping and nothing else, by design rather than by
   * omission: a container is a set of qualified table objects, so a request never holds a
   * connection between statements: each one is checked out and returned by the driver,
   * unchanged. There is no session state to undo, so no ordering to get right.
   *
   * `error` is accepted, and ignored here, for the day a container gets its own pool:
   * a connection handed back after the client went away must be destroyed, not reused, and
   * this is the method that will do it. Nothing else may.
   */
  async releaseRequestScope(scope: DataRequestScope, _error?: Error): Promise<void> {
    if (!scope || scope.released) return
    scope.released = true
    this.leases.release(scope)
    this.evictContainers()
  }

  /**
   * Takes a customer's data out, through `pg_dump`: their schema, or under the `container`
   * strategy their whole database.
   *
   * The connection string is the provider's, not the caller's: an export route reachable over
   * HTTP must not decide which database it reads from any more than it decides where it
   * writes. On PGlite there is no server for `pg_dump` to reach, so the export is refused.
   */
  async exportContainer(tenant: Tenant, request: { directory?: string; schemaVersion: string | null }) {
    const server = this.serverUrl('Export (pg_dump)')
    if (this.strategy === 'container') {
      return await exportPostgres(tenant, { ...request, url: databaseUrl(server, tenant.locator), wholeDatabase: true })
    }
    return await exportPostgres(tenant, { ...request, url: server })
  }

  /**
   * What is in a container, for the preview of a destruction's first phase.
   *
   * Exact row counts, not estimates from the planner statistics: an operator is about to type
   * a slug by hand to destroy this, and "about 40,000 rows" is not a number to make that
   * decision on. It costs a sequential scan per table, and this runs once per destruction.
   */
  async inspectContainer(tenant: Tenant) {
    assertLocator(tenant.locator)
    const handle = await this.forLocator(tenant.locator, tenant.id)
    // Under `container` the tables sit in the tenant database's own `public`.
    const schema = this.strategy === 'container' ? 'public' : tenant.locator

    const tables = await handle.execute<{ table_name: string }>(
      sql.raw(
        `select table_name from information_schema.tables ` +
          `where table_schema = '${schema}' and table_type = 'BASE TABLE' order by table_name`
      )
    )

    const rowCounts: Record<string, number> = {}
    for (const row of tables.rows ?? []) {
      const counted = await handle.execute<{ n: number }>(
        sql.raw(`select count(*)::int as n from ${escapeIdentifier(row.table_name)}`)
      )
      rowCounts[row.table_name] = Number(counted.rows?.[0]?.n ?? 0)
    }

    const size = await this.controlHandle.execute<{ bytes: string | number }>(
      sql.raw(
        this.strategy === 'container'
          ? `select pg_database_size('${tenant.locator}')::bigint as bytes`
          : `select coalesce(sum(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))), 0)::bigint as bytes ` +
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

  /** Opens a tenant's container by id, reading its registry row. The name the manager port uses. */
  async openContainer(tenantId: string): Promise<TenantHandle> {
    const row = await firstBy<Tenant>(this.db, this.registry.tenant, 'id', tenantId)
    if (!row) throw new Error(`Tenant '${tenantId}' is not in the registry`)
    return await this.tenant(row)
  }

  /**
   * Creates the container of a tenant that is being provisioned: a schema, or under the
   * `container` strategy a database. Answers `false`, having touched nothing, when one with that
   * name is already there, under either strategy: it is never adopted. What is inside it is not
   * known, it may be another tenant's, and a provisioning that fails later drops the container
   * it was given.
   */
  async createContainer(tenant: Tenant): Promise<boolean> {
    const name = escapeIdentifier(tenant.locator)
    try {
      // Outside any transaction, which `CREATE DATABASE` refuses: a pooled query runs alone.
      await this.db.execute(sql.raw(this.strategy === 'container' ? `create database ${name}` : `create schema ${name}`))
      return true
    } catch (error) {
      if (sqlStateOf(error) === (this.strategy === 'container' ? DUPLICATE_DATABASE : DUPLICATE_SCHEMA)) return false
      throw error
    }
  }

  /**
   * Drops a container: the undo of a provisioning that failed before its registry row, and the
   * last step of a destruction, which has exported it first. Under `container` the
   * pool this process holds on the database goes first, and `FORCE` ends the sessions other
   * processes hold, which would otherwise make the drop fail.
   */
  async dropContainer(locator: string): Promise<void> {
    if (this.strategy === 'container') {
      assertLocator(locator)
      await this.closeContainer_(locator)
      await this.db.execute(sql.raw(`drop database if exists ${escapeIdentifier(locator)} with (force)`))
      return
    }
    await this.dropSchema(locator)
    this.containers.delete(locator)
  }

  /**
   * Creates a tenant's schema. Used by provisioning and by the test harness.
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
   * else already holds it.
   *
   * A DEDICATED client, not a pooled query: a Postgres advisory lock belongs to the session
   * that took it, so taking one on a connection that goes back to the pool would leave the
   * lock on a connection any later request could be handed. That is why the client is checked
   * out for the whole of `fn` and released in a `finally`.
   *
   * `pg_try_advisory_lock` and not `pg_advisory_lock`: a fleet migrator that BLOCKS on a
   * container someone else is migrating turns two operators into a deadlock with a queue.
   * Not acquiring is an outcome to report, not a reason to wait.
   *
   * On PGlite the lock is a set in this process. Its one session takes an advisory lock it
   * already holds again (they are re-entrant), so it cannot tell two callers apart; and only
   * one process may open a PGlite database, so this process is the whole truth.
   */
  async withContainerLock<T>(locator: string, fn: () => Promise<T>): Promise<T | null> {
    assertLocator(locator)
    if (!this.pool) {
      if (this.heldLocks.has(locator)) return null
      this.heldLocks.add(locator)
      try {
        return await fn()
      } finally {
        this.heldLocks.delete(locator)
      }
    }

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
    if (this.pglite) await this.pglite.close()
    else await this.pool?.end()
  }
}

const DUPLICATE_DATABASE = '42P04'
const DUPLICATE_SCHEMA = '42P06'

/** The SQLSTATE of a failed statement: Drizzle wraps the driver's error, so it is looked for down the cause chain. */
function sqlStateOf(error: unknown): string | undefined {
  let link = error as { code?: unknown; cause?: unknown } | undefined
  for (let depth = 0; link && depth < 5; depth++, link = link.cause as typeof link) {
    if (typeof link.code === 'string') return link.code
  }
  return undefined
}

/**
 * Keeps the process alive when the server ends an idle connection: a restart, or
 * `DROP DATABASE ... WITH (FORCE)` run by another instance on a tenant this one has open. The
 * pool reports it as an `error` event, and an `error` event nobody listens to ends the process.
 * The pool has already discarded the connection; the next query opens a new one.
 */
function reportIdleErrors<T extends pg.Pool>(pool: T, what: string): T {
  pool.on('error', (e) => {
    if (globalThis.log?.w) globalThis.log.warn(`Postgres: an idle connection of ${what} was closed: ${e?.message}`)
  })
  return pool
}

/** What keeps raw SQL inside a tenant's schema, for one transaction and no longer. */
const enterSchema = (locator: string) => `set local search_path to ${escapeIdentifier(locator)}`

/**
 * `RawSql` on a `pg` pool. With a `locator` every statement runs in a transaction that entered
 * that schema; without one a single statement goes to the pool as it is.
 */
function poolRawSql(pool: pg.Pool, locator?: string): RawSql {
  const transaction: RawSql['transaction'] = async (run) => {
    const client = await pool.connect()
    try {
      await client.query('begin')
      if (locator) await client.query(enterSchema(locator))
      const result = await run((text, params) => client.query(text, params) as never)
      await client.query('commit')
      client.release()
      return result
    } catch (error) {
      // A connection that cannot even roll back is in an unknown state: it leaves the pool
      // instead of carrying half a transaction to the next borrower.
      const broken = await client.query('rollback').then(
        () => undefined,
        (rollback: Error) => rollback
      )
      client.release(broken)
      throw error
    }
  }
  return {
    query: locator ? (text, params) => transaction((query) => query(text, params)) : (text, params) => pool.query(text, params) as never,
    transaction
  }
}

/** `RawSql` on PGlite: the same rule, on the one session it has. */
function pgliteRawSql(pglite: PGlite, locator?: string): RawSql {
  const transaction: RawSql['transaction'] = (run) =>
    pglite.transaction(async (tx) => {
      if (locator) await tx.query(enterSchema(locator))
      return await run((text, params) => tx.query(text, params) as never)
    })
  return {
    query: locator ? (text, params) => transaction((query) => query(text, params)) : (text, params) => pglite.query(text, params) as never,
    transaction
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
 * The one gate a schema name goes through. The name is also a cache key, and a key is a name
 * that outlives the request that brought it.
 */
export function assertLocator(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(name)) {
    throw new Error(`Invalid identifier '${name}': it must match [a-z_][a-z0-9_]{0,62}`)
  }
  return name
}

/**
 * Opens Drizzle on PGlite, in memory or on `dataDir`.
 *
 * Both packages are optional peers, imported here and only here: a deployment on a Postgres
 * server never needs them installed. The control schema is pinned at start, as the pool pins
 * it at connect: configuration for the life of the only session, never a `SET` the guard
 * would have to let through.
 */
export async function openPglite(options: { dataDir?: string; schema?: string } = {}): Promise<PgliteDb> {
  const schema = assertLocator(options.schema || DEFAULT_SCHEMA)
  const [{ PGlite }, { drizzle: drizzlePglite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite')
  ])
  // One options object: `create()` reads its second argument only when the first is a string,
  // and a database in memory has no directory to put there.
  const client = await PGlite.create({
    dataDir: options.dataDir,
    startParams: [...PGlite.defaultStartParams, '-c', `search_path=${schema}`]
  })
  return drizzlePglite(client)
}

/**
 * A database per tenant needs a server to create it on: refused by name, and not at the first
 * tenant as a connection to a URL nobody configured.
 */
function refuseContainersOnPglite(strategy: string): void {
  if (strategy === 'container') {
    throw new Error('PGlite cannot run the container strategy: a database per tenant needs a Postgres server')
  }
}

export async function createPostgresProvider(options: GeneralConfig['options']): Promise<PostgresProvider> {
  const control = options?.control
  const tenants = options?.tenants
  const containers = tenants?.containers
  // One database per tenant only where the configuration says so: `schema` stays the
  // default and the shape everything else in the framework was built around.
  const strategy = tenants?.strategy === 'container' ? 'container' : 'schema'

  if (control?.engine === 'pglite') {
    // Tenants declared next to PGlite live in the same instance, as schemas, on its one
    // session: usable in development, refused in production by the capability check. The
    // strategy is checked before the instance opens, which takes about a second.
    refuseContainersOnPglite(strategy)
    const pglite = await openPglite({ dataDir: control.dataDir, schema: control.schema })
    return new PostgresProvider({ schema: control.schema, pglite, strategy })
  }

  return new PostgresProvider({
    url: control?.url,
    schema: control?.schema,
    poolMax: control?.pool?.max,
    idleTimeoutMs: control?.pool?.idleTimeoutMs,
    // The environment is the fallback, not the override: a deployment that declared the
    // number in its configuration meant that number. The variable exists for the deployments
    // that tune from outside the repository.
    maxOpenContainers: containers?.maxOpen ?? envInt('TENANT_CONTAINERS_MAX_OPEN', 20, { min: 1, max: 10_000 }),
    strategy,
    containerPoolMax: containers?.poolMax,
    containerIdleMs: containers?.idleTimeoutMs
  })
}
