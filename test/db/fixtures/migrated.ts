//
// A control plane and a tenant container with the framework's real migrations applied, on SQLite
// (a temporary directory, always) or on Postgres (throwaway schemas, only with DATABASE_URL).
// The managers of phase 12 depend on indexes a hand-written CREATE TABLE would not have, the
// partial unique index on the subject's slot first of all, so their tests run on these.
//
import fs from 'fs'
import os from 'os'
import path from 'path'
import { sql } from 'drizzle-orm'
import type { ControlHandle, DataHandle } from '../../../types/global.js'
import { SqliteProvider } from '../../../lib/database/adapters/sqlite/index.js'
import { PostgresProvider } from '../../../lib/database/adapters/postgres/index.js'
import { createMigrationRunner } from '../../../lib/database/migrations/runner.js'
import type { RuntimeHandle } from '../../../lib/database/managers/runtime.js'
import { migrationSets } from '../../../db.js'

export interface Migrated {
  dialect: 'sqlite' | 'postgres'
  control: ControlHandle
  tenant: DataHandle
  /** The same tenant handle, seen from inside the data layer, for reading raw rows. */
  raw: RuntimeHandle
  /** The Postgres schemas of the two containers; absent on SQLite, where a container is a file. */
  schemas?: { control: string; tenant: string }
  close(): Promise<void>
}

export const DATABASE_URL = process.env.DATABASE_URL

export async function migratedSqlite(upTo?: { control?: string; tenant?: string }): Promise<Migrated> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volcanic-phase12-'))
  const provider = new SqliteProvider({ file: path.join(dir, 'control.db'), directory: dir, maxOpenContainers: 4 })
  const runner = createMigrationRunner(
    async (container) => ({
      handle: container.tenantId ? await provider.forLocator(container.locator, container.tenantId) : await provider.control(),
      locator: undefined,
      dialect: 'sqlite'
    }),
    migrationSets(),
    { control: 'sqlite', tenant: 'sqlite' }
  )
  await runner.apply({ locator: 'control.db' }, upTo?.control)
  await runner.apply({ locator: 'acme.db', tenantId: 'id-acme' }, upTo?.tenant)
  const tenant = await provider.forLocator('acme.db', 'id-acme')
  return {
    dialect: 'sqlite',
    control: await provider.control(),
    tenant: tenant as unknown as DataHandle,
    raw: tenant as unknown as RuntimeHandle,
    close: async () => {
      await provider.shutdown()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

export async function migratedPostgres(
  schemas: { control: string; tenant: string },
  upTo?: { control?: string; tenant?: string }
): Promise<Migrated> {
  const provider = new PostgresProvider({ url: DATABASE_URL, schema: schemas.control, poolMax: 4 })
  const admin = new PostgresProvider({ url: DATABASE_URL, schema: 'public', poolMax: 1 })
  for (const schema of [schemas.control, schemas.tenant]) {
    await admin.dropSchema(schema)
    await admin.createSchema(schema)
  }
  const runner = createMigrationRunner(
    async (container) => ({
      handle: container.tenantId ? await provider.forLocator(container.locator, container.tenantId) : provider.control(),
      locator: container.locator,
      dialect: 'postgres'
    }),
    migrationSets(),
    { control: 'pg', tenant: 'pg' }
  )
  await runner.apply({ locator: schemas.control }, upTo?.control)
  await runner.apply({ locator: schemas.tenant, tenantId: 'id-acme' }, upTo?.tenant)
  const tenant = await provider.forLocator(schemas.tenant, 'id-acme')
  return {
    dialect: 'postgres',
    schemas,
    control: provider.control(),
    tenant: tenant as unknown as DataHandle,
    raw: tenant as unknown as RuntimeHandle,
    close: async () => {
      await provider.shutdown()
      for (const schema of [schemas.control, schemas.tenant]) await admin.dropSchema(schema)
      await admin.shutdown()
    }
  }
}

/** The names of the tables of a container, whatever the engine. */
export async function tableNames(handle: DataHandle | ControlHandle, dialect: Migrated['dialect'], schema?: string): Promise<string[]> {
  const h = handle as unknown as { execute(q: unknown): Promise<{ rows?: Array<{ name: string }> } | Array<{ name: string }>> }
  const result =
    dialect === 'sqlite'
      ? await h.execute(sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`)
      : await h.execute(sql`select table_name as name from information_schema.tables where table_schema = ${schema} order by table_name`)
  const rows = Array.isArray(result) ? result : (result.rows ?? [])
  return rows.map((r) => r.name)
}
