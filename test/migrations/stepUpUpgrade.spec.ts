//
// T-13.5: the migration of F51 and F53 on a container stopped at 0003, on both sets. A flow row
// in flight across the deploy must come through as a login, and a live session as one that no
// step-up has proven yet: its token carries no `auth_time`, so a `freshAuth` route asks for one.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { createMigrationRunner } from '../../lib/database/migrations/runner.js'
import { migrationSets } from '../../db.js'
import { DATABASE_URL, migratedPostgres, migratedSqlite, type Migrated } from '../db/fixtures/migrated.js'

;(global as unknown as { log: object }).log = {}

type Rows = { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
const execute = async (db: Migrated, query: ReturnType<typeof sql>) => {
  const result = (await (db.raw as unknown as { execute(q: unknown): Promise<Rows> }).execute(query)) as Rows
  return Array.isArray(result) ? result : (result.rows ?? [])
}

function behaviours(name: string, open: (upTo?: { control?: string; tenant?: string }) => Promise<Migrated>) {
  describe(`migrations · step-up on ${name} (T-13.5)`, function () {
    this.timeout(60000)

    it('keeps the flows in flight as logins and the sessions as never proven, on both sets', async () => {
      const db = await open({ control: '0003_account_creation_control', tenant: '0003_account_creation_tenant' })
      try {
        // A flow and a session as phase 12 wrote them, in the schema of 0003.
        const later = Date.now() + 3600_000
        await execute(
          db,
          db.dialect === 'sqlite'
            ? sql`insert into auth_flow (id, flow_id, secret_hash, expires_at) values ('f-1', 'flow-1', 'h', ${later})`
            : sql`insert into auth_flow (id, flow_id, secret_hash, expires_at) values ('f-1', 'flow-1', 'h', now() + interval '1 hour')`
        )
        await execute(
          db,
          db.dialect === 'sqlite'
            ? sql`insert into session (id, sid, subject_id, scope, secret_hash, idle_expires_at, absolute_expires_at) values ('s-1', 'sid-1', 'user-1', 'tenant', 'h', ${later}, ${later})`
            : sql`insert into session (id, sid, subject_id, scope, secret_hash, idle_expires_at, absolute_expires_at) values ('s-1', 'sid-1', 'user-1', 'tenant', 'h', now() + interval '1 hour', now() + interval '1 hour')`
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
        expect(await runner.apply({ locator: db.schemas?.control ?? 'control.db' })).toBe('0004_step_up_control')
        expect(await runner.apply({ locator: db.schemas?.tenant ?? 'acme.db', tenantId: 'id-acme' })).toBe('0004_step_up_tenant')

        expect(await execute(db, sql`select purpose, session_sid, expected_subject_id from auth_flow`)).toEqual([
          { purpose: 'login', session_sid: null, expected_subject_id: null }
        ])
        expect(await execute(db, sql`select sid, authenticated_at from session`)).toEqual([{ sid: 'sid-1', authenticated_at: null }])
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
    return migratedPostgres({ control: `test_f51_up_ctl_${n}`, tenant: `test_f51_up_acme_${n}` }, upTo)
  })
}
