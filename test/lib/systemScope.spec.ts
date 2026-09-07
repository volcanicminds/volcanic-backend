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

const SECRET = 'system-scope-test-secret-32-chars!'

const ROOT = { id: 'sys-1', externalId: 'sys-ext-1', email: 'root@system.test', roles: ['system:admin'], blocked: false }
const AUDITOR = { id: 'sys-2', externalId: 'sys-ext-2', email: 'auditor@system.test', roles: ['system:auditor'], blocked: false }
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
  ;(global as any).config = { options: { tenants: opts.tenants ?? null } }

  const server: any = fastify()
  server.decorate('provider', {})
  server.decorate('systemUserManager', {
    isImplemented: () => opts.systemUsers !== false,
    retrieveSystemUserByExternalId: async (_ctx: any, externalId: string) =>
      [ROOT, AUDITOR].find((u) => u.externalId === externalId) ?? null
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
    req.data = () => ({})
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
