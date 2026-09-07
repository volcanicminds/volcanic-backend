/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-4.2: impersonation leaves a record, and the record is what keeps the session alive.
//
// Defect D-18 was not that impersonation existed. It was that it left a claim in a token and
// nothing else: no record of who entered whose data or why, twenty-four hours of validity, no
// way to stop a session once issued, and a privilege check comparing a field the entity did
// not have, so the guard never fired. The tests below therefore check the ORDER (record
// first, token after) and the REVOCATION (a signed token that buys nothing), because those
// are the two properties a claim in a token cannot have.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import { impersonate, endImpersonation, impersonationTtl } from '../../lib/api/tenants/controller/tenants.js'
import { getData, getParams } from '../../lib/util/common.js'
import authHook from '../../lib/hooks/onRequest.js'

;(global as any).log = {}

const ACME: any = { id: 'id-acme', slug: 'acme', status: 'active', locator: 'tenant_acme' }
const TARGET: any = { id: 'u1', externalId: 'u-ext-1', email: 'admin@acme.test' }
const ACTOR: any = { id: 'sys-1', email: 'root@system.test', roles: ['system:admin'] }

function fakes(over: any = {}) {
  const written: any[] = []
  const store = new Map<string, any>()

  const impersonationManager = {
    written,
    store,
    isImplemented: () => over.impersonation !== false,
    openImpersonation: async (_ctx: any, data: any) => {
      const record = { id: `imp-${written.length + 1}`, createdAt: new Date(), revokedAt: null, ...data }
      written.push(record)
      store.set(record.id, record)
      return record
    },
    getImpersonation: async (_ctx: any, id: string) => {
      const r = store.get(id)
      if (!r || r.revokedAt || new Date(r.expiresAt).getTime() <= Date.now()) return null
      return r
    },
    revokeImpersonation: async (_ctx: any, id: string) => {
      const r = store.get(id)
      if (!r || r.revokedAt) return false
      r.revokedAt = new Date()
      return true
    },
    findQuery: async () => ({ records: [], headers: {} })
  }

  return {
    impersonationManager,
    tenantManager: {
      isImplemented: () => true,
      getTenant: async (_ctx: any, id: string) => (id === ACME.id ? { ...ACME, ...(over.tenant ?? {}) } : null)
    },
    userManager: {
      isImplemented: () => true,
      retrieveUserById: async (_ctx: any, id: string) => (id === TARGET.id ? TARGET : null)
    },
    provider: {
      control: async () => ({ kind: 'control' }),
      tenant: async (tenantId: string) => ({ kind: 'tenant', tenantId }),
      releaseRequestScope: async () => {},
      shutdown: async () => {}
    }
  }
}

async function build(over: any = {}) {
  ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' }, ...(over.options ?? {}) } }
  const f = fakes(over)
  const server: any = fastify()
  await server.register(jwtValidator, { secret: 'impersonation-test-secret-32-chars' })

  server.decorate('provider', f.provider)
  server.decorate('tenantManager', f.tenantManager)
  server.decorate('userManager', f.userManager)
  server.decorate('impersonationManager', f.impersonationManager)

  server.addHook('onRequest', async (req: any) => {
    req.data = () => getData(req)
    req.parameters = () => getParams(req)
    req.control = { kind: 'control' }
    req.dataScope = { requestId: String(req.id) }
    if (over.anonymousActor !== true) req.systemUser = ACTOR
  })

  server.post('/tenants/:id/impersonate', { config: { tenantContext: false } }, impersonate)
  server.post('/tenants/impersonate/end', { config: { tenantContext: false } }, endImpersonation)

  await server.ready()
  return { server, ...f }
}

const open = (server: any, payload: any, id = ACME.id) =>
  server.inject({ method: 'POST', url: `/tenants/${id}/impersonate`, payload })

describe('impersonation · the record comes first (T-4.2)', () => {
  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('writes who, into which tenant, as whom and why, then mints the token', async () => {
    const { server, impersonationManager } = await build()
    const res = await open(server, { userId: 'u1', reason: 'ticket 4412, customer cannot check out' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    // The record exists before the token does. A token issued first is a token whose trail
    // can fail to be written.
    expect(impersonationManager.written.length).toBe(1)
    const record = impersonationManager.written[0]
    expect(record.systemUserId).toBe('sys-1')
    expect(record.tenantId).toBe('id-acme')
    expect(record.targetUserId).toBe('u1')
    expect(record.reason).toBe('ticket 4412, customer cannot check out')
    expect(body.impersonationId).toBe(record.id)

    // A TENANT token: inside the container the session is an ordinary user.
    const claims: any = server.jwt.decode(body.token)
    expect(claims.sub).toBe('u-ext-1')
    expect(claims.tid).toBe('id-acme')
    expect(claims.imp).toBe(record.id)
    expect(claims.scp).toBe(undefined)
    await server.close()
  })

  it('refuses without a stated reason, before anything is written', async () => {
    const { server, impersonationManager } = await build()

    const missing = await open(server, { userId: 'u1' })
    expect(missing.statusCode).toBe(400)
    expect(JSON.parse(missing.body).code).toBe('REASON_REQUIRED')

    const empty = await open(server, { userId: 'u1', reason: '  ' })
    expect(empty.statusCode).toBe(400)

    // The reason is what makes the record worth keeping, so no reason means no record.
    expect(impersonationManager.written.length).toBe(0)
    await server.close()
  })

  it('expires in half an hour by default, and never past four', async () => {
    ;(global as any).config = { options: {} }
    expect(impersonationTtl()).toBe(1800)
    ;(global as any).config = { options: { impersonation_ttl: 60 * 60 } }
    expect(impersonationTtl()).toBe(3600)
    // v4 issued these for twenty-four hours. The ceiling is not configurable.
    ;(global as any).config = { options: { impersonation_ttl: 48 * 3600 } }
    expect(impersonationTtl()).toBe(4 * 3600)
  })

  it('refuses a target that does not exist inside the container', async () => {
    const { server, impersonationManager } = await build()
    const res = await open(server, { userId: 'ghost', reason: 'looking around' })
    expect(res.statusCode).toBe(404)
    expect(impersonationManager.written.length).toBe(0)
    await server.close()
  })

  it('refuses a tenant that is not active', async () => {
    const { server } = await build({ tenant: { status: 'suspended' } })
    const res = await open(server, { userId: 'u1', reason: 'support request' })
    expect(res.statusCode).toBe(404)
    await server.close()
  })

  it('refuses a caller with no platform identity', async () => {
    // The capability gates the route; this is the deployment shape where a control route
    // authenticates an application user. There is nobody to attribute the session to.
    const { server } = await build({ anonymousActor: true })
    const res = await open(server, { userId: 'u1', reason: 'support request' })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).code).toBe('SCOPE_MISMATCH')
    await server.close()
  })
})

describe('impersonation · ending one (T-4.2)', () => {
  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('revokes the record, and says nothing on a second attempt', async () => {
    const { server, impersonationManager } = await build()
    const opened = JSON.parse((await open(server, { userId: 'u1', reason: 'ticket 4412' })).body)

    const end = () =>
      server.inject({ method: 'POST', url: '/tenants/impersonate/end', payload: { impersonationId: opened.impersonationId } })

    const first = await end()
    expect(first.statusCode).toBe(200)
    expect(impersonationManager.store.get(opened.impersonationId).revokedAt).toBeTruthy()

    // Already closed and never existed answer the same 404: telling them apart would let a
    // caller probe the register from outside.
    expect((await end()).statusCode).toBe(404)
    await server.close()
  })

  it('stops the session immediately, though the JWT is still signed and unexpired', async () => {
    const { server, impersonationManager } = await build()
    const opened = JSON.parse((await open(server, { userId: 'u1', reason: 'ticket 4412' })).body)

    // Still a valid signature with time left on it.
    expect(server.jwt.verify(opened.token)).toBeTruthy()

    await server.inject({
      method: 'POST',
      url: '/tenants/impersonate/end',
      payload: { impersonationId: opened.impersonationId }
    })

    // And yet the session is over: what the request hook consults is the record, not the
    // signature. This is the difference between "revoke" and "stop issuing new ones".
    expect(await impersonationManager.getImpersonation({} as never, opened.impersonationId)).toBeNull()
    await server.close()
  })

  it('treats an expired record as over, without anyone revoking it', async () => {
    const { server, impersonationManager } = await build({ options: { impersonation_ttl: 1 } })
    const opened = JSON.parse((await open(server, { userId: 'u1', reason: 'ticket 4412' })).body)

    const record = impersonationManager.store.get(opened.impersonationId)
    record.expiresAt = new Date(Date.now() - 1000)
    expect(await impersonationManager.getImpersonation({} as never, opened.impersonationId)).toBeNull()
    await server.close()
  })

  it('asks for the record it should close', async () => {
    const { server } = await build()
    const res = await server.inject({ method: 'POST', url: '/tenants/impersonate/end', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).code).toBe('IMPERSONATION_REQUIRED')
    await server.close()
  })
})

//
// The half that cannot be tested through the controller: what a request DOES with an `imp`
// claim. This is where "revoked" has to mean "now", because the alternative is a signed
// token nobody can stop for the rest of its half hour.
//
describe('impersonation · what a request does with the claim (T-4.2)', () => {
  let savedRoles: any

  before(() => {
    savedRoles = (global as any).roles
    ;(global as any).roles = { public: { code: 'public', name: 'Public' }, admin: { code: 'admin', name: 'Admin' } }
  })
  after(() => {
    ;(global as any).roles = savedRoles
  })
  afterEach(() => {
    ;(global as any).config = undefined
  })

  async function impersonatedServer() {
    const { server, impersonationManager } = await build()
    const opened = JSON.parse((await open(server, { userId: 'u1', reason: 'ticket 4412' })).body)

    // A second server, wired like a real tenant request: the authentication hook, a tenant
    // route, and the container this session belongs to.
    const app: any = fastify()
    await app.register(jwtValidator, { secret: 'impersonation-test-secret-32-chars' })
    app.decorate('impersonationManager', impersonationManager)
    app.decorate('userManager', {
      isImplemented: () => true,
      isValidUser: async () => true,
      retrieveUserByExternalId: async () => ({ ...TARGET, getId: () => TARGET.id, roles: ['admin'] })
    })
    app.decorate('tokenManager', { isImplemented: () => false })

    app.addHook('onRequest', async (req: any) => {
      req.data = () => ({})
      req.parameters = () => ({})
      req.control = { kind: 'control' }
      req.tenant = { kind: 'tenant', tenantId: ACME.id }
      req.tenantInfo = { id: ACME.id, slug: ACME.slug }
    })
    app.addHook('onRequest', authHook)
    app.get('/orders', { config: { tenantContext: true, requiredRoles: [{ code: 'admin' }] } }, async (req: any) => ({
      who: req.user?.email,
      imp: req.impersonation?.id ?? null
    }))
    await app.ready()

    return { server, app, impersonationManager, opened }
  }

  it('serves the request and marks it with the record', async () => {
    ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
    const { server, app, opened } = await impersonatedServer()

    const res = await app.inject({ method: 'GET', url: '/orders', headers: { authorization: `Bearer ${opened.token}` } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.who).toBe('admin@acme.test')
    // The request knows it is impersonated, which is what lets the audit trail say so.
    expect(body.imp).toBe(opened.impersonationId)
    await app.close()
    await server.close()
  })

  it('refuses the very next request once the record is revoked', async () => {
    ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
    const { server, app, impersonationManager, opened } = await impersonatedServer()

    const before = await app.inject({ method: 'GET', url: '/orders', headers: { authorization: `Bearer ${opened.token}` } })
    expect(before.statusCode).toBe(200)

    await impersonationManager.revokeImpersonation({} as never, opened.impersonationId)

    const after = await app.inject({ method: 'GET', url: '/orders', headers: { authorization: `Bearer ${opened.token}` } })
    // Same token, same signature, same expiry. The record is what ended.
    expect(after.statusCode).toBe(403)
    expect(JSON.parse(after.body).code).toBe('IMPERSONATION_ENDED')
    await app.close()
    await server.close()
  })

  it('refuses a session presented against another tenant', async () => {
    ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
    const { server, app, impersonationManager, opened } = await impersonatedServer()

    impersonationManager.store.get(opened.impersonationId).tenantId = 'id-globex'
    const res = await app.inject({ method: 'GET', url: '/orders', headers: { authorization: `Bearer ${opened.token}` } })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).code).toBe('TENANT_MISMATCH')
    await app.close()
    await server.close()
  })
})
