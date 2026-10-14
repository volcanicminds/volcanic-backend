//
// `@volcanicminds/backend/db` — the data layer entry point.
//
// The subpath carries no engine name, so the ORM is not part of the public API and changing it
// is not a breaking change for any consumer. What lives behind it is Drizzle today and is
// nobody's business tomorrow.
//
// One engine, Postgres, on a server or on PGlite inside the process. The contract is
// the ports every adapter implements, and the capability matrix refuses a combination the
// framework cannot isolate before a single connection is opened.
//
import { assertSupported } from './lib/database/capabilities.js'
import { createPostgresProvider } from './lib/database/adapters/postgres/index.js'
import { buildManagers } from './lib/database/managers/index.js'
import { createMigrationRunner, type MigrationSet, type MigrationTarget } from './lib/database/migrations/runner.js'
import { migrateFleet, type FleetOptions, type FleetResult } from './lib/database/migrations/fleet.js'
import { createTenantManager } from './lib/database/managers/index.js'
import type { ControlHandle, Tenant } from './types/global.js'
import type { ContainerRef, DataLayerOptions } from './lib/database/ports.js'
import path from 'path'
import { fileURLToPath } from 'url'

export * from './lib/database/ports.js'
export * from './lib/database/managers/index.js'
export * from './lib/database/query/index.js'
export { appTables as pgTables, registryTables as pgRegistryTables } from './lib/database/schema/pg.js'
export { access, type DataAccess } from './lib/database/access.js'
export { encrypt, decrypt } from './lib/database/crypto.js'
export { uuidv7 } from './lib/database/uuid.js'
export * from './lib/database/migrations/runner.js'
export * from './lib/database/migrations/fleet.js'
export { purgeContainers, PURGE_PAGE_SIZE, type PurgeLayer, type PurgeTarget, type PurgeResult } from './lib/database/purge.js'
export { readMigrations, statementsOf } from './lib/database/migrations/files.js'
export { PostgresProvider, type RawSql, type RawQuery } from './lib/database/adapters/postgres/index.js'
export {
  assertSupported,
  supports,
  supportedCombinations,
  resolveTenancy
} from './lib/database/capabilities.js'

/**
 * Starts the data layer and returns the managers to inject into `start(decorators)`.
 *
 * The capability check runs first and on purpose: a configuration the framework cannot
 * honour must stop the boot, not surface later as a request that silently reads the wrong
 * container.
 */
export async function start(options?: DataLayerOptions) {
  const resolved = options ?? global.config?.options
  assertSupported(resolved)

  const provider = await createPostgresProvider(resolved)

  // The measured constraint is the connection, so it is checked before the first one is handed
  // out and not at the two-hundredth tenant.
  const sizing = provider as { assertConnectionBudget?: () => Promise<void> }
  if (sizing.assertConnectionBudget) await sizing.assertConnectionBudget()

  const managers = buildManagers(provider as never, resolved)
  const migrations = buildMigrationRunner(provider, resolved)

  return {
    ...managers,
    /** Not a manager: the framework uses it to open a request's handles. */
    provider,
    /** Applies the schema of a container and says which version it is at. */
    migrations,
    /**
     * Brings every tenant container to the current version.
     *
     * The exported half of a double surface: `npx volcanic migrate
     * --tenants` is a thin wrapper around this call, so an operator at a terminal and a
     * deploy script running unattended go through the same code and get the same refusals.
     */
    migrateTenants: (options: FleetOptions): Promise<FleetResult> =>
      migrateFleet(
        {
          tenants: () => activeTenants(managers.tenantManager, provider),
          migrations,
          withContainerLock: (locator, fn) =>
            (provider as { withContainerLock<T>(l: string, f: () => Promise<T>): Promise<T | null> }).withContainerLock(
              locator,
              fn
            )
        },
        options
      ),
    shutdown: () => (provider as { shutdown(): Promise<void> }).shutdown()
  }
}

/** Every active tenant, paged: a fleet is not something to read in one query. */
async function activeTenants(
  manager: ReturnType<typeof createTenantManager>,
  provider: unknown
): Promise<Tenant[]> {
  const control = (await (provider as { control(): ControlHandle | Promise<ControlHandle> }).control()) as ControlHandle
  const all: Tenant[] = []
  const pageSize = 100
  for (let page = 1; ; page++) {
    const result = await manager.listTenants(control, { 'status:eq': 'active', _page: page, _pageSize: pageSize } as never)
    const records = ((result as { records?: Tenant[] })?.records ?? []) as Tenant[]
    all.push(...records)
    if (records.length < pageSize) return all
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Where the migrations of each set are read from.
 *
 * The framework's folder first, then the consumer's: the framework owns the migrations of
 * its own tables and nothing else, and a consumer's entities are the consumer's to move. Two
 * folders rather than one because merging them would make it impossible to say, looking at a
 * failure, whose change broke the container.
 *
 * Both folders end in `pg`, where drizzle-kit writes the Postgres dialect: a consumer keeps its
 * migrations in `migrations/<set>/pg`.
 *
 * The keys are `control` and `tenant`, and a missing one is an error rather than an empty set.
 * "Zero migrations applied" and "no migrations exist" are different facts.
 */
export function migrationSets(): Record<string, MigrationSet> {
  const framework = (set: string) => path.join(__dirname, 'lib', 'database', 'migrations', set, 'pg')
  const consumer = (set: string) => path.join(process.cwd(), 'migrations', set, 'pg')

  const sets: Record<string, MigrationSet> = {}
  for (const set of ['control', 'tenant']) {
    sets[set] = { name: set, folders: [framework(set), consumer(set)] }
  }
  return sets
}

function buildMigrationRunner(provider: unknown, options: DataLayerOptions) {
  const controlSchema = options?.control?.schema || 'public'
  const p = provider as {
    control(): unknown
    forLocator(locator: string, tenantId: string): Promise<{ locator?: string }>
  }

  const open = async (container: ContainerRef): Promise<MigrationTarget> => {
    if (!container.tenantId) return { handle: await p.control(), locator: container.locator || controlSchema }
    const handle = await p.forLocator(container.locator, container.tenantId)
    // A tenant handle without a locator is a database of its own: its tables sit in `public`.
    return { handle, locator: handle.locator ?? 'public' }
  }

  return createMigrationRunner(open, migrationSets())
}
