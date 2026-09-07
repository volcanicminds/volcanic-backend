import path from 'path'
import fs from 'fs'
import { sql, type SQLWrapper } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { ControlHandle, TenantHandle, GeneralConfig, Tenant } from '../../../../types/global.js'
import { appTables, registryTables, type AppTables, type RegistryTables } from '../../schema/sqlite.js'

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

  constructor(options: SqliteProviderOptions = {}) {
    this.driver = options.driver || 'better-sqlite3'
    this.directory = options.directory || DEFAULT_DIR
    this.busyTimeoutMs = options.busyTimeoutMs ?? 5000
    this.maxOpenContainers = options.maxOpenContainers ?? 20
    this.controlFile = options.file || ':memory:'
    this.registry = registryTables()
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
        if (log?.w) log.warn(`SQLite: could not restrict permissions on ${file}`)
      }
    }
    return { db: drizzle(sqlite), close: async () => sqlite.close() }
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
      execute: async (query) => await db.all(query as never),
      transaction: async (fn) => await db.transaction(fn as never),
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

  async tenant(tenantId: string): Promise<TenantHandle> {
    const control: any = await this.control()
    const rows = await control.db.select().from(this.registry.tenant).where(eq(this.registry.tenant.id, tenantId)).limit(1)
    const row = (rows[0] as unknown as Tenant) ?? null
    if (!row) throw new Error(`Tenant '${tenantId}' is not in the registry`)
    if (row.status !== 'active') throw new Error(`Tenant '${row.slug}' is ${row.status}`)

    return (await this.forLocator(row.locator, row.id)) as unknown as TenantHandle
  }

  /**
   * Opens (or reuses) a container. Unlike Postgres, where the bound is a nicety, here every
   * live container is an open file descriptor and a WAL: the LRU is what keeps a thousand
   * tenants from exhausting the process's file table.
   */
  async forLocator(locator: string, tenantId: string): Promise<SqliteHandle> {
    const file = locator === ':memory:' ? locator : resolveContainerFile(this.directory, locator)

    const existing = this.open.get(file)
    if (existing) {
      this.open.delete(file) // reinsert: most recently used goes last
      this.open.set(file, existing)
      return existing
    }

    const { db, close } = await this.openDatabase(file)
    const handle = this.buildHandle('tenant', db, close, file, tenantId)
    this.open.set(file, handle)

    while (this.open.size > this.maxOpenContainers) {
      const oldestKey = this.open.keys().next().value
      if (!oldestKey) break
      const oldest = this.open.get(oldestKey)!
      this.open.delete(oldestKey)
      await oldest.close()
    }
    return handle
  }

  async shutdown(): Promise<void> {
    for (const handle of this.open.values()) await handle.close()
    this.open.clear()
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
    maxOpenContainers: tenants?.containers?.maxOpen
  })
}
