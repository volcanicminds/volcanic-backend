//
// T-15.2, the governance log of F76 on a real migrated control plane: the closed vocabulary, the
// truncated address, the reading by tenant and action, and the property every governance route
// rests on: an event that cannot be written takes its registry change down with it. PGlite always,
// Postgres with DATABASE_URL.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import type { GovernanceLogEntry } from '../../types/global.js'
import { createGovernanceLogManager } from '../../lib/database/managers/governanceLog.js'
import { createTenantManager } from '../../lib/database/managers/tenant.js'
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

    it('reads by tenant, action and actor', async () => {
      await governance.record(db.control, { ...entry, action: 'tenant.restored', tenantId: 'id-globex', actorId: 'op-2' })
      const found = await governance.findQuery(db.control, { tenantId: 'id-globex' })
      expect(found.records.map((r) => r.action)).toEqual(['tenant.restored'])
      expect(await governance.countQuery(db.control, { action: 'tenant.restored', actorId: 'op-2' })).toBe(1)
      expect(await governance.countQuery(db.control, { action: 'tenant.restored', actorId: 'op-1' })).toBe(0)
    })

    it('commits the change and its event together, with the operator, the request and the address', async () => {
      const created = await governed(
        request(),
        (tx) => tenants.createTenant(tx, { name: 'Initech', slug: 'initech' }),
        (row) => ({ action: 'tenant.created', tenantId: String(row.id), detail: { schemaVersion: null } })
      )
      const [event] = (await governance.findQuery(db.control, { tenantId: String(created.id) })).records
      expect(event).toMatchObject({ action: 'tenant.created', outcome: 'success', actorId: 'op-7', requestId: 'req-9', ip: '198.51.100.0' })
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
