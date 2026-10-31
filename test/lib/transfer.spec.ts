/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The resumable upload endpoint and who may reach it.
//
// The route is mounted outside the router, so it carries no `requiredRoles` of a declared route,
// and the role gate lets a route without them through for anyone. These tests go through
// `server.inject` with the real hook and the real mounting: an anonymous request must be refused
// unless the manager's `isValid` vouches for it, and an authenticated one must be served without
// asking.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import authHook from '../../lib/hooks/onRequest.js'
import { apply as applyTenancy } from '../../lib/loader/tenant.js'
import { mountTransfer } from '../../lib/loader/transfer.js'
import { INTEGRATION_TYP } from '../../lib/util/credential.js'

const SECRET = 'transfer-route-test-secret-32-chars'
const USER = { id: 'u1', externalId: 'u-ext-1', email: 'anna@acme.test', roles: ['admin'], blocked: false }

const bag = globalThis as any
bag.log = {}

function fakeTransfer(over: { implemented?: boolean; path?: () => string; valid?: (req: any) => any } = {}) {
  const calls = { handle: 0, isValid: 0 }
  const manager = {
    isImplemented: () => over.implemented !== false,
    getPath: over.path ?? (() => '/files'),
    getServer: () => null,
    onUploadCreate: () => {},
    onUploadFinish: () => {},
    onUploadTerminate: () => {},
    isValid: async (req: any) => {
      calls.isValid++
      return over.valid ? over.valid(req) : false
    },
    handle: async (_req: any, res: any) => {
      calls.handle++
      res.writeHead(201, { 'content-type': 'text/plain' })
      res.end('stored')
    }
  }
  return { manager, calls }
}

async function build(transfer: any) {
  const server: any = fastify()
  server.decorate('provider', {})
  server.decorate('userManager', {
    isImplemented: () => true,
    isValidUser: async () => true,
    retrieveUserByExternalId: async (_ctx: any, id: string) => (id === USER.externalId ? USER : null)
  })
  server.decorate('tokenManager', { isImplemented: () => false })
  server.decorate('systemUserManager', { isImplemented: () => false })
  server.decorate('impersonationManager', { isImplemented: () => false })
  server.decorate('transferManager', transfer)
  await server.register(jwtValidator, { secret: SECRET })
  server.addHook('onRequest', async (req: any) => {
    req.data = () => ({})
    req.parameters = () => ({})
    req.control = { kind: 'control' }
  })
  server.addHook('onRequest', authHook)
  await mountTransfer(server)
  await server.ready()
  return server
}

const upload = (server: any, url = '/files', token?: string) =>
  server.inject({
    method: 'POST',
    url,
    headers: { 'tus-resumable': '1.0.0', 'upload-length': '5', ...(token ? { authorization: `Bearer ${token}` } : {}) }
  })

const codeOf = (res: any) => {
  try {
    return JSON.parse(res.body)?.code ?? 'NO_CODE'
  } catch {
    return 'NO_BODY'
  }
}

describe('loader/transfer · who reaches the upload endpoint', () => {
  let saved: any

  before(() => {
    saved = { roles: bag.roles, config: bag.config, transferPath: bag.transferPath, mode: process.env.AUTH_MODE }
    bag.roles = { public: { code: 'public', name: 'Public' }, admin: { code: 'admin', name: 'Admin' } }
    bag.config = { options: { tenants: null } }
    process.env.AUTH_MODE = 'BEARER'
  })

  after(() => {
    bag.roles = saved.roles
    bag.config = saved.config
    bag.transferPath = saved.transferPath
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
  })

  it('refuses an anonymous request with 401 when isValid does not vouch for it', async () => {
    const { manager, calls } = fakeTransfer()
    const server = await build(manager)
    for (const url of ['/files', '/files/some-upload-id']) {
      const res = await upload(server, url)
      expect(res.statusCode).toBe(401)
      expect(codeOf(res)).toBe('UNAUTHORIZED')
    }
    expect(calls.handle).toBe(0)
    expect(calls.isValid).toBe(2)
    await server.close()
  })

  it('serves an anonymous request that isValid vouches for', async () => {
    const { manager, calls } = fakeTransfer({ valid: (req) => req.headers['x-upload-signature'] === 'signed' })
    const server = await build(manager)
    const res = await server.inject({
      method: 'POST',
      url: '/files',
      headers: { 'tus-resumable': '1.0.0', 'upload-length': '5', 'x-upload-signature': 'signed' }
    })
    expect(res.statusCode).toBe(201)
    expect(calls.handle).toBe(1)
    await server.close()
  })

  it('accepts only a literal true from isValid', async () => {
    const { manager, calls } = fakeTransfer({ valid: () => 'yes' })
    const server = await build(manager)
    const res = await upload(server)
    expect(res.statusCode).toBe(401)
    expect(calls.handle).toBe(0)
    await server.close()
  })

  it('does not serve the request when isValid throws', async () => {
    const { manager, calls } = fakeTransfer({
      valid: () => {
        throw new Error('signature store unreachable')
      }
    })
    const server = await build(manager)
    const res = await upload(server)
    expect(res.statusCode).toBe(500)
    expect(calls.handle).toBe(0)
    await server.close()
  })

  it('serves an authenticated request without asking isValid', async () => {
    const { manager, calls } = fakeTransfer()
    const server = await build(manager)
    const res = await upload(server, '/files', server.jwt.sign({ sub: USER.externalId }))
    expect(res.statusCode).toBe(201)
    expect(calls.handle).toBe(1)
    expect(calls.isValid).toBe(0)
    await server.close()
  })

  it('treats a credential that does not verify as no credential, and refuses', async () => {
    const { manager, calls } = fakeTransfer()
    const server = await build(manager)
    const res = await upload(server, '/files', 'not-a-jwt-at-all')
    expect(res.statusCode).toBe(401)
    expect(calls.handle).toBe(0)
    await server.close()
  })

  it('mounts nothing when the manager is not implemented', async () => {
    const { manager, calls } = fakeTransfer({ implemented: false })
    const server = await build(manager)
    expect(bag.transferPath).toBe(null)
    const res = await upload(server)
    expect(res.statusCode).toBe(404)
    expect(calls.handle).toBe(0)
    await server.close()
  })

  it('mounts nothing when getPath throws', async () => {
    const { manager } = fakeTransfer({
      path: () => {
        throw new Error('no path configured')
      }
    })
    const server = await build(manager)
    expect(bag.transferPath).toBe(null)
    expect((await upload(server)).statusCode).toBe(404)
    await server.close()
  })
})

describe('loader/transfer · with tenants, the upload is a tenant route', () => {
  const ACME = { id: 'id-acme', slug: 'acme', status: 'active', locator: 'tenant_acme' }
  const TENANTS = { strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: 'x-tenant-id' }
  let saved: any

  before(() => {
    saved = { roles: bag.roles, config: bag.config, transferPath: bag.transferPath, mode: process.env.AUTH_MODE }
    bag.roles = { public: { code: 'public', name: 'Public' }, sentinel: { code: 'sentinel', name: 'Sentinel' } }
    bag.config = { options: { tenants: TENANTS } }
    process.env.AUTH_MODE = 'BEARER'
  })

  after(() => {
    bag.roles = saved.roles
    bag.config = saved.config
    bag.transferPath = saved.transferPath
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
  })

  /** The real resolution, authentication and mounting; a machine's integration token lives in acme's container only. */
  async function buildWithTenants(transfer: any) {
    const lookedUpIn: string[] = []
    const server: any = fastify()
    await server.register(jwtValidator, { secret: SECRET })
    server.decorate('provider', {
      control: () => ({ kind: 'control' }),
      tenant: async (row: any) => ({ kind: 'tenant', tenantId: row.id }),
      releaseRequestScope: async () => {},
      shutdown: async () => {}
    })
    server.decorate('tenantManager', {
      isImplemented: () => true,
      getTenantBySlug: async (_ctx: any, slug: string) => (slug === ACME.slug ? ACME : null),
      getTenant: async (_ctx: any, id: string) => (id === ACME.id ? ACME : null)
    })
    server.decorate('tokenManager', {
      isImplemented: () => true,
      retrieveTokenByExternalId: async (ctx: any, id: string) => {
        lookedUpIn.push(ctx?.tenantId ?? ctx?.kind)
        return ctx?.tenantId === ACME.id && id === 'machine-1' ? { id: 't1', externalId: id, roles: ['sentinel'] } : null
      },
      isValidToken: async () => true
    })
    server.decorate('userManager', { isImplemented: () => true, retrieveUserByExternalId: async () => null })
    server.decorate('systemUserManager', { isImplemented: () => false })
    server.decorate('impersonationManager', { isImplemented: () => false })
    server.decorate('transferManager', transfer)
    await applyTenancy(server)
    server.addHook('onRequest', authHook)
    await mountTransfer(server)
    await server.ready()
    return { server, lookedUpIn }
  }

  it("serves a machine's integration token, found in the container of the tenant it names", async () => {
    const { manager, calls } = fakeTransfer()
    const { server, lookedUpIn } = await buildWithTenants(manager)
    const res = await upload(server, '/files', server.jwt.sign({ sub: 'machine-1', tid: ACME.id, typ: INTEGRATION_TYP }))
    expect([res.statusCode, calls.handle, calls.isValid]).toEqual([201, 1, 0])
    expect(lookedUpIn).toEqual([ACME.id])
    await server.close()
  })

  it('refuses an anonymous request that names no tenant before asking isValid', async () => {
    const { manager, calls } = fakeTransfer({ valid: () => true })
    const { server } = await buildWithTenants(manager)
    const res = await upload(server)
    expect([res.statusCode, codeOf(res), calls.handle, calls.isValid]).toEqual([400, 'TENANT_REQUIRED', 0, 0])
    await server.close()
  })
})
