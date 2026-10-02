//
// A control plane and a tenant container with the framework's real migrations applied, on PGlite
// (always, inside the process) or on Postgres (throwaway schemas, only with DATABASE_URL). The
// managers of phase 12 depend on indexes a hand-written CREATE TABLE would not have, the partial
// unique index on the subject's slot first of all, so their tests run on these.
//
// On PGlite every fixture is an instance of its own, cloned from one migrated once per process:
// migrating costs about 0.8 s, a clone about 0.2 s. A clone keeps the data directory and not the
// start parameters, so the control plane is `public`, the schema Postgres finds without any. A
// fixture stopped at an older migration cannot be a clone, and is migrated from scratch.
//
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import type { ControlHandle, DataHandle } from '../../../types/global.js'
import { PostgresProvider, openPglite, type PgliteDb } from '../../../lib/database/adapters/postgres/index.js'
import { createMigrationRunner } from '../../../lib/database/migrations/runner.js'
import type { RuntimeHandle } from '../../../lib/database/managers/runtime.js'
import { migrationSets } from '../../../db.js'

export interface Migrated {
  control: ControlHandle
  tenant: DataHandle
  /** The same tenant handle, seen from inside the data layer, for reading raw rows. */
  raw: RuntimeHandle
  /** The Postgres schemas of the two containers. */
  schemas: { control: string; tenant: string }
  close(): Promise<void>
}

/** The migration each set stops at; absent, the set is migrated to its last. */
export type UpTo = { control?: string; tenant?: string }

export const DATABASE_URL = process.env.DATABASE_URL

const TENANT_ID = 'id-acme'
const PGLITE_SCHEMAS = { control: 'public', tenant: 'acme' }

/** A runner over the two containers of a fixture, for the tests that migrate it further. */
export function runnerOf(db: Migrated) {
  return createMigrationRunner(
    async (container) => ({
      handle: (container.tenantId ? db.raw : db.control) as never,
      locator: container.locator
    }),
    migrationSets()
  )
}

async function fixture(
  provider: PostgresProvider,
  schemas: Migrated['schemas'],
  close: () => Promise<void>
): Promise<Migrated> {
  const tenant = await provider.forLocator(schemas.tenant, TENANT_ID)
  return {
    schemas,
    control: provider.control(),
    tenant: tenant as unknown as DataHandle,
    raw: tenant as unknown as RuntimeHandle,
    close
  }
}

async function migrate(db: Migrated, upTo?: UpTo): Promise<Migrated> {
  const runner = runnerOf(db)
  await runner.apply({ locator: db.schemas.control }, upTo?.control)
  await runner.apply({ locator: db.schemas.tenant, tenantId: TENANT_ID }, upTo?.tenant)
  return db
}

async function pgliteFromScratch(upTo?: UpTo): Promise<{ db: Migrated; client: PgliteDb['$client'] }> {
  const pglite = await openPglite()
  const provider = new PostgresProvider({ schema: PGLITE_SCHEMAS.control, pglite })
  await provider.createSchema(PGLITE_SCHEMAS.tenant)
  const db = await migrate(await fixture(provider, PGLITE_SCHEMAS, () => provider.shutdown()), upTo)
  return { db, client: pglite.$client }
}

let template: ReturnType<typeof pgliteFromScratch> | undefined

export async function migratedPglite(upTo?: UpTo): Promise<Migrated> {
  if (upTo) return (await pgliteFromScratch(upTo)).db
  // Never closed: it lives as long as the process, and the suites run with `--exit`.
  template ??= pgliteFromScratch()
  const clone = (await (await template).client.clone()) as PgliteDb['$client']
  const provider = new PostgresProvider({ schema: PGLITE_SCHEMAS.control, pglite: drizzle(clone) })
  return fixture(provider, PGLITE_SCHEMAS, () => provider.shutdown())
}

export async function migratedPostgres(schemas: Migrated['schemas'], upTo?: UpTo): Promise<Migrated> {
  const provider = new PostgresProvider({ url: DATABASE_URL, schema: schemas.control, poolMax: 4 })
  const admin = new PostgresProvider({ url: DATABASE_URL, schema: 'public', poolMax: 1 })
  for (const schema of [schemas.control, schemas.tenant]) {
    await admin.dropSchema(schema)
    await admin.createSchema(schema)
  }
  const close = async () => {
    await provider.shutdown()
    for (const schema of [schemas.control, schemas.tenant]) await admin.dropSchema(schema)
    await admin.shutdown()
  }
  return migrate(await fixture(provider, schemas, close), upTo)
}

/** The names of the tables of a container. */
export async function tableNames(handle: DataHandle | ControlHandle, schema: string): Promise<string[]> {
  const h = handle as unknown as { execute(q: unknown): Promise<{ rows: Array<{ name: string }> }> }
  const { rows } = await h.execute(
    sql`select table_name as name from information_schema.tables where table_schema = ${schema} order by table_name`
  )
  return rows.map((r) => r.name)
}
