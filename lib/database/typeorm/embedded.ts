/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Embedded database (PGlite) wiring for TypeORM.
 *
 * PGlite is a WASM build of Postgres that runs in-process — no external server,
 * no Docker. It is the "plug & play" engine for development, tests, demos and
 * CLIs. Production keeps using a real Postgres server (`type: 'postgres'`).
 *
 * The whole feature is OPT-IN and the heavy WASM dependencies are OPTIONAL:
 * they are only `import()`-ed when the consumer sets `type: 'pglite'`, so a
 * pure-Postgres deployment never pays for them.
 *
 * Consumer config (database.default):
 *   {
 *     type: 'pglite',
 *     dataDir: './.pglite',      // omit -> in-memory (ephemeral); a path -> persisted on disk
 *     vector: true,              // or { } — enable pgvector (embeddings / similarity search)
 *     extensions: ['pgcrypto'],  // extra PGlite contrib extensions to enable
 *     relaxedDurability: true,   // faster writes, weaker fsync guarantees (great for tests)
 *     synchronize: true,
 *     ...standard TypeORM options (entities, namingStrategy, ...)
 *   }
 */
import * as log from './util/logger.js'

// PGlite needs `CREATE EXTENSION "<sql-name>"`, whose name often differs from the
// JS import identifier (e.g. import `uuid_ossp` -> SQL `uuid-ossp`).
const EXTENSION_SQL_NAME: Record<string, string> = {
  uuid_ossp: 'uuid-ossp',
  vector: 'vector'
}

// `uuid-ossp` is always enabled: the framework entities (User/Tenant/Token/Change)
// use `@PrimaryGeneratedColumn('uuid')` which calls uuid_generate_v4() at synchronize.
const ALWAYS_ON_EXTENSIONS = ['uuid_ossp']

export interface EmbeddedState {
  enabled: boolean
  vector: boolean
  dataDir?: string
  persisted: boolean
  extensions: string[]
}

function sqlName(ext: string): string {
  return EXTENSION_SQL_NAME[ext] || ext
}

async function importExtension(name: string): Promise<any> {
  // pgvector ships as a separate package (peer-pinned to the PGlite version);
  // every other extension is a standard PGlite contrib module.
  if (name === 'vector') {
    const mod: any = await import('@electric-sql/pglite-pgvector')
    return mod.vector
  }
  const mod: any = await import(`@electric-sql/pglite/contrib/${name}`)
  return mod[name] ?? mod.default ?? mod
}

/**
 * Detects whether the given options ask for the embedded engine.
 */
export function isEmbedded(options: any): boolean {
  return options?.type === 'pglite'
}

/**
 * Rewrites `options` in place so TypeORM treats them as a standard Postgres
 * DataSource backed by a PGlite driver, registers the required extensions and
 * creates them BEFORE any schema synchronization runs.
 *
 * Returns the resolved embedded state (also published on `global.embeddedDatabase`).
 */
export async function setupEmbedded(options: any): Promise<EmbeddedState> {
  let PGliteDriver: any
  let getPGliteInstance: any
  try {
    ;({ PGliteDriver, getPGliteInstance } = await import('typeorm-pglite'))
  } catch {
    throw new Error(
      "[Volcanic-Embedded] type 'pglite' requires optional dependencies. Install them with:\n" +
        '  npm install typeorm-pglite @electric-sql/pglite' +
        " @electric-sql/pglite-pgvector\n(the last one only if you use 'vector: true')."
    )
  }

  // --- Resolve config knobs and strip them from the TypeORM options ---
  const wantVector = !!options.vector
  const extraExtensions: string[] = Array.isArray(options.extensions) ? options.extensions : []
  const dataDir: string | undefined = options.dataDir
  const relaxedDurability: boolean = options.relaxedDurability ?? !dataDir // default relaxed for in-memory

  const extensionNames = Array.from(
    new Set([...ALWAYS_ON_EXTENSIONS, ...extraExtensions, ...(wantVector ? ['vector'] : [])])
  )

  delete options.vector
  delete options.extensions
  delete options.dataDir
  delete options.relaxedDurability

  // --- Load extension modules and build the PGlite `extensions` map ---
  const extensions: Record<string, any> = {}
  for (const name of extensionNames) {
    try {
      extensions[name] = await importExtension(name)
    } catch (err: any) {
      if (name === 'vector') {
        throw new Error(
          "[Volcanic-Embedded] 'vector: true' requires '@electric-sql/pglite-pgvector'. " +
            'Install it with: npm install @electric-sql/pglite-pgvector'
        )
      }
      throw new Error(`[Volcanic-Embedded] Unknown PGlite extension '${name}': ${err?.message || err}`)
    }
  }

  // --- Build the driver. The constructor passes these options to PGlite.create() ---
  const pgliteOptions: any = { extensions, relaxedDurability }
  if (dataDir) pgliteOptions.dataDir = dataDir

  const driver = new PGliteDriver(pgliteOptions).driver

  // Make TypeORM use the Postgres dialect over the PGlite-backed pool.
  options.type = 'postgres'
  options.driver = driver

  // --- Create extensions BEFORE synchronize() (which may run during initialize()) ---
  // getPGliteInstance() eagerly creates the singleton with the options set above.
  const pg = await getPGliteInstance()
  for (const name of extensionNames) {
    await pg.query(`CREATE EXTENSION IF NOT EXISTS "${sqlName(name)}"`)
  }

  const state: EmbeddedState = {
    enabled: true,
    vector: wantVector,
    dataDir,
    persisted: !!dataDir,
    extensions: extensionNames
  }
  ;(global as any).embeddedDatabase = state

  log.warn(
    `[Volcanic-Embedded] PGlite engine active (${state.persisted ? `persisted @ ${dataDir}` : 'in-memory'})` +
      `, extensions: ${extensionNames.join(', ')}`
  )

  return state
}

/**
 * True when the current process is running on the embedded PGlite engine.
 * Used by the tenant manager to avoid destroying the shared PGlite singleton.
 */
export function isEmbeddedActive(): boolean {
  return !!(global as any).embeddedDatabase?.enabled
}

/**
 * Gracefully closes the shared PGlite instance (no-op on real Postgres).
 * Useful at the end of a test suite to release the WASM instance.
 */
export async function closeEmbedded(): Promise<void> {
  if (!isEmbeddedActive()) return
  try {
    const { PGliteInstance }: any = await import('typeorm-pglite')
    await PGliteInstance.close()
  } catch {
    /* optional dep absent — nothing to close */
  }
  ;(global as any).embeddedDatabase = undefined
}
