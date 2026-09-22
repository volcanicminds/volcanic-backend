/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.25 and T-12.26: identity providers declared by the deployment and written per tenant.
//
// What the tests hold to: one set of shape rules for both sources, checked where the provider is
// written and without calling it; a deployment secret read at boot and kept out of every global;
// and a tenant's client secret that no response carries, even when the manager behind the route
// hands it back by mistake.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import cookie from '@fastify/cookie'
import authHook from '../../lib/hooks/onRequest.js'
import { processRoute } from '../../lib/loader/router.js'
import { loadSystem } from '../../lib/loader/roles.js'
import { resolveAuthFlows } from '../../lib/loader/authFlows.js'
import frameworkFlows from '../../lib/config/authFlows.js'
import { authFlowProblems } from '../../lib/auth/validate.js'
import { buildAuthenticatorRegistry } from '../../lib/auth/registry.js'
import { captureDeploymentSecrets, providerShapeProblems, resolveProvider } from '../../lib/auth/providers.js'
import * as tenantSchemas from '../../lib/schemas/tenant.js'
import { globalParamsSchema } from '../../lib/schemas/global.js'
import { defaultResponse } from '../../lib/schemas/common.js'
import * as identityProviders from '../../lib/api/tenants/controller/identityProviders.js'

const bag = globalThis as any
bag.log = {}

const SECRET = 'identity-providers-test-secret-32ch'
const CLIENT_SECRET = 's3cr3t-value-never-in-a-response'
const ACME = { id: 'id-acme', slug: 'acme', status: 'active' }

const GOOD = {
  issuer: 'https://login.microsoftonline.com/acme/v2.0',
  clientId: 'client-acme',
  redirectUri: 'https://api.example.com/auth/flow/return/oidc'
}

describe('auth · the shape of a provider (T-12.25, T-12.26)', () => {
  let savedRoles: unknown
  before(() => {
    savedRoles = bag.roles
    bag.roles = { public: { code: 'public' }, admin: { code: 'admin' } }
  })
  after(() => (bag.roles = savedRoles))

  it('accepts a complete provider', () => {
    expect(providerShapeProblems({ ...GOOD, scopes: ['openid', 'email'], linkByEmail: true, emailDomains: ['acme.test'] }, { plane: 'tenant' })).toEqual([])
  })

  it('refuses an issuer that is not https and a redirect that is not absolute', () => {
    const problems = providerShapeProblems({ ...GOOD, issuer: 'http://idp.acme.test', redirectUri: '/auth/flow/return/oidc' }, { plane: 'tenant' })
    expect(problems).toEqual(['issuer must be an https URL', 'redirectUri must be an absolute http(s) URL'])
  })

  it('refuses a secret, or any unknown key, inside the settings', () => {
    expect(providerShapeProblems({ ...GOOD, clientSecret: 'x' }, { plane: 'tenant' })[0]).toMatch(/^unknown settings clientSecret/)
  })

  it('refuses linking by email without domains, and JIT that grants admin or runs on the platform', () => {
    expect(providerShapeProblems({ ...GOOD, linkByEmail: true }, { plane: 'tenant' })).toEqual([
      'linkByEmail needs emailDomains: the domains whose addresses may be linked'
    ])
    expect(providerShapeProblems({ ...GOOD, jit: { enabled: true, roles: ['admin'] } }, { plane: 'tenant' })).toEqual([
      'jit.roles cannot include the admin role'
    ])
    expect(providerShapeProblems({ ...GOOD, jit: { enabled: true, roles: [] } }, { plane: 'control' })).toEqual([
      'jit is not available on the control plane'
    ])
    expect(providerShapeProblems({ ...GOOD, mfa: { trust: 'everything', values: [] } }, { plane: 'tenant' })).toHaveLength(1)
  })
})

describe('auth · deployment providers (T-12.25)', () => {
  const ENV = 'IDP_TEST_CLIENT_SECRET'
  let saved: any
  before(() => {
    saved = { roles: bag.roles, env: process.env[ENV] }
    bag.roles = { public: { code: 'public' }, admin: { code: 'admin' } }
  })
  after(() => {
    bag.roles = saved.roles
    if (saved.env === undefined) delete process.env[ENV]
    else process.env[ENV] = saved.env
  })

  const flowsWith = (provider: Record<string, unknown>) =>
    resolveAuthFlows(frameworkFlows, {
      tenant: { identify: ['password'], flows: [{ roles: ['*'], stages: [] }], providers: { entra: { type: 'oidc', clientSecretEnv: ENV, ...provider } as any } }
    })
  const problems = (flows: any, env: Record<string, string | undefined>) =>
    authFlowProblems({
      flows,
      registry: buildAuthenticatorRegistry(),
      roles: { tenant: ['public', 'admin'], control: ['system:admin'] },
      implemented: { mfa: true, challengeDelivery: true, authFlow: true },
      policies: { floor: 'OPTIONAL' as never, control: 'OPTIONAL' as never },
      oidcLibrary: true,
      env
    })

  it('refuses the boot on an empty secret variable, and on a provider of the wrong shape', () => {
    expect(problems(flowsWith(GOOD), { [ENV]: '  ' })).toEqual([
      `authFlows.tenant: provider 'entra' reads its client secret from ${ENV}, which is empty: set that variable`
    ])
    const wrong = problems(flowsWith({ ...GOOD, issuer: 'http://idp.acme.test' }), { [ENV]: CLIENT_SECRET })
    expect(wrong).toEqual(["authFlows.tenant: provider 'entra': issuer must be an https URL"])
    // The name of the variable is printed, the value never.
    expect(wrong.join('\n')).not.toContain(CLIENT_SECRET)
  })

  it('reads the secret once at boot, and keeps it out of the flows every part of the process can read', async () => {
    const flows = flowsWith(GOOD)
    expect(captureDeploymentSecrets(flows, { [ENV]: CLIENT_SECRET })).toBe(1)
    expect(JSON.stringify(flows)).not.toContain(CLIENT_SECRET)

    const resolved = await resolveProvider({ plane: 'tenant', key: 'entra', flows, tenantId: null, control: null })
    expect(resolved).toEqual({ key: 'entra', type: 'oidc', source: 'deployment', settings: GOOD, clientSecret: CLIENT_SECRET })
    // Unknown on the other plane, and an unsafe key is not even looked up.
    expect(await resolveProvider({ plane: 'control', key: 'entra', flows, tenantId: null, control: null })).toBeNull()
    expect(await resolveProvider({ plane: 'tenant', key: '../entra', flows, tenantId: null, control: null })).toBeNull()
  })

  it("prefers a tenant's own active provider, and a disabled one hides the deployment's", async () => {
    const flows = flowsWith(GOOD)
    captureDeploymentSecrets(flows, { [ENV]: CLIENT_SECRET })
    const rows: Record<string, any> = {
      'id-acme': { type: 'oidc', status: 'active', config: { ...GOOD, clientId: 'own' }, clientSecret: 'own-secret' },
      'id-beta': { type: 'oidc', status: 'disabled', config: GOOD, clientSecret: null }
    }
    const identityProviders: any = { isImplemented: () => true, get: async (_c: any, tenantId: string) => rows[tenantId] ?? null }
    const control: any = { kind: 'control' }
    const at = (tenantId: string) => resolveProvider({ plane: 'tenant', key: 'entra', flows, tenantId, control, identityProviders })

    expect(await at('id-acme')).toMatchObject({ source: 'tenant', settings: { clientId: 'own' }, clientSecret: 'own-secret' })
    expect(await at('id-beta')).toBeNull()
    expect(await at('id-gamma')).toMatchObject({ source: 'deployment', clientSecret: CLIENT_SECRET })
  })
})

describe('tenants · identity provider routes (T-12.26)', () => {
  let saved: any
  before(async () => {
    saved = { config: bag.config, roles: bag.roles, systemRoles: bag.systemRoles, mode: process.env.AUTH_MODE }
    bag.config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
    bag.roles = { public: { code: 'public' }, admin: { code: 'admin' } }
    bag.systemRoles = await loadSystem()
    process.env.AUTH_MODE = 'BEARER'
  })
  after(() => {
    bag.config = saved.config
    bag.roles = saved.roles
    bag.systemRoles = saved.systemRoles
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
  })

  async function build(options: { providers?: any } = {}) {
    const stored = new Map<string, any>()
    const leak = (row: any) => ({ ...row, clientSecret: row.clientSecret, secretEnc: `enc(${row.clientSecret})` })
    const manager = options.providers ?? {
      isImplemented: () => true,
      // Every method hands the secret back, on purpose: what must stop it is the route.
      list: async (_c: any, tenantId: string) => [...stored.values()].filter((r) => r.tenantId === tenantId).map(leak),
      get: async (_c: any, tenantId: string, key: string) => {
        const row = stored.get(`${tenantId}:${key}`)
        return row ? leak(row) : null
      },
      create: async (_c: any, data: any) => {
        const given = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
        const row = { id: `idp-${stored.size + 1}`, status: 'active', createdAt: new Date(), updatedAt: new Date(), ...given }
        stored.set(`${data.tenantId}:${data.key}`, row)
        return leak(row)
      },
      update: async (_c: any, tenantId: string, key: string, patch: any) => {
        const row = stored.get(`${tenantId}:${key}`)
        if (!row) return null
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[k] = v
        return leak(row)
      },
      remove: async (_c: any, tenantId: string, key: string) => stored.delete(`${tenantId}:${key}`)
    }
    const operators: any[] = [
      { id: 's1', externalId: 'x-ops', roles: ['system:operator'], blocked: false },
      { id: 's2', externalId: 'x-audit', roles: ['system:auditor'], blocked: false }
    ]

    const server: any = fastify()
    await server.register(cookie, { secret: 'identity-providers-cookie-secret-32' })
    await server.register(jwtValidator, { secret: SECRET, sign: { expiresIn: '1h' } })
    for (const schema of [...Object.values(tenantSchemas), globalParamsSchema, defaultResponse] as any[]) server.addSchema(schema)
    server.decorate('userManager', { isImplemented: () => false })
    server.decorate('tokenManager', { isImplemented: () => false })
    server.decorate('systemUserManager', {
      isImplemented: () => true,
      retrieveSystemUserByExternalId: async (_c: any, ext: string) => operators.find((o) => o.externalId === ext) ?? null
    })
    server.decorate('tenantManager', {
      isImplemented: () => true,
      getTenant: async (_c: any, id: string) => (id === ACME.id || id === ACME.slug ? ACME : null)
    })
    server.decorate('identityProviderManager', manager)
    server.addHook('onRequest', async (req: any) => {
      req.control = { kind: 'control' }
    })
    server.addHook('onRequest', authHook)

    const file = (await import(`../../lib/api/tenants/routes.js?fresh=${Date.now()}`)).default
    const errors: string[] = []
    file.routes.forEach((r: any, i: number) => {
      if (!r.path.includes('identity-providers')) return
      const configured: any = processRoute(r, i, 'tenants/routes.ts', 'tenants', '', file.config, ['global.isAuthenticated'], [], errors)
      server.route({
        method: r.method,
        url: '/tenants' + r.path,
        schema: { params: r.config.params, response: r.config.response, ...(r.config.body ? { body: r.config.body } : {}) },
        config: { tenantContext: false, requiredRoles: configured.roles },
        handler: (identityProviders as any)[r.handler.split('.')[1]]
      })
    })
    expect(errors).toEqual([])
    await server.ready()
    const as = (sub: string) => ({ authorization: `Bearer ${server.jwt.sign({ sub, scp: 'control' })}` })
    return { server, stored, as }
  }

  const body = { key: 'entra', type: 'oidc', config: GOOD, clientSecret: CLIENT_SECRET }

  it('never answers the client secret, from any route, the list included', async () => {
    const { server, stored, as } = await build()
    const responses: any[] = []
    const call = async (method: string, url: string, payload?: any) => {
      const res = await server.inject({ method, url, payload, headers: as('x-ops') })
      responses.push(res)
      return res
    }

    const created = await call('POST', '/tenants/id-acme/identity-providers', body)
    expect(created.statusCode).toBe(201)
    expect(JSON.parse(created.body)).toMatchObject({ key: 'entra', type: 'oidc', status: 'active', hasClientSecret: true, config: GOOD })
    expect(stored.get('id-acme:entra').clientSecret).toBe(CLIENT_SECRET)

    expect((await call('GET', '/tenants/id-acme/identity-providers')).statusCode).toBe(200)
    const one = await call('GET', '/tenants/acme/identity-providers/entra')
    expect(JSON.parse(one.body).hasClientSecret).toBe(true)
    expect((await call('PUT', '/tenants/id-acme/identity-providers/entra', { status: 'disabled', clientSecret: 'rotated-secret' })).statusCode).toBe(200)

    for (const res of responses) {
      expect(res.body).not.toContain(CLIENT_SECRET)
      expect(res.body).not.toContain('rotated-secret')
      expect(res.body).not.toContain('clientSecret')
      expect(res.body).not.toContain('secretEnc')
    }
    expect(JSON.parse(responses[1].body)).toHaveLength(1)
    await server.close()
  })

  it('refuses an operator without the tenants capability', async () => {
    const { server, as } = await build()
    for (const [method, url, payload] of [
      ['GET', '/tenants/id-acme/identity-providers'],
      ['POST', '/tenants/id-acme/identity-providers', body],
      ['GET', '/tenants/id-acme/identity-providers/entra'],
      ['PUT', '/tenants/id-acme/identity-providers/entra', { status: 'disabled' }],
      ['DELETE', '/tenants/id-acme/identity-providers/entra']
    ] as const) {
      expect((await server.inject({ method, url, payload, headers: as('x-audit') })).statusCode).toBe(403)
    }
    await server.close()
  })

  it('validates the shape on writing, refuses a taken key, and answers 404 for an unknown tenant or provider', async () => {
    const { server, as } = await build()
    const post = (url: string, payload: any) => server.inject({ method: 'POST', url, payload, headers: as('x-ops') })

    const insecure = await post('/tenants/id-acme/identity-providers', { ...body, config: { ...GOOD, issuer: 'http://idp' } })
    expect(insecure.statusCode).toBe(400)
    expect(JSON.parse(insecure.body).code).toBe('IDP_CONFIG_INVALID')
    const smuggled = await post('/tenants/id-acme/identity-providers', { ...body, config: { ...GOOD, clientSecret: CLIENT_SECRET } })
    expect(JSON.parse(smuggled.body).code).toBe('IDP_CONFIG_INVALID')
    expect(JSON.parse((await post('/tenants/id-acme/identity-providers', { ...body, key: 'Entra ID' })).body).code).toBe('IDP_CONFIG_INVALID')

    expect((await post('/tenants/id-acme/identity-providers', body)).statusCode).toBe(201)
    const again = await post('/tenants/id-acme/identity-providers', body)
    expect(again.statusCode).toBe(409)
    expect(JSON.parse(again.body).code).toBe('IDP_KEY_TAKEN')

    const bad = await server.inject({ method: 'PUT', url: '/tenants/id-acme/identity-providers/entra', payload: { config: { clientId: 'x' } }, headers: as('x-ops') })
    expect(JSON.parse(bad.body).code).toBe('IDP_CONFIG_INVALID')

    expect((await post('/tenants/nobody/identity-providers', body)).statusCode).toBe(404)
    expect((await server.inject({ method: 'GET', url: '/tenants/id-acme/identity-providers/other', headers: as('x-ops') })).statusCode).toBe(404)
    expect((await server.inject({ method: 'DELETE', url: '/tenants/id-acme/identity-providers/entra', headers: as('x-ops') })).statusCode).toBe(200)
    expect((await server.inject({ method: 'DELETE', url: '/tenants/id-acme/identity-providers/entra', headers: as('x-ops') })).statusCode).toBe(404)
    await server.close()
  })

  it('answers 503 in a build without identity providers', async () => {
    const { server, as } = await build({ providers: { isImplemented: () => false } })
    const res = await server.inject({ method: 'GET', url: '/tenants/id-acme/identity-providers', headers: as('x-ops') })
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).code).toBe('IDENTITY_PROVIDERS_NOT_AVAILABLE')
    await server.close()
  })
})
