/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.29 over HTTP: the options name the providers of this plane and tenant, the start answers a
// redirect, the browser's return answers 303 to the configured console with the path the client
// asked for and nothing else, and the session is born only at the next step.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import cookie from '@fastify/cookie'
import authHook from '../../lib/hooks/onRequest.js'
import tenantRoutes from '../../lib/api/auth/routes.js'
import * as tenantFlow from '../../lib/api/auth/controller/flow.js'
import * as authSchemas from '../../lib/schemas/auth.js'
import { defaultResponse } from '../../lib/schemas/common.js'
import frameworkFlows from '../../lib/config/authFlows.js'
import { resolveAuthFlows } from '../../lib/loader/authFlows.js'
import { buildAuthenticatorRegistry } from '../../lib/auth/registry.js'
import { captureDeploymentSecrets } from '../../lib/auth/providers.js'
import { useOidcFetch } from '../../lib/auth/authenticators/oidc.js'
import { fakeSessionStore } from './fixtures/sessionStore.js'
import { fakeFlowStore } from './fixtures/flowStore.js'
import { fakeIdp } from './fixtures/fakeIdp.js'

const bag = globalThis as any
bag.log = {}

const ACME = { id: 'id-acme', slug: 'acme', status: 'active' }
const CONSOLE = 'https://console.acme.test/login/return'
const REDIRECT = 'https://api.acme.test/auth/flow/return/oidc'

describe('auth · OIDC over the flow routes (T-12.29)', () => {
  const idp = fakeIdp()
  let saved: any

  before(() => {
    saved = { config: bag.config, roles: bag.roles, authFlows: bag.authFlows, mode: process.env.AUTH_MODE }
    bag.config = { options: { tenants: { strategy: 'schema', engine: 'postgres' }, accountCreation: { allowed: ['open'], default: 'open' } } }
    bag.roles = { public: { code: 'public' }, admin: { code: 'admin' } }
    const deployment = { type: 'oidc', issuer: idp.issuer, clientId: 'console', redirectUri: REDIRECT, clientSecretEnv: 'ACME_IDP_SECRET' }
    bag.authFlows = resolveAuthFlows(frameworkFlows, {
      tenant: {
        identify: ['password', 'oidc'],
        flows: [{ roles: ['*'], stages: [] }],
        returnUrl: CONSOLE,
        providers: { google: { ...deployment }, legacy: { ...deployment } }
      } as any
    })
    captureDeploymentSecrets(bag.authFlows, { ACME_IDP_SECRET: 'console-secret' } as any)
    process.env.AUTH_MODE = 'BEARER'
    useOidcFetch(idp.fetch as any)
  })
  after(() => {
    useOidcFetch(null)
    bag.config = saved.config
    bag.roles = saved.roles
    bag.authFlows = saved.authFlows
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
  })

  async function build() {
    const users: any[] = []
    const links: any[] = []
    const server: any = fastify()
    await server.register(cookie, { secret: 'oidc-routes-cookie-secret-32-chars' })
    await server.register(jwtValidator, { secret: 'oidc-routes-test-secret-32-chars-x', sign: { expiresIn: '1h' } })
    for (const schema of Object.values(authSchemas)) server.addSchema(schema)
    server.addSchema(defaultResponse)

    server.decorate('userManager', {
      isImplemented: () => true,
      isValidUser: async (u: any) => !!u?.email && !!u?.password,
      retrieveUserByEmail: async (_c: any, email: string) => users.find((u) => u.email === email) ?? null,
      retrieveUserByExternalId: async (_c: any, ext: string) => users.find((u) => u.externalId === ext) ?? null,
      createUser: async (_c: any, data: any) => {
        const user = { id: `u${users.length + 1}`, externalId: `x-${users.length + 1}`, blocked: false, approved: true, ...data }
        users.push(user)
        return user
      }
    })
    server.decorate('externalIdentityManager', {
      isImplemented: () => true,
      findLink: async (_c: any, k: any) => links.find((l) => l.provider === k.provider && l.issuer === k.issuer && l.subject === k.subject) ?? null,
      createLink: async (_c: any, data: any) => (links.push({ id: `l${links.length + 1}`, ...data }), links[links.length - 1]),
      touch: async () => true
    })
    // The tenant's own provider `acme-sso`, and a disabled `legacy` that hides the deployment's.
    server.decorate('identityProviderManager', {
      isImplemented: () => true,
      list: async () => [
        { key: 'acme-sso', type: 'oidc', status: 'active' },
        { key: 'legacy', type: 'oidc', status: 'disabled' }
      ],
      get: async (_c: any, _t: string, key: string) =>
        key === 'acme-sso'
          ? { key, type: 'oidc', status: 'active', config: { issuer: idp.issuer, clientId: 'acme', redirectUri: REDIRECT, jit: { enabled: true, roles: [] } }, clientSecret: 'acme-secret' }
          : key === 'legacy'
            ? { key, type: 'oidc', status: 'disabled', config: {}, clientSecret: null }
            : null
    })
    server.decorate('sessionManager', fakeSessionStore().manager)
    server.decorate('authFlowManager', fakeFlowStore().manager)
    server.decorate('accessLogManager', { isImplemented: () => false })
    server.decorate('settingManager', { isImplemented: () => false })
    server.decorate('tokenManager', { isImplemented: () => false })
    server.decorate('challengeDeliveryManager', { isImplemented: () => false })
    server.decorate('authRegistry', buildAuthenticatorRegistry())

    server.addHook('onRequest', async (req: any) => {
      req.control = { kind: 'control' }
      req.tenant = { kind: 'tenant', tenantId: ACME.id }
      req.tenantInfo = ACME
    })
    server.addHook('onRequest', authHook)
    for (const route of tenantRoutes.routes.filter((r: any) => r.path.includes('flow/'))) {
      const schema: any = {}
      if ((route.config as any)?.body) schema.body = (route.config as any).body
      if ((route.config as any)?.response) schema.response = (route.config as any).response
      server.route({
        method: route.method,
        url: '/auth' + route.path,
        schema,
        config: { tenantContext: true, requiredRoles: [{ code: 'public' }] },
        handler: (tenantFlow as any)[route.handler.split('.')[1]]
      })
    }
    await server.ready()
    return { server, users, links }
  }

  const json = (res: any) => JSON.parse(res.body)

  it("lists the tenant's active providers and the deployment's it does not hide", async () => {
    const { server } = await build()
    const res = await server.inject({ method: 'GET', url: '/auth/flow/options' })
    expect(json(res).options).toEqual([
      { id: 'password', kind: 'identifier' },
      { id: 'oidc', kind: 'identifier', providers: ['acme-sso', 'google'] }
    ])
    await server.close()
  })

  it('goes to the provider, comes back with a 303 to the console, and logs in at the next step', async () => {
    const { server, users } = await build()
    const started = await server.inject({
      method: 'POST',
      url: '/auth/flow/start',
      payload: { method: 'oidc', provider: 'acme-sso', returnTo: '/orders/42' }
    })
    expect(started.statusCode).toBe(202)
    const { flow, stage } = json(started)
    const action = stage.options[0].action
    expect(action.type).toBe('redirect')
    expect(new URL(action.url).searchParams.get('client_id')).toBe('acme')

    const { code, state } = idp.authorize(action.url, { sub: 'sub-anna', email: 'anna@acme.test', email_verified: true })
    const back = await server.inject({ method: 'GET', url: `/auth/flow/return/oidc?code=${code}&state=${encodeURIComponent(state)}` })
    expect(back.statusCode).toBe(303)
    expect(back.headers.location).toBe(`${CONSOLE}?returnTo=%2Forders%2F42`)
    // Nothing is issued by the return: no cookie, no token.
    expect(back.headers['set-cookie']).toBeUndefined()
    expect(back.body).not.toContain('token')

    const done = await server.inject({ method: 'POST', url: '/auth/flow/step', payload: { flow: flow.raw ?? flow, method: 'oidc' } })
    expect(done.statusCode).toBe(200)
    expect(json(done).token).toBeTruthy()
    expect(users.map((u) => u.email)).toEqual(['anna@acme.test'])
    await server.close()
  })

  it('refuses a provider this tenant switched off, even where the deployment declares it', async () => {
    const { server } = await build()
    const res = await server.inject({ method: 'POST', url: '/auth/flow/start', payload: { method: 'oidc', provider: 'legacy' } })
    expect(res.statusCode).toBe(400)
    expect(json(res).code).toBe('IDP_UNKNOWN_PROVIDER')
    await server.close()
  })
})
