/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-4.1: who administers the platform and who administers a tenant are different identities.
//
// In v4 the difference rested on ONE thing: which schema resolved the `user` table. That is
// exactly what defect D-01 broke, so every administrative operation was one defect away from
// a privilege escalation. The tests below therefore do not check that a role name is
// accepted; they check that a credential from one plane buys nothing on the other.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import authHook from '../../lib/hooks/onRequest.js'
import { loadSystem } from '../../lib/loader/roles.js'
import { preHandler as isAuthenticated } from '../../lib/middleware/isAuthenticated.js'
import { login as systemLogin, me } from '../../lib/api/system/controller/systemAuth.js'

const SECRET = 'system-scope-test-secret-32-chars!'

const ROOT = { id: 'sys-1', externalId: 'sys-ext-1', email: 'root@system.test', roles: ['system:admin'], blocked: false }
const AUDITOR = { id: 'sys-2', externalId: 'sys-ext-2', email: 'auditor@system.test', roles: ['system:auditor'], blocked: false }
// Carries the credential columns a row really has, so a response that leaked them would show it.
const OPERATOR = {
  id: 'sys-3',
  externalId: 'sys-ext-3',
  email: 'operator@system.test',
  roles: ['system:operator'],
  blocked: false,
  password: '$2b$12$hash',
  mfaSecret: 'encrypted-secret',
  mfaRecoveryCodes: ['code']
}
const TENANT_USER = { getId: () => 'u1', externalId: 'u-ext-1', email: 'admin@acme.test', roles: ['admin'] }

;(global as any).log = {}

// The catalogues are swapped in for this suite only and put back afterwards. Mocha runs
// every spec file in one process, so a global assigned at module load is assigned for
// everybody: another suite's role catalogue is not this suite's to overwrite.
let savedRoles: any
let savedSystemRoles: any

async function takeCatalogues() {
  savedRoles = (global as any).roles
  savedSystemRoles = (global as any).systemRoles
  ;(global as any).roles = {
    public: { code: 'public', name: 'Public' },
    admin: { code: 'admin', name: 'Admin' }
  }
  ;(global as any).systemRoles = await loadSystem()
}

function giveCataloguesBack() {
  ;(global as any).roles = savedRoles
  ;(global as any).systemRoles = savedSystemRoles
}

function serverWith(opts: any = {}) {
  ;(global as any).config = { options: { tenants: opts.tenants ?? null, ...(opts.options ?? {}) } }

  const server: any = fastify()
  server.decorate('provider', {})
  server.decorate('systemUserManager', {
    isImplemented: () => opts.systemUsers !== false,
    retrieveSystemUserByExternalId: async (_ctx: any, externalId: string) =>
      [ROOT, AUDITOR, OPERATOR].find((u) => u.externalId === externalId) ?? null,
    // The password is not what these tests are about: the login here is the door the MFA policy
    // stands in front of (T-10.19).
    retrieveSystemUserByPassword: async (_ctx: any, email: string) =>
      [ROOT, AUDITOR, OPERATOR].find((u) => u.email === email) ?? null
  })
  server.decorate('userManager', {
    isImplemented: () => true,
    isValidUser: async () => true,
    retrieveUserByExternalId: async (_ctx: any, externalId: string) =>
      externalId === TENANT_USER.externalId ? TENANT_USER : null
  })
  server.decorate('tokenManager', { isImplemented: () => false })

  return server
}

/** The two hooks index.ts wires, reduced to what this suite needs. */
async function build(opts: any = {}) {
  const server = serverWith(opts)
  await server.register(jwtValidator, { secret: SECRET })

  server.addHook('onRequest', async (req: any) => {
    req.data = () => (req.body as any) ?? {}
    req.parameters = () => ({})
    // What lib/loader/tenant.ts sets: the control plane on every request, the tenant when
    // one was resolved.
    req.control = { kind: 'control' }
    if (opts.tenants && req.routeOptions?.config?.tenantContext !== false) {
      req.tenant = { kind: 'tenant', tenantId: 'id-acme' }
      req.tenantInfo = { id: 'id-acme', slug: 'acme' }
    }
  })
  server.addHook('onRequest', authHook)

  server.get(
    '/platform',
    { config: { tenantContext: false, requiredRoles: [{ code: 'system:admin' }, { code: 'system:auditor' }] } },
    async (req: any) => ({ who: req.systemUser?.email ?? null, user: req.user?.email ?? null, roles: req.roles() })
  )
  server.get(
    '/platform/destroy',
    { config: { tenantContext: false, requiredRoles: [{ code: 'system:admin' }] } },
    async () => ({ ok: true })
  )
  server.get('/orders', { config: { tenantContext: true, requiredRoles: [{ code: 'admin' }] } }, async (req: any) => ({
    who: req.user?.email ?? null
  }))
  // What lib/api/system/routes.ts declares for `GET /system/auth/me`: `public` on the role gate,
  // `isAuthenticated` as the middleware.
  server.get(
    '/system/auth/me',
    { config: { tenantContext: false, requiredRoles: [{ code: 'public' }] }, preHandler: isAuthenticated },
    me
  )
  server.post('/system/auth/login', { config: { tenantContext: false, requiredRoles: [{ code: 'public' }] } }, systemLogin)

  await server.ready()
  return server
}

const get = (server: any, url: string, token?: string) =>
  server.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} })

const MULTI = { strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: 'x-tenant-id' }

describe('control scope · platform identities (T-4.1)', () => {
  // Inside the describe, not at the top of the file: a hook at file level is a ROOT hook in
  // mocha and would hold the swap for the whole run, other suites included.
  before(takeCatalogues)
  after(giveCataloguesBack)

  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('lets a system token onto a platform route, and resolves it in the control plane', async () => {
    const server = await build({ tenants: MULTI })
    const token = server.jwt.sign({ sub: ROOT.externalId, scp: 'control' })

    const res = await get(server, '/platform', token)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.who).toBe('root@system.test')
    // Not `req.user`: one field holding either identity would put the two back in the same
    // slot, which is the shape this phase exists to remove.
    expect(body.user).toBe(null)
    expect(body.roles).toEqual(['system:admin'])
    await server.close()
  })

  it('refuses a tenant token on a platform route, whatever roles it carries', async () => {
    const server = await build({ tenants: MULTI })
    const tenantToken = server.jwt.sign({ sub: TENANT_USER.externalId, tid: 'id-acme' })

    const res = await get(server, '/platform', tenantToken)
    // Not 404 "subject not found": the identity is from another plane, and saying so is the
    // point. There is no path where a tenant admin is "admin enough" for the platform.
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).code).toBe('SCOPE_MISMATCH')
    await server.close()
  })

  it('still applies the role intersection inside the control catalogue', async () => {
    const server = await build({ tenants: MULTI })
    const auditor = server.jwt.sign({ sub: AUDITOR.externalId, scp: 'control' })

    expect((await get(server, '/platform', auditor)).statusCode).toBe(200)
    // The auditor is a system user and still cannot do everything: separating the planes is
    // not the same as flattening one of them.
    const denied = await get(server, '/platform/destroy', auditor)
    expect(denied.statusCode).toBe(403)
    expect(JSON.parse(denied.body).code).toBe('FORBIDDEN')
    await server.close()
  })

  it('gives the day-to-day role the capability that opens the platform console (T-10.14)', () => {
    // Without `manifest` the operator cannot load the console the job is done in, and a project
    // cannot add it: the capabilities of a protected role are not a consumer's to change.
    const catalogue = (global as any).systemRoles
    expect(catalogue['system:operator'].capabilities).toContain('manifest')
    // And what only the superuser may do stays out of it.
    expect(catalogue['system:operator'].capabilities).not.toContain('tenants:destroy')
  })

  it('refuses an anonymous caller on a platform route', async () => {
    const server = await build({ tenants: MULTI })
    const res = await get(server, '/platform')
    expect(res.statusCode).toBe(401)
    await server.close()
  })

  it('leaves the tenant plane to tenant users', async () => {
    const server = await build({ tenants: MULTI })
    const token = server.jwt.sign({ sub: TENANT_USER.externalId, tid: 'id-acme' })

    const res = await get(server, '/orders', token)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).who).toBe('admin@acme.test')
    await server.close()
  })

  it('does not demand a platform identity where there is no platform', async () => {
    // No `tenants` block: one container, one identity space. Demanding a system user on a
    // control-scope route there would demand one the deployment never creates, and
    // `/health` and `/admin/manifest` are control-scope routes.
    const server = await build({})
    const token = server.jwt.sign({ sub: TENANT_USER.externalId })

    const res = await server.inject({
      method: 'GET',
      url: '/orders',
      headers: { authorization: `Bearer ${token}` }
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).who).toBe('admin@acme.test')
    await server.close()
  })

  it('says so plainly when the build has no platform identities', async () => {
    const server = await build({ tenants: MULTI, systemUsers: false })
    const token = server.jwt.sign({ sub: ROOT.externalId, scp: 'control' })

    const res = await get(server, '/platform', token)
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).code).toBe('SYSTEM_USERS_NOT_AVAILABLE')
    await server.close()
  })
})

//
// T-10.14: a platform console has to learn who logged in. `/users/me` is a tenant route, and a
// control token there is refused, so before this route a console could sign an operator in and
// never know which roles to draw the screens for.
//
describe('control scope · the identity behind a platform session (T-10.14)', () => {
  before(takeCatalogues)
  after(giveCataloguesBack)

  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('answers every platform identity with its roles, not only the superuser', async () => {
    const server = await build({ tenants: MULTI })
    const token = server.jwt.sign({ sub: OPERATOR.externalId, scp: 'control' })

    const res = await get(server, '/system/auth/me', token)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.email).toBe('operator@system.test')
    expect(body.roles).toEqual(['system:operator'])
    await server.close()
  })

  it('never returns the credential columns of the row', async () => {
    const server = await build({ tenants: MULTI })
    const token = server.jwt.sign({ sub: OPERATOR.externalId, scp: 'control' })

    const body = JSON.parse((await get(server, '/system/auth/me', token)).body)
    for (const secret of ['password', 'mfaSecret', 'mfaRecoveryCodes']) expect(body).not.toHaveProperty(secret)
    await server.close()
  })

  it('refuses an anonymous caller, although the role gate is public', async () => {
    const server = await build({ tenants: MULTI })
    const res = await get(server, '/system/auth/me')
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).code).toBe('UNAUTHORIZED')
    await server.close()
  })

  it('makes the platform policy oblige the operators too (T-10.19)', async () => {
    // Until now `MFA_POLICY` was read only by the tenant routes: `MANDATORY` obliged the users of
    // every customer and none of the people who can destroy a customer.
    const server = await build({ tenants: MULTI, options: { system_mfa_policy: 'MANDATORY' } })

    const res = await server.inject({
      method: 'POST',
      url: '/system/auth/login',
      payload: { email: OPERATOR.email, password: 'whatever' }
    })

    expect(res.statusCode).toBe(202)
    const body = JSON.parse(res.body)
    // No factor yet, and the policy requires one: the first factor buys the enrolment, not a session.
    expect(body.mfaSetupRequired).toBe(true)
    expect(body.mfaRequired).toBe(false)
    expect(body.token).toBeUndefined()
    await server.close()
  })

  it('leaves the operators alone where the platform asks for no second factor', async () => {
    const server = await build({ tenants: MULTI })
    const res = await server.inject({
      method: 'POST',
      url: '/system/auth/login',
      payload: { email: OPERATOR.email, password: 'whatever' }
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).securityPolicy).toEqual({ mfaPolicy: 'OPTIONAL' })
    await server.close()
  })

  it('refuses a tenant token: a customer session is not a platform identity', async () => {
    const server = await build({ tenants: MULTI })
    const tenantToken = server.jwt.sign({ sub: TENANT_USER.externalId, tid: 'id-acme' })

    const res = await get(server, '/system/auth/me', tenantToken)
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).code).toBe('SCOPE_MISMATCH')
    await server.close()
  })
})
