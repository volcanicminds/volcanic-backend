/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The account side of the second factor, on both planes (T-12.1, T-12.35, T-12.36).
//
// The login no longer hands out a half-way token: the second factor is a stage of the flow, and the
// routes that set up, enable and disable a factor are account management for a complete session
// (F45). Three things are driven here through the real hook, the real route files and the real
// handlers: a pre-auth token of the old kind, still signed with the current secret, authenticates
// nothing anywhere (F36); a subject who already has a factor cannot enrol a second one over it,
// which is the T-12.1 attack with a stolen session instead of a password; and enabling a factor
// answers without issuing a session, because the caller already has one.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import cookie from '@fastify/cookie'
import authHook from '../../lib/hooks/onRequest.js'
import { preHandler as isAuthenticated } from '../../lib/middleware/isAuthenticated.js'
import tenantRoutes from '../../lib/api/auth/routes.js'
import systemRoutes from '../../lib/api/system/routes.js'
import * as auth from '../../lib/api/auth/controller/auth.js'
import * as systemAuth from '../../lib/api/system/controller/systemAuth.js'
import { fakeSessionStore } from './fixtures/sessionStore.js'

const SECRET = 'mfa-enrolment-test-secret-32-chars!!'
const ACME = { id: 'id-acme', slug: 'acme', status: 'active' }
const USER: any = { id: 'u1', externalId: 'u-ext-1', email: 'anna@acme.test', roles: ['admin'], confirmed: true, blocked: false }
const MFA_USER: any = { ...USER, id: 'u2', externalId: 'u-ext-2', email: 'mfa@acme.test', mfaEnabled: true }
const OPERATOR: any = { id: 's1', externalId: 's-ext-1', email: 'root@system.test', roles: ['system:admin'], blocked: false }
const MFA_OPERATOR: any = { ...OPERATOR, id: 's2', externalId: 's-ext-2', email: 'ops@system.test', mfaEnabled: true }
const PUBLIC = [{ code: 'public' }]

;(global as any).log = {}

const CONTROLLERS: Record<string, any> = { auth, systemAuth }

async function build() {
  const users = [{ ...USER }, { ...MFA_USER }]
  const operators = [{ ...OPERATOR }, { ...MFA_OPERATOR }]
  const written: Array<{ plane: string; id: string; secret: string }> = []

  const server: any = fastify()
  await server.register(cookie, { secret: 'mfa-enrolment-cookie-secret-32-chars' })
  await server.register(jwtValidator, { secret: SECRET, sign: { expiresIn: '7200s' } })
  server.decorate('sessionManager', fakeSessionStore().manager)
  server.decorate('userManager', {
    isImplemented: () => true,
    isValidUser: async (u: any) => !!u && !u.blocked,
    retrieveUserByExternalId: async (_c: any, ext: string) => users.find((u) => u.externalId === ext) ?? null,
    updateUserById: async () => ({}),
    saveMfaSecret: async (_c: any, id: string, secret: string) => written.push({ plane: 'tenant', id, secret }),
    enableMfa: async (_c: any, id: string) => ((users.find((u) => u.id === id)!.mfaEnabled = true), true)
  })
  server.decorate('systemUserManager', {
    isImplemented: () => true,
    retrieveSystemUserByExternalId: async (_c: any, ext: string) => operators.find((o) => o.externalId === ext) ?? null,
    saveMfaSecret: async (_c: any, id: string, secret: string) => written.push({ plane: 'control', id, secret }),
    enableMfa: async (_c: any, id: string) => ((operators.find((o) => o.id === id)!.mfaEnabled = true), true),
    recordMfaCounter: async () => ({})
  })
  server.decorate('mfaManager', {
    generateSetup: async () => ({ secret: 'NEW-SECRET', qrCode: 'data:' }),
    verify: (code: string) => (code === '123456' ? 1 : null)
  })

  server.addHook('onRequest', async (req: any) => {
    req.control = { kind: 'control' }
    req.dataScope = { requestId: String(req.id) }
    if (req.routeOptions?.config?.tenantContext !== false) {
      req.tenant = { kind: 'tenant', tenantId: ACME.id }
      req.tenantInfo = { id: ACME.id, slug: ACME.slug }
    }
  })
  server.addHook('onRequest', authHook)

  // The routes as their files declare them: the middleware that closes them to anonymous callers
  // is part of what is under test, so it is not written again here.
  const mount = (prefix: string, file: any, tenantContext: boolean, paths: string[]) => {
    for (const route of file.routes.filter((r: any) => paths.includes(r.path))) {
      const [controller, handler] = route.handler.split('.')
      server.route({
        method: route.method,
        url: prefix + route.path,
        config: { tenantContext, requiredRoles: PUBLIC },
        preHandler: (route.middlewares ?? []).includes('global.isAuthenticated') ? isAuthenticated : undefined,
        handler: CONTROLLERS[controller][handler]
      })
    }
  }
  mount('/auth', tenantRoutes, true, ['/mfa/setup', '/mfa/enable', '/mfa/disable', '/sessions'])
  mount('/system', systemRoutes, false, ['/auth/mfa/setup', '/auth/mfa/enable', '/auth/sessions'])
  // One ordinary route per plane, closed to anyone without the role.
  server.get('/orders', { config: { tenantContext: true, requiredRoles: [{ code: 'admin' }] } }, async () => ({ ok: true }))
  server.get('/system/orders', { config: { tenantContext: false, requiredRoles: [{ code: 'system:admin' }] } }, async () => ({ ok: true }))

  await server.ready()
  return { server, written, users, operators }
}

const codeOf = (res: any) => JSON.parse(res.body)?.code
const cookieOf = (res: any, name: string) => res.cookies.find((c: any) => c.name === name)

/** A complete session of each plane, in its cookie, as the flow would have left it. */
const tenantSession = (server: any, user: any) => ({ auth_token: server.signCookie(server.jwt.sign({ sub: user.externalId, tid: ACME.id })) })
const controlSession = (server: any, op: any) => ({ control_token: server.signCookie(server.jwt.sign({ sub: op.externalId, scp: 'control' })) })

/** What the v4 login signed between the two factors, with the secret this server still uses. */
const preAuthToken = (server: any, claims: Record<string, unknown>) => server.jwt.sign({ ...claims, role: 'pre-auth-mfa' }, { expiresIn: '5m' })

describe('mfa · the account routes of the second factor, on both planes', () => {
  let saved: any

  before(() => {
    saved = { mode: process.env.AUTH_MODE, roles: (global as any).roles, config: (global as any).config }
    ;(global as any).roles = { public: { code: 'public', name: 'Public' }, admin: { code: 'admin', name: 'Admin' } }
    ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
  })
  beforeEach(() => {
    delete process.env.AUTH_MODE
  })
  after(() => {
    ;(global as any).roles = saved.roles
    ;(global as any).config = saved.config
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
  })

  describe('a pre-auth token authenticates nothing (T-12.35, F36)', () => {
    const TENANT_PATHS = ['/orders', '/auth/mfa/setup', '/auth/sessions']
    const CONTROL_PATHS = ['/system/orders', '/system/auth/mfa/setup', '/system/auth/sessions']
    const methodOf = (url: string) => (url.endsWith('orders') || url.endsWith('sessions') ? 'GET' : 'POST')

    it('is 401 UNAUTHORIZED on the tenant plane, in its cookie', async () => {
      const { server, written } = await build()
      const pre = server.signCookie(preAuthToken(server, { sub: MFA_USER.externalId, tid: ACME.id }))
      for (const url of TENANT_PATHS) {
        const res = await server.inject({ method: methodOf(url), url, cookies: { auth_token: pre } })
        expect([url, res.statusCode, codeOf(res)]).toEqual([url, 401, 'UNAUTHORIZED'])
      }
      expect(written).toEqual([])
      await server.close()
    })

    it('is 401 UNAUTHORIZED on the control plane, in its cookie', async () => {
      const { server } = await build()
      const pre = server.signCookie(preAuthToken(server, { sub: MFA_OPERATOR.externalId, scp: 'control' }))
      for (const url of CONTROL_PATHS) {
        const res = await server.inject({ method: methodOf(url), url, cookies: { control_token: pre } })
        expect([url, res.statusCode, codeOf(res)]).toEqual([url, 401, 'UNAUTHORIZED'])
      }
      await server.close()
    })

    it('is 401 UNAUTHORIZED in the header of a bearer deployment, on both planes', async () => {
      process.env.AUTH_MODE = 'BEARER'
      const { server } = await build()
      const tenant = preAuthToken(server, { sub: MFA_USER.externalId, tid: ACME.id })
      const control = preAuthToken(server, { sub: MFA_OPERATOR.externalId, scp: 'control' })
      for (const [paths, token] of [
        [TENANT_PATHS, tenant],
        [CONTROL_PATHS, control]
      ] as const) {
        for (const url of paths) {
          const res = await server.inject({ method: methodOf(url), url, headers: { authorization: `Bearer ${token}` } })
          expect([url, res.statusCode, codeOf(res)]).toEqual([url, 401, 'UNAUTHORIZED'])
        }
      }
      await server.close()
    })

    it('refuses any role claim, not only the old one', async () => {
      const { server } = await build()
      const other = server.signCookie(server.jwt.sign({ sub: USER.externalId, tid: ACME.id, role: 'admin' }))
      const res = await server.inject({ method: 'GET', url: '/orders', cookies: { auth_token: other } })
      expect([res.statusCode, codeOf(res)]).toEqual([401, 'UNAUTHORIZED'])
      await server.close()
    })

    it('lets the same subject through with a complete session', async () => {
      const { server } = await build()
      const tenant = await server.inject({ method: 'GET', url: '/orders', cookies: tenantSession(server, MFA_USER) })
      const control = await server.inject({ method: 'GET', url: '/system/orders', cookies: controlSession(server, MFA_OPERATOR) })
      expect([tenant.statusCode, control.statusCode]).toEqual([200, 200])
      await server.close()
    })
  })

  describe('the routes want a complete session (T-12.36, F45)', () => {
    it('answers 401 to an anonymous caller on setup and enable, on both planes', async () => {
      const { server, written } = await build()
      for (const url of ['/auth/mfa/setup', '/auth/mfa/enable', '/auth/mfa/disable', '/system/auth/mfa/setup', '/system/auth/mfa/enable']) {
        const res = await server.inject({ method: 'POST', url, payload: { secret: 'NEW-SECRET', token: '123456' } })
        expect([url, res.statusCode, codeOf(res)]).toEqual([url, 401, 'UNAUTHORIZED'])
      }
      expect(written).toEqual([])
      await server.close()
    })

    it('has no verification route left on either plane (T-12.34)', () => {
      const gone = ['/login', '/mfa/verify', '/auth/login', '/auth/mfa/verify']
      const paths = [...tenantRoutes.routes, ...systemRoutes.routes].map((r: any) => r.path)
      expect(paths.filter((p) => gone.includes(p))).toEqual([])
    })
  })

  describe('a subject with a factor cannot enrol another over it (T-12.1)', () => {
    it('refuses the tenant setup and enable with 409 MFA_ALREADY_ENABLED, and overwrites nothing', async () => {
      const { server, written } = await build()
      const cookies = tenantSession(server, MFA_USER)

      const setup = await server.inject({ method: 'POST', url: '/auth/mfa/setup', cookies })
      expect([setup.statusCode, codeOf(setup)]).toEqual([409, 'MFA_ALREADY_ENABLED'])

      const enable = await server.inject({ method: 'POST', url: '/auth/mfa/enable', cookies, payload: { secret: 'ATTACKER-SECRET', token: '123456' } })
      expect([enable.statusCode, codeOf(enable)]).toEqual([409, 'MFA_ALREADY_ENABLED'])
      expect(written).toEqual([])
      await server.close()
    })

    it('refuses the platform setup and enable for an operator who already has a factor', async () => {
      const { server, written } = await build()
      const cookies = controlSession(server, MFA_OPERATOR)

      const setup = await server.inject({ method: 'POST', url: '/system/auth/mfa/setup', cookies })
      expect([setup.statusCode, codeOf(setup)]).toEqual([409, 'MFA_ALREADY_ENABLED'])

      const enable = await server.inject({
        method: 'POST',
        url: '/system/auth/mfa/enable',
        cookies,
        payload: { secret: 'ATTACKER-SECRET', token: '123456' }
      })
      expect([enable.statusCode, codeOf(enable)]).toEqual([409, 'MFA_ALREADY_ENABLED'])
      expect(written).toEqual([])
      await server.close()
    })
  })

  describe('enabling issues no session (T-12.36, F45)', () => {
    it('enrols a tenant subject without a factor and answers { ok: true }, with no cookie written', async () => {
      const { server, written, users } = await build()
      const res = await server.inject({
        method: 'POST',
        url: '/auth/mfa/enable',
        cookies: tenantSession(server, USER),
        payload: { secret: 'NEW-SECRET', token: '123456' }
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true })
      expect(cookieOf(res, 'auth_token')).toBeUndefined()
      expect(cookieOf(res, 'refresh_token')).toBeUndefined()
      expect(written).toEqual([{ plane: 'tenant', id: USER.id, secret: 'NEW-SECRET' }])
      expect(users.find((u) => u.id === USER.id)!.mfaEnabled).toBe(true)
      await server.close()
    })

    it('does the same for an operator', async () => {
      const { server, written } = await build()
      const res = await server.inject({
        method: 'POST',
        url: '/system/auth/mfa/enable',
        cookies: controlSession(server, OPERATOR),
        payload: { secret: 'NEW-SECRET', token: '123456' }
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true })
      expect(cookieOf(res, 'control_token')).toBeUndefined()
      expect(cookieOf(res, 'control_refresh_token')).toBeUndefined()
      expect(written).toEqual([{ plane: 'control', id: OPERATOR.id, secret: 'NEW-SECRET' }])
      await server.close()
    })

    it('returns no token in the body of a bearer deployment either', async () => {
      process.env.AUTH_MODE = 'BEARER'
      const { server } = await build()
      const token = server.jwt.sign({ sub: USER.externalId, tid: ACME.id })
      const res = await server.inject({
        method: 'POST',
        url: '/auth/mfa/enable',
        headers: { authorization: `Bearer ${token}` },
        payload: { secret: 'NEW-SECRET', token: '123456' }
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true })
      await server.close()
    })
  })
})
