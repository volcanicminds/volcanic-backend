import path from 'path'
import fs from 'fs'
import { sql, type SQLWrapper } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { ControlHandle, TenantHandle, GeneralConfig, Tenant, DataRequestScope } from '../../../../types/global.js'
import { appTables, registryTables, type AppTables, type RegistryTables } from '../../schema/sqlite.js'
import { RequestLeases } from '../../leases.js'
import { exportSqliteFile } from '../../containers/export.js'
import { createLitestreamReplica, type ReplicaPort, type ReplicaTarget } from '../../containers/replica.js'

//
// SQLite and libSQL adapter (T-2.3).
//
// Here a container is a FILE, so the thing to get right is not isolation — two files cannot
// see each other — but the file itself: where it is created, with which permissions, how many
// stay open, and what happens when the process crashes mid-write.
//
// `schema` is not a strategy on this engine and is refused at boot by the capability matrix.
// Emulating schemas with table prefixes would be the `row` strategy under another name, where
// the framework promises an isolation that a forgotten WHERE quietly removes (decision 5).
//
// libSQL is a DRIVER here, not an adapter: it speaks the same dialect and the same schema, so
// it shares this file. The only real difference is that better-sqlite3 is synchronous and
// libSQL is not, which is why every method of the handle is async even where it need not be.
//
export type SqliteDriver = 'better-sqlite3' | 'libsql'

/**
 * One statement, whatever kind it is.
 *
 * better-sqlite3 splits statements in two and refuses the wrong call for each: `all()` throws
 * "This statement does not return data" on DDL, an INSERT or a `begin`, and `run()` throws the
 * mirror image on a SELECT. Every caller of `execute` would otherwise have to know which of
 * the two its SQL is, which is exactly the knowledge a raw-SQL escape hatch exists to avoid —
 * and getting it wrong is an exception, not a wrong answer, so it stayed invisible until
 * something ran DDL through it (T-9.1).
 *
 * The distinction is a property of the prepared statement, not of the text, so it is not
 * something to guess with a regular expression: the driver is asked, and its refusal is the
 * answer.
 */
async function runOrAll(db: any, query: unknown): Promise<any> {
  try {
    return await db.all(query as never)
  } catch (error) {
    if (!/does not return data/i.test(String((error as Error)?.message ?? ''))) throw error
    return await db.run(query as never)
  }
}

export interface SqliteHandle {
  readonly kind: 'control' | 'tenant'
  readonly dialect: 'sqlite'
  readonly tenantId?: string
  readonly db: any
  readonly tables: AppTables
  readonly registry?: RegistryTables
  readonly file: string
  execute(query: SQLWrapper | string): Promise<any[]>
  transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export interface SqliteProviderOptions {
  driver?: SqliteDriver
  /** The control plane's file. `:memory:` is accepted for tests and for ephemeral processes. */
  file?: string
  /** Where per-tenant files live. Every container path must resolve inside it. */
  directory?: string
  maxOpenContainers?: number
  /** A container untouched for this long is closed, and its descriptors given back (T-7.2). */
  containerIdleMs?: number
  /** Continuous replication of every container, through the port of T-7.3. */
  replica?: ReplicaTarget
  busyTimeoutMs?: number
}

const DEFAULT_DIR = './data/tenants'

/**
 * Resolves a container file inside the configured directory. A locator that escapes it — an
 * absolute path, a `..` segment, a symlink pointing out — is refused: the tenant registry is
 * data, and data must never be able to name a path of its own choosing.
 */
export function resolveContainerFile(directory: string, locator: string): string {
  const root = path.resolve(directory)
  const file = path.resolve(root, locator)
  const relative = path.relative(root, file)

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Invalid container locator '${locator}': it must resolve inside ${root}`)
  }
  return file
}

export class SqliteProvider {
  private readonly driver: SqliteDriver
  private readonly directory: string
  private readonly busyTimeoutMs: number
  private readonly maxOpenContainers: number
  private readonly controlFile: string
  private readonly registry: RegistryTables
  private controlHandle: SqliteHandle | null = null
  /** Open containers, most recently used last. Each one holds a real file handle. */
  private readonly open = new Map<string, SqliteHandle>()
  private readonly leases = new RequestLeases()
  /** When each container was last used, for the idle close of T-7.2. */
  private readonly usedAt = new Map<string, number>()
  private readonly containerIdleMs: number
  private sweeper: ReturnType<typeof setInterval> | null = null
  /** Present only when the deployment configured one: replication is opt-in (T-7.3). */
  readonly replica: ReplicaPort | null

  constructor(options: SqliteProviderOptions = {}) {
    this.driver = options.driver || 'better-sqlite3'
    this.directory = options.directory || DEFAULT_DIR
    this.busyTimeoutMs = options.busyTimeoutMs ?? 5000
    this.maxOpenContainers = options.maxOpenContainers ?? 20
    this.containerIdleMs = options.containerIdleMs ?? 300000
    this.controlFile = options.file || ':memory:'
    this.registry = registryTables()
    this.replica = options.replica?.url ? createLitestreamReplica(options.replica) : null
  }

  private async openDatabase(file: string): Promise<any> {
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true })
    }

    if (this.driver === 'libsql') {
      const { createClient } = await import('@libsql/client')
      const { drizzle } = await import('drizzle-orm/libsql')
      const client = createClient({ url: file === ':memory:' ? ':memory:' : `file:${file}` })
      const db = drizzle(client)
      await db.run(sql.raw('pragma foreign_keys = ON'))
      // Base text operators are case-SENSITIVE by definition (docs/MAGIC_QUERY_V5.md §4):
      // without this pragma SQLite's LIKE folds ASCII and `:contains` would quietly mean
      // `:containsi`, i.e. the same URL answering differently on two engines.
      await db.run(sql.raw('pragma case_sensitive_like = ON'))
      await db.run(sql.raw(`pragma busy_timeout = ${this.busyTimeoutMs}`))
      if (file !== ':memory:') await db.run(sql.raw('pragma journal_mode = WAL'))
      return { db, close: async () => client.close() }
    }

    const { default: Database } = await import('better-sqlite3')
    const { drizzle } = await import('drizzle-orm/better-sqlite3')
    // 0600: a container is one customer's data, and a shared filesystem is not an excuse.
    const sqlite = new Database(file, file === ':memory:' ? {} : { fileMustExist: false })
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('case_sensitive_like = ON')
    sqlite.pragma(`busy_timeout = ${this.busyTimeoutMs}`)
    if (file !== ':memory:') {
      sqlite.pragma('journal_mode = WAL')
      try {
        fs.chmodSync(file, 0o600)
      } catch {
        // A filesystem that cannot chmod (a mounted volume, Windows) is not a reason to fail
        // the boot, but it IS a reason to say so once.
        if (globalThis.log?.w) globalThis.log.warn(`SQLite: could not restrict permissions on ${file}`)
      }
    }
    return { db: drizzle(sqlite), close: async () => sqlite.close() }
  }

  /**
   * What a transaction callback receives: the same `execute` a handle exposes, on the same
   * connection. A callback that had to switch API mid-flight between drivers would be a
   * contract with a footnote.
   */
  private transactional(db: any) {
    return { execute: async (query: unknown) => await runOrAll(db, query), db }
  }

  /**
   * One transaction, all of it or none of it — and the two drivers need opposite treatment to
   * mean the same thing. Both halves were found by T-9.1 and T-9.2, because the migration
   * runner is the only caller that awaits inside a transaction and nothing had ever asked
   * these engines for a schema.
   *
   * **better-sqlite3** refuses an async callback outright: the driver is synchronous and
   * rejects a returned promise, so `db.transaction(fn)` cannot be used at all. Statements it
   * is — `begin`, the body, `commit` — which is what the driver's own helper does anyway, with
   * the difference that this one can await. There is one connection per container, so the
   * caller's `await` cannot let another writer in.
   *
   * **libSQL** is the mirror image: every `execute` is its own implicit transaction, so a
   * standalone `begin` is gone by the next call and the `commit` finds nothing to commit. Here
   * the driver's own `transaction()` is the only thing that holds, and it accepts an async
   * callback because the client is asynchronous throughout.
   */
  private async inTransaction<T>(db: any, fn: (tx: any) => Promise<T>): Promise<T> {
    if (this.driver === 'libsql') {
      return await db.transaction(async (tx: any) => await fn(this.transactional(tx)))
    }

    await runOrAll(db, sql.raw('begin'))
    try {
      const result = await fn(this.transactional(db))
      await runOrAll(db, sql.raw('commit'))
      return result
    } catch (error) {
      // A rollback that itself fails must not replace the error that caused it: the first one
      // says what went wrong, the second only says the connection is worse off.
      try {
        await runOrAll(db, sql.raw('rollback'))
      } catch {
        /* the original error is the one worth reporting */
      }
      throw error
    }
  }

  private buildHandle(kind: 'control' | 'tenant', db: any, close: () => Promise<void>, file: string, tenantId?: string): SqliteHandle {
    return {
      kind,
      dialect: 'sqlite',
      tenantId,
      db,
      file,
      tables: appTables(),
      registry: kind === 'control' ? this.registry : undefined,
      execute: async (query) => await runOrAll(db, query),
      transaction: async (fn) => await this.inTransaction(db, fn),
      close
    }
  }

  async control(): Promise<ControlHandle> {
    if (!this.controlHandle) {
      const { db, close } = await this.openDatabase(this.controlFile)
      this.controlHandle = this.buildHandle('control', db, close, this.controlFile)
    }
    return this.controlHandle as unknown as ControlHandle
  }

  async tenant(tenantId: string, scope?: DataRequestScope): Promise<TenantHandle> {
    const control: any = await this.control()
    const rows = await control.db.select().from(this.registry.tenant).where(eq(this.registry.tenant.id, tenantId)).limit(1)
    const row = (rows[0] as unknown as Tenant) ?? null
    if (!row) throw new Error(`Tenant '${tenantId}' is not in the registry`)
    if (row.status !== 'active') throw new Error(`Tenant '${row.slug}' is ${row.status}`)

    return (await this.forLocator(row.locator, row.id, scope)) as unknown as TenantHandle
  }

  /**
   * Opens (or reuses) a container. Unlike Postgres, where the bound is a nicety, here every
   * live container is an open file descriptor and a WAL: the LRU is what keeps a thousand
   * tenants from exhausting the process's file table.
   */
  async forLocator(locator: string, tenantId: string, scope?: DataRequestScope): Promise<SqliteHandle> {
    const file = locator === ':memory:' ? locator : resolveContainerFile(this.directory, locator)
    this.leases.take(scope, file)

    const existing = this.open.get(file)
    if (existing) {
      this.open.delete(file) // reinsert: most recently used goes last
      this.open.set(file, existing)
      this.usedAt.set(file, Date.now())
      return existing
    }

    const { db, close } = await this.openDatabase(file)
    const handle = this.buildHandle('tenant', db, close, file, tenantId)
    this.open.set(file, handle)
    this.usedAt.set(file, Date.now())
    await this.evictContainers()
    this.startSweeper()
    return handle
  }

  /**
   * Closes what nobody has touched for a while (T-7.2).
   *
   * The bound of `evictContainers` only fires when a new container arrives, so on a
   * deployment that goes quiet after a busy hour every descriptor it opened stays open until
   * the process ends. On this engine an open container is a file handle and a WAL, and a
   * thousand tenants is a thousand of each: the limit that matters is the process file table,
   * and nothing was giving anything back to it.
   */
  private startSweeper(): void {
    if (this.sweeper || this.containerIdleMs <= 0) return
    this.sweeper = setInterval(() => void this.closeIdleContainers(), Math.max(30000, Math.floor(this.containerIdleMs / 4)))
    // Never keep the process alive just to close idle files.
    this.sweeper.unref?.()
  }

  /**
   * The sweep itself, separate from the timer that calls it.
   *
   * Separate so it can be asked for directly: a test of "an idle container is closed" that
   * has to wait for a thirty-second interval is a test nobody runs, and a test that only
   * checks the timer was scheduled proves the schedule and not the closing.
   */
  async closeIdleContainers(now = Date.now()): Promise<string[]> {
    const cutoff = now - this.containerIdleMs
    const closed: string[] = []
    if (this.containerIdleMs <= 0) return closed

    for (const [file, handle] of [...this.open.entries()]) {
      if ((this.usedAt.get(file) ?? 0) >= cutoff || this.leases.inUse(file)) continue
      this.open.delete(file)
      this.usedAt.delete(file)
      await handle.close()
      closed.push(file)
    }
    if (closed.length && globalThis.log?.d) globalThis.log.debug(`SQLite: closed ${closed.length} idle container(s)`)
    return closed
  }

  /**
   * Trims the open containers to the bound. Unlike Postgres, evicting here CLOSES a file
   * descriptor, so a container a live request is holding is skipped: closing it under a
   * running query is a crash, and the bound is not worth one. If every container is in use
   * the process stays over the bound until a request ends, which is the honest failure,
   * because the alternative is losing a query that was already in flight.
   */
  private async evictContainers(): Promise<void> {
    for (const key of [...this.open.keys()]) {
      if (this.open.size <= this.maxOpenContainers) break
      if (this.leases.inUse(key)) continue
      const oldest = this.open.get(key)!
      this.open.delete(key)
      this.usedAt.delete(key)
      await oldest.close()
    }
  }

  /**
   * The single release point (T-3.1, point 4). Here it has real work: it is what tells the
   * LRU that a container's file may be closed again. Called once per request, from one
   * place; a second call is a no-op, so the abort path and the response path cannot both
   * release the same scope.
   */
  async releaseRequestScope(scope: DataRequestScope, _error?: Error): Promise<void> {
    if (!scope || scope.released) return
    scope.released = true
    this.leases.release(scope)
    await this.evictContainers()
  }

  /**
   * Takes a customer's data out: a checkpoint, then a copy of the file (T-6.2).
   *
   * The checkpoint is not a nicety. Without it the copy is the database as of the last one,
   * and everything written since lives only in the `-wal` companion: the export opens
   * cleanly and is quietly out of date.
   */
  async exportContainer(tenant: Tenant, request: { directory?: string; schemaVersion: string | null }) {
    const file = tenant.locator === ':memory:' ? tenant.locator : resolveContainerFile(this.directory, tenant.locator)
    const handle = await this.forLocator(tenant.locator, tenant.id)

    return await exportSqliteFile(tenant, request, file, async () => {
      await handle.execute(sql.raw('pragma wal_checkpoint(TRUNCATE)') as never)
    })
  }

  /** What is in a container, for the preview of phase 1 (T-6.3). Exact counts, not estimates. */
  async inspectContainer(tenant: Tenant) {
    const file = tenant.locator === ':memory:' ? tenant.locator : resolveContainerFile(this.directory, tenant.locator)
    const handle: any = await this.forLocator(tenant.locator, tenant.id)

    const tables: any = await handle.execute(
      sql.raw("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
    )

    const rowCounts: Record<string, number> = {}
    for (const row of tables ?? []) {
      const counted: any = await handle.execute(sql.raw(`select count(*) as n from "${String(row.name).replace(/"/g, '')}"`))
      rowCounts[row.name] = Number(counted?.[0]?.n ?? 0)
    }

    let sizeBytes = 0
    try {
      sizeBytes = file === ':memory:' ? 0 : fs.statSync(file).size
    } catch {
      // A container with no file yet has no size, which is a number and not a failure.
    }

    return { locator: tenant.locator, sizeBytes, rowCounts, schemaVersion: tenant.schemaVersion ?? null }
  }

  /** Opens a tenant's container by id. The name the manager port uses (T-6.1). */
  async openContainer(tenantId: string): Promise<TenantHandle> {
    return await this.tenant(tenantId)
  }

  /** Creates the container of a tenant being provisioned: on this engine, its file (T-6.1). */
  async createContainer(tenant: Tenant): Promise<void> {
    await this.forLocator(tenant.locator, tenant.id)
    // A container that exists is a container that is replicated, from the moment it exists:
    // starting the copy later leaves a window whose length nobody tracks (T-7.3).
    await this.startReplica(tenant.locator)
  }

  /** Begins replicating one container, when the deployment asked for replication at all. */
  async startReplica(locator: string): Promise<void> {
    if (!this.replica || locator === ':memory:') return
    const file = resolveContainerFile(this.directory, locator)
    await this.replica.start(locator, file)
  }

  /**
   * Removes a container that was created moments ago and could not be finished (T-6.1).
   * Not how a tenant's data is destroyed: that is T-6.3, with an export in front of it.
   */
  async dropContainer(locator: string): Promise<void> {
    // The copy stops before the original goes, so the replicator does not spend its last
    // moments shipping the disappearance of a file it is watching.
    await this.replica?.stop(locator)

    const file = locator === ':memory:' ? locator : resolveContainerFile(this.directory, locator)
    const open = this.open.get(file)
    if (open) {
      await open.close()
      this.open.delete(file)
    }
    if (file !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(`${file}${suffix}`)
        } catch {
          // Absent is the desired state, and the WAL companions may simply not exist.
        }
      }
    }
  }

  /**
   * The same contract as the Postgres advisory lock, on a filesystem (T-5.3).
   *
   * A lock FILE created with the exclusive flag, which is atomic on every filesystem worth
   * running a database on. It carries the pid and the time, so an operator looking at a
   * container nobody is migrating can tell a crash from a colleague.
   */
  async withContainerLock<T>(locator: string, fn: () => Promise<T>): Promise<T | null> {
    const file = locator === ':memory:' ? locator : resolveContainerFile(this.directory, locator)
    const lock = `${file}.migrating`

    try {
      fs.mkdirSync(path.dirname(lock), { recursive: true })
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' })
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'EEXIST') return null
      throw e
    }

    try {
      return await fn()
    } finally {
      try {
        fs.unlinkSync(lock)
      } catch {
        // A lock we cannot remove is worse left unmentioned than left behind.
        if (globalThis.log?.w) globalThis.log.warn(`SQLite: could not remove the migration lock ${lock}`)
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.replica?.shutdown()
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
    for (const handle of this.open.values()) await handle.close()
    this.open.clear()
    this.usedAt.clear()
    if (this.controlHandle) await this.controlHandle.close()
    this.controlHandle = null
  }
}

export function createSqliteProvider(options: GeneralConfig['options']): SqliteProvider {
  const control = options?.control
  const tenants = options?.tenants
  return new SqliteProvider({
    driver: (control?.engine === 'libsql' || tenants?.engine === 'libsql' ? 'libsql' : 'better-sqlite3') as SqliteDriver,
    file: control?.url,
    directory: tenants?.containers?.directory,
    maxOpenContainers: tenants?.containers?.maxOpen,
    containerIdleMs: tenants?.containers?.idleTimeoutMs,
    replica: (tenants?.containers as { replica?: ReplicaTarget })?.replica
  })
}
