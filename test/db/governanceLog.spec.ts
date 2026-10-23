/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The governance log on a real migrated control plane and tenant container: the closed vocabulary,
// the truncated address, the reading by tenant and action, the property every governance route
// rests on (an event that cannot be written takes its change down with it), the acts on tokens
// kept in the tenant's own log, and the database refusing to rewrite either. PGlite always,
// Postgres with DATABASE_URL.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import type { GovernanceLogEntry } from '../../types/global.js'
import { createGovernanceLogManager } from '../../lib/database/managers/governanceLog.js'
import { createTenantManager } from '../../lib/database/managers/tenant.js'
import { createTokenManager } from '../../lib/database/managers/token.js'
import { governed, intend } from '../../lib/util/governance.js'
import { DATABASE_URL, migratedPglite, migratedPostgres, type Migrated } from './fixtures/migrated.js'

;(global as unknown as { log: object }).log = {}

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
  } catch (e) {
    return String((e as { code?: string }).code ?? 'NO_CODE')
  }
  return 'NO_ERROR'
}

type Rows = { rows: Array<Record<string, unknown>> }

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`database/managers · the governance log on ${name} (T-15.2)`, function () {
    this.timeout(30000)
    let db: Migrated
    const governance = createGovernanceLogManager()
    const tenants = createTenantManager({ openContainer: async () => db.tenant as never })
    const entry: GovernanceLogEntry = {
      action: 'tenant.suspended',
      outcome: 'success',
      actorId: 'op-1',
      actorPlane: 'control',
      tenantId: 'id-acme',
      detail: { reason: 'unpaid' },
      requestId: 'req-1',
      ip: '203.0.113.77'
    }
    // What `governed` reads off a request: the manager, the control plane, the operator, the address.
    const request = () =>
      ({
        server: { governanceLogManager: governance },
        control: db.control,
        systemUser: { id: 'op-7' },
        ip: '198.51.100.23',
        id: 'req-9'
      }) as never

    before(async () => (db = await open()))
    after(async () => await db?.close())

    it('writes a row with the address truncated, and with ACCESS_LOG_IP=none without one', async () => {
      const row = await governance.record(db.control, entry)
      expect(row).toMatchObject({ action: 'tenant.suspended', outcome: 'success', tenantId: 'id-acme', ip: '203.0.113.0' })
      expect(row.detail).toEqual({ reason: 'unpaid' })
      expect(row.id).toBeTruthy()
      expect(row.occurredAt).toBeTruthy()

      const previous = process.env.ACCESS_LOG_IP
      process.env.ACCESS_LOG_IP = 'none'
      try {
        expect((await governance.record(db.control, entry)).ip).toBeNull()
      } finally {
        if (previous === undefined) delete process.env.ACCESS_LOG_IP
        else process.env.ACCESS_LOG_IP = previous
      }
    })

    it('refuses an action or an outcome outside the vocabulary, an intent closing another, a detail that is no object', async () => {
      expect(await codeOf(governance.record(db.control, { ...entry, action: 'tenant.renamed' as never }))).toBe(
        'GOVERNANCE_ACTION_UNKNOWN'
      )
      expect(await codeOf(governance.record(db.control, { ...entry, outcome: 'done' as never }))).toBe(
        'GOVERNANCE_LOG_ENTRY_INVALID'
      )
      expect(await codeOf(governance.record(db.control, { ...entry, outcome: 'intent', intentId: 'x' }))).toBe(
        'GOVERNANCE_LOG_ENTRY_INVALID'
      )
      expect(await codeOf(governance.record(db.control, { ...entry, detail: ['unpaid'] as never }))).toBe(
        'GOVERNANCE_LOG_ENTRY_INVALID'
      )
      expect(await governance.countQuery(db.control, { action: 'tenant.renamed' })).toBe(0)
    })

    it('refuses an actor without its plane, a plane without its actor, and a plane it does not know (T-17.11)', async () => {
      const before = await governance.countQuery(db.control, {})
      for (const actor of [{ actorPlane: null }, { actorId: null }, { actorPlane: 'system' as never }]) {
        expect(await codeOf(governance.record(db.control, { ...entry, ...actor }))).toBe('GOVERNANCE_LOG_ENTRY_INVALID')
      }
      expect(await governance.countQuery(db.control, {})).toBe(before)
      // Nobody, from no plane: a job of the framework.
      const unattended = await governance.record(db.control, { ...entry, actorId: null, actorPlane: null })
      expect(unattended).toMatchObject({ actorId: null, actorPlane: null })
    })

    it('reads by tenant, action, actor and plane', async () => {
      await governance.record(db.control, { ...entry, action: 'tenant.restored', tenantId: 'id-globex', actorId: 'op-2' })
      await governance.record(db.control, { ...entry, action: 'tenant.restored', tenantId: 'id-globex', actorId: 'u-2', actorPlane: 'tenant' })
      const found = await governance.findQuery(db.control, { tenantId: 'id-globex' })
      expect(found.records.map((r) => r.action)).toEqual(['tenant.restored', 'tenant.restored'])
      expect(await governance.countQuery(db.control, { action: 'tenant.restored', actorId: 'op-2' })).toBe(1)
      expect(await governance.countQuery(db.control, { action: 'tenant.restored', actorId: 'op-1' })).toBe(0)
      expect(await governance.countQuery(db.control, { tenantId: 'id-globex', actorPlane: 'tenant' })).toBe(1)
    })

    it('commits the change and its event together, with the operator, the request and the address', async () => {
      const created = await governed(
        request(),
        (tx) => tenants.createTenant(tx, { name: 'Initech', slug: 'initech' }),
        (row) => ({ action: 'tenant.created', tenantId: String(row.id), detail: { schemaVersion: null } })
      )
      const [event] = (await governance.findQuery(db.control, { tenantId: String(created.id) })).records
      expect(event).toMatchObject({
        action: 'tenant.created',
        outcome: 'success',
        actorId: 'op-7',
        actorPlane: 'control',
        requestId: 'req-9',
        ip: '198.51.100.0'
      })
    })

    it('rolls the change back when its event cannot be written (F76)', async () => {
      const refused = governed(
        request(),
        (tx) => tenants.createTenant(tx, { name: 'Umbrella', slug: 'umbrella' }),
        () => ({ action: 'tenant.renamed' as never })
      )
      expect(await codeOf(refused)).toBe('GOVERNANCE_ACTION_UNKNOWN')
      expect(await tenants.getTenantBySlug(db.control, 'umbrella')).toBeNull()
    })

    it('writes nothing when the change says nothing changed', async () => {
      const before = await governance.countQuery(db.control, {})
      await governed(request(), async () => false, (changed) => (changed ? { action: 'tenant.deleted' } : null))
      expect(await governance.countQuery(db.control, {})).toBe(before)
    })

    it('answers an intent with the id its outcome will carry', async () => {
      const intent = await intend(request(), { action: 'tenant.exported', tenantId: 'id-acme' })
      const [row] = (await governance.findQuery(db.control, { id: intent })).records
      expect(row).toMatchObject({ action: 'tenant.exported', outcome: 'intent', intentId: null })
    })

    it('holds no foreign key, so no row leaves with the tenant, operator or provider it names', async () => {
      const exec = db.control as unknown as { execute(q: unknown): Promise<Rows> }
      const { rows } = await exec.execute(
        sql`select count(*)::int as n from pg_constraint c join pg_class t on t.oid = c.conrelid
            join pg_namespace s on s.oid = t.relnamespace
            where t.relname = 'governance_log' and s.nspname = ${db.schemas.control} and c.contype = 'f'`
      )
      expect(rows[0].n).toBe(0)
      expect((await governance.record(db.control, { ...entry, tenantId: 'id-never-existed' })).tenantId).toBe('id-never-existed')
    })

    describe('in a tenant container (F100)', () => {
      const tokens = createTokenManager()
      const act: GovernanceLogEntry = {
        action: 'token.created',
        outcome: 'success',
        actorId: 'u-1',
        actorPlane: 'tenant',
        tenantId: null,
        targetId: 'tok-1',
        detail: { roles: ['reader'] }
      }
      // A tenant's admin on a tenant route: no control plane on the request, the container named.
      const member = () => ({ server: { governanceLogManager: governance }, user: { id: 'u-3' }, ip: '192.0.2.44', id: 'req-3' }) as never
      const ids = async (schema: string) =>
        ((await (db.raw.db as any).execute(sql.raw(`select id from "${schema}".governance_log`))).rows as Rows['rows']).map((r) => r.id)

      it('writes an act on a token in the tenant, and the control plane never sees it', async () => {
        const row = await governance.record(db.tenant, act)
        expect(row).toMatchObject({ action: 'token.created', actorPlane: 'tenant', tenantId: null, targetId: 'tok-1' })
        expect(await ids(db.schemas.tenant)).toContain(row.id)
        expect(await ids(db.schemas.control)).not.toContain(row.id)
        expect((await governance.findQuery(db.tenant, { targetId: 'tok-1' })).records.map((r) => r.id)).toEqual([row.id])
        expect(await governance.countQuery(db.control, { targetId: 'tok-1' })).toBe(0)
      })

      it('reads one kind of act where both sit, as on the only database without tenants', async () => {
        await governance.record(db.control, { ...act, targetId: 'tok-solo' })
        await governance.record(db.control, { ...entry, targetId: 'tok-solo' })
        const kinds = async (scope?: 'platform' | 'container') =>
          (await governance.findQuery(db.control, { targetId: 'tok-solo' }, scope)).records.map((r) => r.action).sort()
        expect(await kinds()).toEqual(['tenant.suspended', 'token.created'])
        expect(await kinds('container')).toEqual(['token.created'])
        expect(await kinds('platform')).toEqual(['tenant.suspended'])
        expect(await governance.countQuery(db.control, { targetId: 'tok-solo' }, 'container')).toBe(1)
        expect(await codeOf(governance.countQuery(db.control, {}, 'tenant' as never))).toBe('GOVERNANCE_LOG_ENTRY_INVALID')
      })

      it('refuses an act on the platform written in a tenant, where it would leave with the customer', async () => {
        const before = await governance.countQuery(db.tenant, {})
        expect(await codeOf(governance.record(db.tenant, { ...entry }))).toBe('GOVERNANCE_ACTION_MISPLACED')
        const refused = governed(
          member(),
          (tx) => tokens.createToken(tx, { name: 'never' }),
          () => ({ action: 'tenant.suspended' }),
          { container: db.tenant }
        )
        expect(await codeOf(refused)).toBe('GOVERNANCE_ACTION_MISPLACED')
        expect(await governance.countQuery(db.tenant, {})).toBe(before)
        expect((await (db.raw.db as any).select().from(db.raw.tables.token)).map((t: { name: string }) => t.name)).not.toContain('never')
      })

      it('commits a token and its act together in the container, with the user and the impersonation', async () => {
        const created = await governed(
          { ...(member() as object), impersonation: { id: 'imp-1' } } as never,
          (tx) => tokens.createToken(tx, { name: 'ci', roles: ['reader'] }),
          (row) => ({ action: 'token.created', targetId: row.id, detail: { roles: row.roles } }),
          { container: db.tenant }
        )
        const [event] = (await governance.findQuery(db.tenant, { targetId: created.id })).records
        expect(event).toMatchObject({ actorId: 'u-3', actorPlane: 'tenant', requestId: 'req-3', ip: '192.0.2.0', tenantId: null })
        expect(event.detail).toEqual({ roles: ['reader'], impersonationId: 'imp-1' })
      })

      it('writes a renewal by nobody when the act is the framework own', async () => {
        const token = await tokens.createToken(db.tenant, { name: 'restored' })
        await governed(
          { governance, ctx: db.tenant },
          (tx) => tokens.resetExternalId(tx, token.id),
          () => ({ action: 'token.reissued', targetId: token.id, detail: { cause: 'tenant.imported' } })
        )
        const [event] = (await governance.findQuery(db.tenant, { targetId: token.id })).records
        expect(event).toMatchObject({ action: 'token.reissued', actorId: null, actorPlane: null, ip: null })
      })
    })

    // The rule is in the database, so it holds for psql, a script and a framework bug alike.
    describe('append-only in the database (F102)', () => {
      const exec = (q: string) => (db.raw.db as any).execute(sql.raw(q))
      const refusal = async (q: string): Promise<string> => {
        try {
          await exec(q)
        } catch (e) {
          return String((e as { message?: string; cause?: { message?: string } }).cause?.message ?? (e as Error).message)
        }
        return 'NO_ERROR'
      }

      for (const plane of ['control', 'tenant'] as const) {
        it(`refuses UPDATE, DELETE and TRUNCATE on the ${plane} log, a statement touching no row included`, async () => {
          const schema = db.schemas[plane]
          const at = `"${schema}".governance_log`
          expect(await refusal(`delete from ${at} where false`)).toMatch(/append-only: DELETE refused/)
          expect(await refusal(`truncate ${at}`)).toMatch(/append-only: TRUNCATE refused/)
          await governance.record(plane === 'control' ? db.control : db.tenant, plane === 'control' ? entry : { ...entry, action: 'token.deleted', tenantId: null })
          const before = (await exec(`select count(*)::int as n from ${at}`)).rows[0].n
          expect(await refusal(`update ${at} set action = 'tenant.created'`)).toMatch(/append-only: UPDATE refused/)
          expect(await refusal(`delete from ${at}`)).toMatch(/append-only: DELETE refused/)
          expect((await exec(`select count(*)::int as n from ${at}`)).rows[0].n).toBe(before)
          expect(before).toBeGreaterThan(0)
        })

        it(`keeps refusing on the ${plane} log with triggers off for replication`, async () => {
          const at = `"${db.schemas[plane]}".governance_log`
          const replica = (db.raw.db as any).transaction(async (tx: any) => {
            await tx.execute(sql.raw('set local session_replication_role = replica'))
            await tx.execute(sql.raw(`delete from ${at}`))
          })
          expect(String(await replica.catch((e: any) => e.cause?.message ?? e.message))).toMatch(/append-only: DELETE refused/)
        })
      }
    })
  })
}

behaviours('PGlite', () => migratedPglite())

if (DATABASE_URL) {
  let n = 0
  behaviours('Postgres', () => {
    n++
    return migratedPostgres({ control: `test_gov_ctl_${n}`, tenant: `test_gov_acme_${n}` })
  })
}
