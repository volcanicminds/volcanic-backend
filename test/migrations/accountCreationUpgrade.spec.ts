//
// T-12.46: the migration of F49 on a container stopped at 0002, on both sets. The users already
// there must come through approved, or the upgrade would shut out every existing account at its
// next login; the settings table arrives empty.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { createMigrationRunner } from '../../lib/database/migrations/runner.js'
import { migrationSets } from '../../db.js'
import { DATABASE_URL, migratedPostgres, migratedSqlite, tableNames, type Migrated } from '../db/fixtures/migrated.js'

;(global as unknown as { log: object }).log = {}

type Rows = { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
const execute = async (db: Migrated, query: ReturnType<typeof sql>) => {
  const result = (await (db.raw as unknown as { execute(q: unknown): Promise<Rows> }).execute(query)) as Rows
  return Array.isArray(result) ? result : (result.rows ?? [])
}

function behaviours(name: string, open: (upTo?: { control?: string; tenant?: string }) => Promise<Migrated>) {
  describe(`migrations · account creation on ${name} (T-12.46)`, function () {
    this.timeout(60000)

    it('keeps the existing users approved and adds the settings table on both sets', async () => {
      const db = await open({ control: '0002_auth_flow_control', tenant: '0002_auth_flow_tenant' })
      try {
        expect(await tableNames(db.tenant, db.dialect, db.schemas?.tenant)).not.toContain('setting')

        // A user as phase 12 wrote it before F49, in the schema of 0002.
        await execute(
          db,
          sql`insert into "user" (id, external_id, email, password, confirmed) values ('u-1', 'x-1', 'anna@acme.test', 'h', true)`
        )

        const runner = createMigrationRunner(
          async (container) => ({
            handle: (container.tenantId ? db.raw : db.control) as never,
            locator: db.dialect === 'postgres' ? container.locator : undefined,
            dialect: db.dialect
          }),
          migrationSets(),
          db.dialect === 'sqlite' ? { control: 'sqlite', tenant: 'sqlite' } : { control: 'pg', tenant: 'pg' }
        )
        expect(await runner.apply({ locator: db.schemas?.control ?? 'control.db' })).toBe(
          '0003_account_creation_control'
        )
        expect(await runner.apply({ locator: db.schemas?.tenant ?? 'acme.db', tenantId: 'id-acme' })).toBe(
          '0003_account_creation_tenant'
        )

        expect(await tableNames(db.tenant, db.dialect, db.schemas?.tenant)).toContain('setting')
        expect(await tableNames(db.control, db.dialect, db.schemas?.control)).toContain('setting')
        const rows = await execute(db, sql`select email, approved, approved_at from "user"`)
        expect(rows).toHaveLength(1)
        // SQLite answers 1 for true: what matters is that the row is not waiting.
        expect(Boolean(rows[0].approved)).toBe(true)
        expect(rows[0].approved_at).toBeNull()
      } finally {
        await db.close()
      }
    })
  })
}

behaviours('SQLite', (upTo) => migratedSqlite(upTo))

if (DATABASE_URL) {
  let n = 0
  behaviours('Postgres', (upTo) => {
    n++
    return migratedPostgres({ control: `test_f49_up_ctl_${n}`, tenant: `test_f49_up_acme_${n}` }, upTo)
  })
}
