//
// T-13.5: the migration of F51 and F53 on a container stopped at 0003, on both sets. A flow row
// in flight across the deploy must come through as a login, and a live session as one that no
// step-up has proven yet: its token carries no `auth_time`, so a `freshAuth` route asks for one.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import {
  DATABASE_URL,
  migratedPglite,
  migratedPostgres,
  runnerOf,
  type Migrated,
  type UpTo
} from '../db/fixtures/migrated.js'

;(global as unknown as { log: object }).log = {}

type Rows = { rows: Array<Record<string, unknown>> }
const execute = async (db: Migrated, query: ReturnType<typeof sql>) =>
  (await (db.raw as unknown as { execute(q: unknown): Promise<Rows> }).execute(query)).rows

function behaviours(name: string, open: (upTo?: UpTo) => Promise<Migrated>) {
  describe(`migrations · step-up on ${name} (T-13.5)`, function () {
    this.timeout(60000)

    it('keeps the flows in flight as logins and the sessions as never proven, on both sets', async () => {
      const db = await open({ control: '0003_account_creation_control', tenant: '0003_account_creation_tenant' })
      try {
        // A flow and a session as phase 12 wrote them, in the schema of 0003.
        await execute(
          db,
          sql`insert into auth_flow (id, flow_id, secret_hash, expires_at) values ('f-1', 'flow-1', 'h', now() + interval '1 hour')`
        )
        await execute(
          db,
          sql`insert into session (id, sid, subject_id, scope, secret_hash, idle_expires_at, absolute_expires_at) values ('s-1', 'sid-1', 'user-1', 'tenant', 'h', now() + interval '1 hour', now() + interval '1 hour')`
        )

        const runner = runnerOf(db)
        expect(await runner.apply({ locator: db.schemas.control })).toBe('0006_governance_log_control')
        expect(await runner.apply({ locator: db.schemas.tenant, tenantId: 'id-acme' })).toBe('0004_step_up_tenant')

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

behaviours('PGlite', (upTo) => migratedPglite(upTo))

if (DATABASE_URL) {
  let n = 0
  behaviours('Postgres', (upTo) => {
    n++
    return migratedPostgres({ control: `test_f51_up_ctl_${n}`, tenant: `test_f51_up_acme_${n}` }, upTo)
  })
}
