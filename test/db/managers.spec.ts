/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-2.5, against a real SQLite in memory. What matters here is not that an insert works but
// the properties appendix B of EVO_FRAMEWORK.md lists as already correct in v4 and that the
// port must not lose: constant-cost password comparison, a reset token that carries its own
// expiry, and a context that is never inferred.
//
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { expect } from 'expect'
import { appTables, registryTables } from '../../lib/database/schema/sqlite.js'
import { createUserManager } from '../../lib/database/managers/user.js'
import { createTokenManager } from '../../lib/database/managers/token.js'
import { createTrackingManager } from '../../lib/database/managers/tracking.js'
import { createTenantManager } from '../../lib/database/managers/tenant.js'

process.env.MFA_DB_SECRET = process.env.MFA_DB_SECRET || 'unit-test-secret-please-change-32xyz'

const tables = appTables()
const registry = registryTables()

const createTableSql = (table: any) => {
  const config = getTableConfig(table)
  const columns = config.columns
    .map((c: any) => `"${c.name}" ${c.getSQLType()}${c.primary ? ' primary key' : ''}`)
    .join(', ')
  return `create table "${config.name}" (${columns})`
}

let control: any
let tenant: any

const users = createUserManager()
const tokens = createTokenManager()
const tracking = createTrackingManager()

before(() => {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  for (const t of [tables.user, tables.token, tables.change, registry.tenant]) {
    sqlite.exec(createTableSql(t))
  }
  control = { kind: 'control', dialect: 'sqlite', db, tables, registry }
  tenant = { kind: 'tenant', dialect: 'sqlite', tenantId: 'acme', db, tables }
})

describe('database/managers · context', () => {
  it('refuses to work without a handle instead of finding one', async () => {
    // v4 fell back to the global connection here, which meant reading whichever container
    // the pool had last touched (D-06).
    await expect(users.retrieveUserByEmail(undefined as never, 'x@y.z')).rejects.toThrow(/needs a data handle/)
    await expect(tokens.countQuery(null as never, {})).rejects.toThrow(/needs a data handle/)
  })

  it('refuses a tenant handle where the registry is required', async () => {
    const manager = createTenantManager({ openContainer: async () => tenant })
    await expect(manager.listTenants(tenant as never)).rejects.toThrow(/control plane/)
  })
})

describe('database/managers · users', function () {
  this.timeout(30000)

  it('creates a user with a hashed password and a generated identity', async () => {
    const created: any = await users.createUser(tenant, { email: 'Anna@Acme.test', password: 'Acme-pw-123456' })
    expect(created.email).toBe('anna@acme.test') // normalised, so a login cannot miss it by case
    expect(created.password).not.toBe('Acme-pw-123456')
    expect(created.password.startsWith('$2b$12$')).toBe(true) // cost 12, as in v4
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.externalId).toBeTruthy()
    expect(created.confirmed).toBe(false) // registration never self-confirms
  })

  it('verifies a password, and costs the same when the email is unknown', async () => {
    expect(await users.retrieveUserByPassword(tenant, 'anna@acme.test', 'Acme-pw-123456')).toBeTruthy()
    expect(await users.retrieveUserByPassword(tenant, 'anna@acme.test', 'wrong')).toBeNull()

    // The point is that both paths run a bcrypt comparison: timing must not answer
    // "is this address registered?" when the messages refuse to.
    const started = Date.now()
    expect(await users.retrieveUserByPassword(tenant, 'nobody@acme.test', 'whatever')).toBeNull()
    expect(Date.now() - started).toBeGreaterThan(20)
  })

  it('mints a reset token that carries its own expiry', async () => {
    const token = (await users.forgotPassword(tenant, 'anna@acme.test', 900))!
    expect(token).toMatch(/^\d+\.[0-9a-f]{32}$/)

    const [epoch] = token.split('.')
    const inSeconds = Number(epoch) - Math.floor(Date.now() / 1000)
    expect(inSeconds).toBeGreaterThan(880)
    expect(inSeconds).toBeLessThanOrEqual(900)
  })

  it('says nothing about an address it does not know', async () => {
    expect(await users.forgotPassword(tenant, 'nobody@acme.test')).toBeNull()
  })

  it('changes a password only against the old one', async () => {
    expect(await users.changePassword(tenant, 'anna@acme.test', 'New-pw-1234567', 'wrong')).toBe(false)
    expect(await users.changePassword(tenant, 'anna@acme.test', 'New-pw-1234567', 'Acme-pw-123456')).toBe(true)
    expect(await users.retrieveUserByPassword(tenant, 'anna@acme.test', 'New-pw-1234567')).toBeTruthy()
  })

  it('stores an MFA secret encrypted and reads it back', async () => {
    const created: any = await users.createUser(tenant, { email: 'mfa@acme.test', password: 'Mfa-pw-1234567' })
    await users.saveMfaSecret(tenant, created.id, 'JBSWY3DPEHPK3PXP')

    const stored: any = await users.retrieveUserById(tenant, created.id)
    expect(stored.mfaSecret.startsWith('v2:')).toBe(true)
    expect(await users.retrieveMfaSecret(tenant, created.id)).toBe('JBSWY3DPEHPK3PXP')
  })

  it('never lets a password through a generic update', async () => {
    const created: any = await users.createUser(tenant, { email: 'update@acme.test', password: 'Upd-pw-1234567' })
    await users.updateUserById(tenant, created.id, { password: 'plaintext', username: 'updated' })

    const after: any = await users.retrieveUserById(tenant, created.id)
    expect(after.username).toBe('updated')
    expect(after.password).not.toBe('plaintext')
    expect(after.version).toBe(2) // optimistic lock moves on every update
  })

  it('finds and counts through the Magic Query', async () => {
    const found: any = await users.findQuery(tenant, { 'email:contains': 'acme' } as never)
    expect(found.records.length).toBeGreaterThan(0)
    expect(found.headers['v-total']).toBe(await users.countQuery(tenant, { 'email:contains': 'acme' } as never))
  })

  it('soft-deletes, and a deleted user stops being found', async () => {
    const created: any = await users.createUser(tenant, { email: 'gone@acme.test', password: 'Gone-pw-123456' })
    expect(await users.deleteUser(tenant, created.id)).toBe(true)

    const found: any = await users.findQuery(tenant, { 'email:eq': 'gone@acme.test' } as never)
    expect(found.records.length).toBe(0)
    expect(await users.retrieveUserByPassword(tenant, 'gone@acme.test', 'Gone-pw-123456')).toBeNull()
  })
})

describe('database/managers · tokens and tracking', () => {
  it('writes a credential with the expiry it was given, and no default', async () => {
    const forever: any = await tokens.createToken(tenant, { name: 'ci' })
    const expiring: any = await tokens.createToken(tenant, { name: 'temp', expiresAt: '2027-01-01T00:00:00Z' })

    expect(forever.expiresAt).toBeNull()
    expect(new Date(expiring.expiresAt).getUTCFullYear()).toBe(2027)
  })

  it('writes an audit row inside the container it was given', async () => {
    const written: any = await tracking.addChange(tenant, {
      status: 'updated',
      entityName: 'user',
      entityId: 'u1',
      userId: 'actor',
      contents: { email: ['a', 'b'] }
    })
    expect(written.id).toBeTruthy()

    const history: any = await tracking.retrieveBy(tenant, 'user', 'u1')
    expect(history.length).toBe(1)
    expect(history[0].contents).toEqual({ email: ['a', 'b'] })
  })
})

describe('database/managers · tenants', () => {
  const manager = createTenantManager({ openContainer: async () => tenant as never })

  it('registers a tenant and finds it by slug', async () => {
    const created: any = await manager.createTenant(control, {
      name: 'Acme',
      slug: 'acme',
      strategy: 'container',
      engine: 'sqlite',
      locator: 'acme.db'
    })
    expect(created.status).toBe('active')
    expect((await manager.getTenantBySlug(control, 'acme'))!.id).toBe(created.id)
  })

  it('refuses to move a container with an update', async () => {
    const tenantRow: any = await manager.getTenantBySlug(control, 'acme')
    await manager.updateTenant(control, tenantRow.id, { name: 'Acme Two', locator: 'elsewhere.db' })

    const after: any = await manager.getTenant(control, tenantRow.id)
    expect(after.name).toBe('Acme Two')
    expect(after.locator).toBe('acme.db') // moving data is a migration, not a field edit
  })

  it('separates archiving the registry row from destroying the data', async () => {
    const tenantRow: any = await manager.getTenantBySlug(control, 'acme')
    expect(await manager.softDeleteTenant(control, tenantRow.id)).toBe(true)
    expect(await manager.getTenantBySlug(control, 'acme')).toBeNull()

    // And the irreversible one refuses to run before T-6.3 gives it its ceremony.
    await expect(manager.destroyContainer(tenantRow.id)).rejects.toThrow(/T-6.3/)
  })
})
