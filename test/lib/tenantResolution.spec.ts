/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-3.2: the tenant is bound to the token, not to a header.
//
// The defect this replaces (D-03) was not a missing check, it was a check that could never
// run: the tenant hook chose the container before the authentication hook existed, and the
// comparison it made was against a field the user entity did not have. So the tests below
// do not ask "is there a check", they ask what the framework ANSWERS when the two sources
// disagree, which is the only form of the question an attacker can pose.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import { apply } from '../../lib/loader/tenant.js'
import { declaredTenant } from '../../lib/util/tenantResolution.js'

;(global as any).log = {}

const SECRET = 'tenant-resolution-test-secret-32ch'

const REGISTRY: Record<string, any> = {
  acme: { id: 'id-acme', slug: 'acme', status: 'active', locator: 'tenant_acme' },
  globex: { id: 'id-globex', slug: 'globex', status: 'active', locator: 'tenant_globex' },
  dormant: { id: 'id-dormant', slug: 'dormant', status: 'suspended', locator: 'tenant_dormant' }
}

function fakeProvider() {
  const opened: string[] = []
  return {
    opened,
    control: () => ({ kind: 'control' }) as any,
    tenant: async (tenantId: string) => {
      opened.push(tenantId)
      return { kind: 'tenant', tenantId } as any
    },
    releaseRequestScope: async () => {},
    shutdown: async () => {}
  }
}

const fakeRegistry = () => ({
  isImplemented: () => true,
  getTenantBySlug: async (_ctx: any, slug: string) => REGISTRY[slug] ?? null,
  getTenant: async (_ctx: any, id: string) => Object.values(REGISTRY).find((t) => t.id === id) ?? null
})

async function serverWith(tenants: any) {
  ;(global as any).config = { options: { tenants } }
  const provider = fakeProvider()
  const server: any = fastify()
  await server.register(jwtValidator, { secret: SECRET })
  server.decorate('provider', provider)
  server.decorate('tenantManager', fakeRegistry())
  // What the router builds from the authenticators: the return route reads its `state` under the
  // parameter name the method declares (T-12.17), `state` for a method that declares none.
  server.decorate('authRegistry', {
    get: (_plane: string, id: string) =>
      id === 'fake-saml' ? { id, stateParam: 'RelayState' } : id === 'oidc' ? { id } : undefined
  })
  await apply(server)

  // The two shapes the router produces, and one it never produces.
  server.get('/data', { config: { tenantContext: true } }, async (req: any) => ({
    tenant: req.tenantInfo?.slug ?? null,
    opened: (req.tenant as any)?.tenantId ?? null
  }))
  server.get('/platform', { config: { tenantContext: false } }, async (req: any) => ({
    tenant: req.tenantInfo?.slug ?? null
  }))
  server.get('/docs', async (req: any) => ({ tenant: req.tenantInfo?.slug ?? null }))
  server.get(
    '/auth/flow/return/:method',
    { config: { tenantContext: true, tenantFrom: 'flow-state' } },
    async (req: any) => ({ tenant: req.tenantInfo?.slug ?? null, opened: (req.tenant as any)?.tenantId ?? null })
  )

  return { server, provider }
}

const HEADER = 'x-tenant-id'
const tokenFor = (server: any, payload: any) => server.jwt.sign(payload)
const body = (res: any) => JSON.parse(res.body)

describe('loader/tenant · resolving which tenant (T-3.2)', () => {
  afterEach(() => {
    ;(global as any).config = undefined
  })

  describe('with a token, the token decides', () => {
    it('opens the container the token names, with no header at all', async () => {
      const { server } = await serverWith({ strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER })
      const res = await server.inject({
        method: 'GET',
        url: '/data',
        headers: { authorization: `Bearer ${tokenFor(server, { sub: 'u1', tid: 'id-acme' })}` }
      })
      expect(res.statusCode).toBe(200)
      expect(body(res)).toEqual({ tenant: 'acme', opened: 'id-acme' })
      await server.close()
    })

    it('refuses when the header names another tenant, instead of picking one', async () => {
      const { server, provider } = await serverWith({
        strategy: 'schema',
        engine: 'postgres',
        resolver: 'header',
        headerKey: HEADER
      })
      const res = await server.inject({
        method: 'GET',
        url: '/data',
        headers: { authorization: `Bearer ${tokenFor(server, { sub: 'u1', tid: 'id-acme' })}`, [HEADER]: 'globex' }
      })
      expect(res.statusCode).toBe(403)
      expect(body(res).code).toBe('TENANT_MISMATCH')
      // Neither tenant was opened: a refused request touches no container.
      expect(provider.opened).toEqual([])
      await server.close()
    })

    it('answers a mismatch the same way whether the named tenant exists or not', async () => {
      const { server } = await serverWith({ strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER })
      const token = tokenFor(server, { sub: 'u1', tid: 'id-acme' })

      const existing = await server.inject({ method: 'GET', url: '/data', headers: { authorization: `Bearer ${token}`, [HEADER]: 'globex' } })
      const invented = await server.inject({ method: 'GET', url: '/data', headers: { authorization: `Bearer ${token}`, [HEADER]: 'nowhere' } })

      // Same status and same code: probing the registry through this door learns nothing.
      expect(existing.statusCode).toBe(invented.statusCode)
      expect(body(existing).code).toBe(body(invented).code)
      await server.close()
    })

    it('accepts a header that agrees with the token', async () => {
      const { server } = await serverWith({ strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER })
      const res = await server.inject({
        method: 'GET',
        url: '/data',
        headers: { authorization: `Bearer ${tokenFor(server, { sub: 'u1', tid: 'id-acme' })}`, [HEADER]: 'acme' }
      })
      expect(res.statusCode).toBe(200)
      expect(body(res).tenant).toBe('acme')
      await server.close()
    })

    it('refuses a control token inside a tenant', async () => {
      const { server } = await serverWith({ strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER })
      const res = await server.inject({
        method: 'GET',
        url: '/data',
        headers: { authorization: `Bearer ${tokenFor(server, { sub: 's1', scp: 'control' })}`, [HEADER]: 'acme' }
      })
      expect(res.statusCode).toBe(403)
      expect(body(res).code).toBe('SCOPE_MISMATCH')
      await server.close()
    })

    it('treats a token that does not verify as no token at all', async () => {
      const { server } = await serverWith({ strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER })
      const res = await server.inject({
        method: 'GET',
        url: '/data',
        headers: { authorization: 'Bearer not.a.token', [HEADER]: 'acme' }
      })
      // Resolution does not judge credentials: the authentication hook does, right after.
      expect(res.statusCode).toBe(200)
      expect(body(res).tenant).toBe('acme')
      await server.close()
    })
  })

  describe('without a token, the configured resolver decides', () => {
    it('resolves a login from the header', async () => {
      const { server } = await serverWith({ strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER })
      const res = await server.inject({ method: 'GET', url: '/data', headers: { [HEADER]: 'acme' } })
      expect(res.statusCode).toBe(200)
      expect(body(res)).toEqual({ tenant: 'acme', opened: 'id-acme' })
      await server.close()
    })

    it('refuses a request that declares no tenant', async () => {
      const { server } = await serverWith({ strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER })
      const res = await server.inject({ method: 'GET', url: '/data' })
      expect(res.statusCode).toBe(400)
      expect(body(res).code).toBe('TENANT_REQUIRED')
      await server.close()
    })

    it('answers 404 for an unknown tenant and for a suspended one alike', async () => {
      const { server } = await serverWith({ strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER })
      const unknown = await server.inject({ method: 'GET', url: '/data', headers: { [HEADER]: 'nowhere' } })
      const suspended = await server.inject({ method: 'GET', url: '/data', headers: { [HEADER]: 'dormant' } })
      expect(unknown.statusCode).toBe(404)
      expect(suspended.statusCode).toBe(404)
      // Byte for byte the same, code included: anything that differs — a status, a code, a
      // message, a timing — turns the registry into something probable from outside.
      expect(body(unknown)).toEqual(body(suspended))
      expect(body(unknown).code).toBe('TENANT_NOT_FOUND')
      await server.close()
    })

    it('reads the subdomain and IGNORES the header when that is the configured source', async () => {
      const { server } = await serverWith({
        strategy: 'schema',
        engine: 'postgres',
        resolver: 'subdomain',
        subdomainLevel: 1,
        headerKey: HEADER
      })
      const res = await server.inject({
        method: 'GET',
        url: '/data',
        headers: { host: 'acme.example.com', [HEADER]: 'globex' }
      })
      // Not "the header loses": the header is not consulted. Two concurrent sources for one
      // decision is the shape D-03 had.
      expect(res.statusCode).toBe(200)
      expect(body(res).tenant).toBe('acme')
      await server.close()
    })
  })

  describe('what is left alone', () => {
    it('does not resolve a tenant for a control-scope route', async () => {
      const { server, provider } = await serverWith({ strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER })
      const res = await server.inject({ method: 'GET', url: '/platform' })
      expect(res.statusCode).toBe(200)
      expect(body(res).tenant).toBe(null)
      expect(provider.opened).toEqual([])
      await server.close()
    })

    it('does not touch a route the framework router did not register', async () => {
      const { server } = await serverWith({ strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER })
      // Swagger, static mounts and 404s never reach the data layer: refusing them would be
      // answering a question nobody asked.
      const res = await server.inject({ method: 'GET', url: '/docs' })
      expect(res.statusCode).toBe(200)
      expect(body(res).tenant).toBe(null)
      await server.close()
    })

    it('leaves a single-tenant deployment without any of this', async () => {
      const { server, provider } = await serverWith(null)
      const res = await server.inject({ method: 'GET', url: '/data' })
      expect(res.statusCode).toBe(200)
      expect(body(res)).toEqual({ tenant: null, opened: null })
      expect(provider.opened).toEqual([])
      await server.close()
    })
  })
})

describe('loader/tenant · a return from a provider, resolved from the flow state (T-12.17)', () => {
  const HEADERS = { strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER }
  const SUBDOMAIN = { strategy: 'schema', engine: 'postgres', resolver: 'subdomain' }
  const returnTo = (server: any, method: string, query: string, headers: any = {}) =>
    server.inject({ method: 'GET', url: `/auth/flow/return/${method}?${query}`, headers })

  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('opens the container the state routes to, with no token and no header', async () => {
    const { server, provider } = await serverWith(HEADERS)
    const res = await returnTo(server, 'fake-saml', 'RelayState=st1.id-acme.abcdefgh')
    expect(res.statusCode).toBe(200)
    expect(body(res)).toEqual({ tenant: 'acme', opened: 'id-acme' })
    expect(provider.opened).toEqual(['id-acme'])
    await server.close()
  })

  it('reads the parameter the method declares, and `state` for a method that declares none', async () => {
    const { server } = await serverWith(HEADERS)
    // The name SAML gives it is not the name OIDC gives it, and neither is a second rule.
    expect((await returnTo(server, 'fake-saml', 'state=st1.id-acme.abcdefgh')).statusCode).toBe(400)
    expect(body(await returnTo(server, 'oidc', 'state=st1.id-acme.abcdefgh')).tenant).toBe('acme')
    await server.close()
  })

  it('refuses a return that carries no usable state, before anything is opened', async () => {
    const { server, provider } = await serverWith(HEADERS)
    for (const query of ['', 'state=', 'state=nonsense', 'state=vf1.id-acme.flow.secret']) {
      const res = await returnTo(server, 'oidc', query)
      expect(res.statusCode).toBe(400)
      expect(body(res).code).toBe('FLOW_REQUIRED')
    }
    expect(provider.opened).toEqual([])
    await server.close()
  })

  it('answers 404 for a routing that names no tenant, and for one that is suspended', async () => {
    const { server } = await serverWith(HEADERS)
    for (const routing of ['id-nowhere', 'id-dormant']) {
      const res = await returnTo(server, 'oidc', `state=st1.${routing}.abcdefgh`)
      expect(res.statusCode).toBe(404)
      expect(body(res).code).toBe('TENANT_NOT_FOUND')
    }
    await server.close()
  })

  it('refuses a state that names one tenant while the request names another', async () => {
    const { server, provider } = await serverWith(HEADERS)
    const byHeader = await returnTo(server, 'oidc', 'state=st1.id-acme.abcdefgh', { [HEADER]: 'globex' })
    expect(byHeader.statusCode).toBe(403)
    expect(body(byHeader).code).toBe('TENANT_MISMATCH')

    const byToken = await returnTo(server, 'oidc', 'state=st1.id-acme.abcdefgh', {
      authorization: `Bearer ${tokenFor(server, { sub: 'u1', tid: 'id-globex' })}`
    })
    expect(byToken.statusCode).toBe(403)
    expect(body(byToken).code).toBe('TENANT_MISMATCH')
    expect(provider.opened).toEqual([])
    await server.close()
  })

  it('does the same with the subdomain resolver, which is where a browser return actually arrives', async () => {
    const { server } = await serverWith(SUBDOMAIN)
    expect(body(await returnTo(server, 'oidc', 'state=st1.id-acme.abcdefgh', { host: 'acme.example.com' })).tenant).toBe('acme')
    const other = await returnTo(server, 'oidc', 'state=st1.id-acme.abcdefgh', { host: 'globex.example.com' })
    expect(other.statusCode).toBe(403)
    expect(body(other).code).toBe('TENANT_MISMATCH')
    await server.close()
  })
})

describe('util/tenantResolution · the declared tenant', () => {
  const req = (headers: any) => ({ headers }) as any

  it('reads the configured header, case-insensitively, and lowercases the value', () => {
    const cfg: any = { resolver: 'header', headerKey: 'X-Tenant-Id' }
    expect(declaredTenant(req({ 'x-tenant-id': ' ACME ' }), cfg)).toBe('acme')
  })

  it('rejects a value that is not a slug', () => {
    const cfg: any = { resolver: 'header', headerKey: 'x-tenant-id' }
    expect(declaredTenant(req({ 'x-tenant-id': 'acme"; drop schema' }), cfg)).toBe(undefined)
    expect(declaredTenant(req({ 'x-tenant-id': '../public' }), cfg)).toBe(undefined)
    expect(declaredTenant(req({ 'x-tenant-id': 'x'.repeat(101) }), cfg)).toBe(undefined)
    expect(declaredTenant(req({ 'x-tenant-id': '' }), cfg)).toBe(undefined)
  })

  it('takes the label the level names, and nothing when the host has too few', () => {
    const level = (n: number): any => ({ resolver: 'subdomain', subdomainLevel: n })
    expect(declaredTenant(req({ host: 'acme.example.com:3000' }), level(1))).toBe('acme')
    expect(declaredTenant(req({ host: 'eu.acme.example.com' }), level(2))).toBe('acme')
    // Nothing follows the label, so nothing is a subdomain: an apex host, a bare hostname
    // and a development machine all name no tenant rather than naming a wrong one.
    expect(declaredTenant(req({ host: 'example.com' }), level(1))).toBe(undefined)
    expect(declaredTenant(req({ host: 'acme.localhost' }), level(1))).toBe(undefined)
    expect(declaredTenant(req({ host: 'localhost:2230' }), level(1))).toBe(undefined)
  })

  it('never reads the query string', () => {
    const cfg: any = { resolver: 'query', headerKey: 'x-tenant-id' }
    // `query` is not a resolver in v5 (decision 9): an unknown value falls back to the
    // header, it does not open a third door.
    expect(declaredTenant(req({ 'x-tenant-id': 'acme' }), cfg)).toBe('acme')
  })
})
