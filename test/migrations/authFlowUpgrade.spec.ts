//
// T-12.11: the phase 12 migrations applied to an empty container and to one stopped at 0001, on
// both sets. A container stopped at 0001 is what every deployment of phase 11 is, and its live
// sessions must come through intact, with `auth_methods` empty.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { createMigrationRunner } from '../../lib/database/migrations/runner.js'
import { migrationSets } from '../../db.js'
import { DATABASE_URL, migratedPostgres, migratedSqlite, tableNames, type Migrated } from '../db/fixtures/migrated.js'

;(global as unknown as { log: object }).log = {}

const NEW_APP = ['access_log', 'auth_flow', 'external_identity']

type Rows = { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
const execute = async (db: Migrated, query: ReturnType<typeof sql>) => {
  const result = (await (db.raw as unknown as { execute(q: unknown): Promise<Rows> }).execute(query)) as Rows
  return Array.isArray(result) ? result : (result.rows ?? [])
}

function behaviours(name: string, open: (upTo?: { control?: string; tenant?: string }) => Promise<Migrated>) {
  describe(`migrations · phase 12 on ${name} (T-12.11)`, function () {
    this.timeout(60000)

    it('creates the new tables on an empty container, the provider registry in the control set only', async () => {
      const db = await open()
      try {
        const tenant = await tableNames(db.tenant, db.dialect, db.schemas?.tenant)
        const control = await tableNames(db.control, db.dialect, db.schemas?.control)
        expect(tenant).toEqual(expect.arrayContaining(NEW_APP))
        expect(tenant).not.toContain('identity_provider')
        expect(control).toEqual(expect.arrayContaining([...NEW_APP, 'identity_provider']))
      } finally {
        await db.close()
      }
    })

    it('upgrades both sets of a container stopped at 0001 and keeps its sessions', async () => {
      const db = await open({ control: '0001_sessions_control', tenant: '0001_sessions_tenant' })
      try {
        expect(await tableNames(db.tenant, db.dialect, db.schemas?.tenant)).not.toContain('auth_flow')
        expect(await tableNames(db.control, db.dialect, db.schemas?.control)).not.toContain('identity_provider')

        // A session as phase 11 wrote it, in the phase 11 schema.
        const later = Date.now() + 3600_000
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
        expect(await runner.apply({ locator: db.schemas?.control ?? 'control.db' })).toBe('0003_account_creation_control')
        expect(await runner.apply({ locator: db.schemas?.tenant ?? 'acme.db', tenantId: 'id-acme' })).toBe('0003_account_creation_tenant')

        expect(await tableNames(db.tenant, db.dialect, db.schemas?.tenant)).toEqual(expect.arrayContaining(NEW_APP))
        expect(await tableNames(db.control, db.dialect, db.schemas?.control)).toContain('identity_provider')
        const rows = await execute(db, sql`select sid, auth_methods from session`)
        expect(rows).toEqual([{ sid: 'sid-1', auth_methods: null }])
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
    return migratedPostgres({ control: `test_p12_up_ctl_${n}`, tenant: `test_p12_up_acme_${n}` }, upTo)
  })
}
