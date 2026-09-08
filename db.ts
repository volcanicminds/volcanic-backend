//
// `@volcanicminds/backend/db` — the data layer entry point.
//
// The subpath carries no engine name: in v4 it was `/typeorm`, so the ORM was part of the
// public API and changing it became a breaking change for every consumer (invariant 10).
// What lives behind it is Drizzle today and is nobody's business tomorrow.
//
// The implementation arrives in phase 2, task by task: schema (T-2.1), Postgres adapter
// (T-2.2), SQLite and libSQL (T-2.3), Magic Query (T-2.4), managers (T-2.5), async key
// derivation (T-2.6). What is real here already is the contract — the ports every adapter
// implements — and the capability matrix, which refuses a combination the framework cannot
// isolate before a single connection is opened.
//
import { assertSupported } from './lib/database/capabilities.js'
import { createPostgresProvider } from './lib/database/adapters/postgres/index.js'
import { createSqliteProvider } from './lib/database/adapters/sqlite/index.js'
import { buildManagers } from './lib/database/managers/index.js'
import { createMigrationRunner, type MigrationSet, type MigrationTarget } from './lib/database/migrations/runner.js'
import type { ContainerRef, DataLayerOptions } from './lib/database/ports.js'
import path from 'path'
import { fileURLToPath } from 'url'

export * from './lib/database/ports.js'
export * from './lib/database/managers/index.js'
export * from './lib/database/query/index.js'
export { appTables as pgTables, registryTables as pgRegistryTables } from './lib/database/schema/pg.js'
export { appTables as sqliteTables, registryTables as sqliteRegistryTables } from './lib/database/schema/sqlite.js'
export { encrypt, decrypt } from './lib/database/crypto.js'
export { uuidv7 } from './lib/database/uuid.js'
export * from './lib/database/migrations/runner.js'
export { readMigrations, statementsOf } from './lib/database/migrations/files.js'
export { PostgresProvider } from './lib/database/adapters/postgres/index.js'
export { SqliteProvider } from './lib/database/adapters/sqlite/index.js'
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
 * container. That is invariant 2, and D-04 is what happens without it.
 */
export async function start(options?: DataLayerOptions) {
  const resolved = options ?? (global as any).config?.options
  assertSupported(resolved)

  const engine = resolved?.control?.engine ?? 'postgres'
  const provider = engine === 'sqlite' || engine === 'libsql' ? createSqliteProvider(resolved) : createPostgresProvider(resolved)

  const managers = buildManagers(provider as never)

  return {
    ...managers,
    /** Not a manager: the framework uses it to open a request's handles (T-3.1). */
    provider,
    /** Applies the schema of a container and says which version it is at (T-5.1). */
    migrations: buildMigrationRunner(provider, resolved),
    shutdown: () => (provider as { shutdown(): Promise<void> }).shutdown()
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Where the migrations of each set are read from (T-5.1 point 5).
 *
 * The framework's folder first, then the consumer's: the framework owns the migrations of
 * its own tables and nothing else, and a consumer's entities are the consumer's to move. Two
 * folders rather than one because merging them would make it impossible to say, looking at a
 * failure, whose change broke the container.
 */
export function migrationSets(): Record<string, MigrationSet> {
  const framework = (set: string) => path.join(__dirname, 'lib', 'database', 'migrations', set)
  const consumer = (set: string) => path.join(process.cwd(), 'migrations', set)
  return {
    control: { name: 'control', folders: [framework('control'), consumer('control')] },
    tenant: { name: 'tenant', folders: [framework('tenant'), consumer('tenant')] }
  }
}

function buildMigrationRunner(provider: unknown, options: DataLayerOptions) {
  const engine = options?.control?.engine ?? 'postgres'
  const controlSchema = options?.control?.schema || 'public'
  const p = provider as {
    control(): unknown
    forLocator(locator: string, tenantId: string): unknown
  }

  const open = async (container: ContainerRef): Promise<MigrationTarget> => {
    const handle = container.tenantId
      ? await p.forLocator(container.locator, container.tenantId)
      : await p.control()
    return {
      handle,
      // SQLite is a file per container, so there is no schema to enter and nothing to
      // qualify: the locator is the file, and the handle already opened it.
      locator: engine === 'sqlite' || engine === 'libsql' ? undefined : container.locator || controlSchema,
      dialect: engine === 'sqlite' || engine === 'libsql' ? 'sqlite' : 'postgres'
    }
  }

  return createMigrationRunner(open, migrationSets())
}
