//
// T-12.46: the migration of F49 on a container stopped at 0002, on both sets. The users already
// there must come through approved, or the upgrade would shut out every existing account at its
// next login; the settings table arrives empty.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import {
  DATABASE_URL,
  migratedPglite,
  migratedPostgres,
  runnerOf,
  tableNames,
  type Migrated,
  type UpTo
} from '../db/fixtures/migrated.js'

;(global as unknown as { log: object }).log = {}

type Rows = { rows: Array<Record<string, unknown>> }
const execute = async (db: Migrated, query: ReturnType<typeof sql>) =>
  (await (db.raw as unknown as { execute(q: unknown): Promise<Rows> }).execute(query)).rows

function behaviours(name: string, open: (upTo?: UpTo) => Promise<Migrated>) {
  describe(`migrations · account creation on ${name} (T-12.46)`, function () {
    this.timeout(60000)

    it('keeps the existing users approved and adds the settings table on both sets', async () => {
      const db = await open({ control: '0002_auth_flow_control', tenant: '0002_auth_flow_tenant' })
      try {
        expect(await tableNames(db.tenant, db.schemas.tenant)).not.toContain('setting')

        // A user as phase 12 wrote it before F49, in the schema of 0002.
        await execute(
          db,
          sql`insert into "user" (id, external_id, email, password, confirmed) values ('u-1', 'x-1', 'anna@acme.test', 'h', true)`
        )

        const runner = runnerOf(db)
        expect(await runner.apply({ locator: db.schemas.control })).toBe('0006_governance_log_control')
        expect(await runner.apply({ locator: db.schemas.tenant, tenantId: 'id-acme' })).toBe('0004_step_up_tenant')

        expect(await tableNames(db.tenant, db.schemas.tenant)).toContain('setting')
        expect(await tableNames(db.control, db.schemas.control)).toContain('setting')
        const rows = await execute(db, sql`select email, approved, approved_at from "user"`)
        expect(rows).toHaveLength(1)
        expect(rows[0].approved).toBe(true)
        expect(rows[0].approved_at).toBeNull()
      } finally {
        await db.close()
      }
    })
  })
}

behaviours('PGlite', (upTo) => migratedPglite(upTo))

if (DATABASE_URL) {
  let n = 0
  behaviours('Postgres', (upTo) => {
    n++
    return migratedPostgres({ control: `test_f49_up_ctl_${n}`, tenant: `test_f49_up_acme_${n}` }, upTo)
  })
}
