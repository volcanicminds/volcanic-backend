/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-10.37, T-10.38, T-10.39: the session in a cookie, by default, and what that changes.
//
// The default mode is now `COOKIE`, and it is not the v4 cookie mode with a different default.
// v4 read one channel per configuration, so turning the cookie on switched the header off and
// every integration token with it; it wrote a cookie that outlived nothing and died before its
// token; it had no renewal at all; and it wrote the platform session and the tenant one into
// the same cookie. Each of those is a test below, and each goes through `server.inject` with
// the real hook and the real handlers, because the property in doubt is what a request
// carrying a cookie actually gets back, not what a helper returns when called.
//
// The refresh namespace is registered with the SAME secret as the access one on purpose: it is
// what a deployment without `JWT_REFRESH_SECRET` runs, and the only configuration where the
// `typ` claim is the whole difference between the two tokens.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import cookie from '@fastify/cookie'
import authHook from '../../lib/hooks/onRequest.js'
import { login, logout, refreshToken, mfaVerify } from '../../lib/api/auth/controller/auth.js'
import { login as systemLogin, renew as systemRenew } from '../../lib/api/system/controller/systemAuth.js'
import { impersonate, endImpersonation } from '../../lib/api/tenants/controller/tenants.js'
import { authMode, refreshCookiePath, REFRESH_TYP } from '../../lib/util/credential.js'

const SECRET = 'auth-channels-test-secret-32-chars!!'
const COOKIE_SECRET = 'auth-channels-cookie-secret-32-chars'
const ACCESS_TTL = 7200
const REFRESH_TTL = 3 * 86400

const ACME = { id: 'id-acme', slug: 'acme', status: 'active' }
const USER: any = { id: 'u1', externalId: 'u-ext-1', email: 'anna@acme.test', roles: ['admin'], confirmed: true, blocked: false }
const MFA_USER: any = { ...USER, id: 'u2', externalId: 'u-ext-2', email: 'mfa@acme.test', mfaEnabled: true }
const TARGET: any = { id: 'u3', externalId: 'u-ext-3', email: 'target@acme.test', roles: ['admin'], confirmed: true, blocked: false }
const INTEGRATION = { id: 't1', externalId: 't-ext-1', roles: ['admin'] }
const OPERATOR: any = { id: 's1', externalId: 's-ext-1', email: 'root@system.test', roles: ['system:admin'], blocked: false }

;(global as any).log = {}

const PUBLIC = [{ code: 'public' }]
const ADMIN = [{ code: 'admin' }]
const SYSTEM_ADMIN = [{ code: 'system:admin' }]

async function build() {
  const users = [USER, MFA_USER, TARGET]
  const records = new Map<string, any>()

  const server: any = fastify()
  await server.register(cookie, { secret: COOKIE_SECRET })
  await server.register(jwtValidator, { secret: SECRET, sign: { expiresIn: `${ACCESS_TTL}s` } })
  await server.register(jwtValidator, { namespace: 'refreshToken', secret: SECRET, sign: { expiresIn: `${REFRESH_TTL}s` } })

  server.decorate('userManager', {
    isImplemented: () => true,
    isValidUser: async (u: any) => !!u && !u.blocked,
    isPasswordToBeChanged: () => false,
    retrieveUserByPassword: async (_c: any, email: string, pw: string) => (pw === 'pw' ? users.find((u) => u.email === email) ?? null : null),
    retrieveUserByEmail: async (_c: any, email: string) => users.find((u) => u.email === email) ?? null,
    retrieveUserById: async (_c: any, id: string) => users.find((u) => u.id === id) ?? null,
    retrieveUserByExternalId: async (_c: any, ext: string) => users.find((u) => u.externalId === ext) ?? null,
    retrieveMfaSecret: async () => 'MFA-SECRET',
    updateUserById: async () => ({})
  })
  server.decorate('tokenManager', {
    isImplemented: () => true,
    isValidToken: async () => true,
    retrieveTokenByExternalId: async (_c: any, ext: string) => (ext === INTEGRATION.externalId ? INTEGRATION : null)
  })
  server.decorate('systemUserManager', {
    isImplemented: () => true,
    retrieveSystemUserByPassword: async (_c: any, email: string, pw: string) => (email === OPERATOR.email && pw === 'pw' ? OPERATOR : null),
    retrieveSystemUserByExternalId: async (_c: any, ext: string) => (ext === OPERATOR.externalId ? OPERATOR : null)
  })
  server.decorate('tenantManager', {
    isImplemented: () => true,
    getTenant: async (_c: any, id: string) => (id === ACME.id ? ACME : null)
  })
  server.decorate('provider', { tenant: async (tenantId: string) => ({ kind: 'tenant', tenantId }) })
  server.decorate('mfaManager', { verify: (code: string) => (code === '123456' ? 1 : null) })
  server.decorate('impersonationManager', {
    isImplemented: () => true,
    openImpersonation: async (_c: any, data: any) => {
      const record = { id: `imp-${records.size + 1}`, revokedAt: null, ...data }
      records.set(record.id, record)
      return record
    },
    getImpersonation: async (_c: any, id: string) => {
      const r = records.get(id)
      return r && !r.revokedAt ? r : null
    },
    revokeImpersonation: async (_c: any, id: string) => {
      const r = records.get(id)
      if (!r || r.revokedAt) return false
      r.revokedAt = new Date()
      return true
    }
  })

  // What the tenant resolution would have done: every tenant route of this server is acme's.
  server.addHook('onRequest', async (req: any) => {
    req.control = { kind: 'control' }
    req.dataScope = { requestId: String(req.id) }
    if (req.routeOptions?.config?.tenantContext !== false) {
      req.tenant = { kind: 'tenant', tenantId: ACME.id }
      req.tenantInfo = { id: ACME.id, slug: ACME.slug }
    }
  })
  server.addHook('onRequest', authHook)

  const tenant = (requiredRoles: any[]) => ({ config: { tenantContext: true, requiredRoles } })
  const control = (requiredRoles: any[]) => ({ config: { tenantContext: false, requiredRoles } })

  server.post('/auth/login', tenant(PUBLIC), login)
  server.post('/auth/logout', tenant(PUBLIC), logout)
  server.post('/auth/refresh-token', tenant(PUBLIC), refreshToken)
  server.post('/auth/mfa/verify', tenant(PUBLIC), mfaVerify)
  server.get('/orders', tenant(ADMIN), async (req: any) => ({ who: req.user?.email ?? req.token?.id, imp: req.impersonation?.id ?? null }))
  server.get('/open', tenant(PUBLIC), async (req: any) => ({ who: req.user?.email ?? null }))

  server.post('/system/auth/login', control(PUBLIC), systemLogin)
  server.post('/system/auth/refresh-token', control(PUBLIC), systemRenew)
  server.get('/platform', control(SYSTEM_ADMIN), async (req: any) => ({ who: req.systemUser?.email ?? null }))
  server.post('/tenants/:id/impersonate', control(SYSTEM_ADMIN), impersonate)
  server.post('/tenants/impersonate/end', control(SYSTEM_ADMIN), endImpersonation)

  await server.ready()
  return server
}

const cookieOf = (res: any, name: string) => res.cookies.find((c: any) => c.name === name)
const codeOf = (res: any) => JSON.parse(res.body)?.code
const unsigned = (server: any, value: string) => server.unsignCookie(value).value as string

async function tenantLogin(server: any, email = USER.email) {
  return server.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'pw' } })
}

async function systemSession(server: any) {
  const res = await server.inject({ method: 'POST', url: '/system/auth/login', payload: { email: OPERATOR.email, password: 'pw' } })
  return cookieOf(res, 'control_token').value as string
}

let saved: Record<string, string | undefined>

describe('auth channels · the session in a cookie by default (T-10.37, T-10.38, T-10.39)', () => {
  before(() => {
    saved = { mode: process.env.AUTH_MODE, prefix: process.env.COOKIE_PATH_PREFIX }
    ;(global as any).savedAuthChannels = { roles: (global as any).roles, config: (global as any).config }
    ;(global as any).roles = { public: { code: 'public', name: 'Public' }, admin: { code: 'admin', name: 'Admin' } }
    ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
    delete process.env.AUTH_MODE
    delete process.env.COOKIE_PATH_PREFIX
  })

  after(() => {
    const prev = (global as any).savedAuthChannels
    ;(global as any).roles = prev.roles
    ;(global as any).config = prev.config
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
    if (saved.prefix === undefined) delete process.env.COOKIE_PATH_PREFIX
    else process.env.COOKIE_PATH_PREFIX = saved.prefix
  })

  describe('the mode', () => {
    afterEach(() => delete process.env.AUTH_MODE)

    it('is COOKIE when nobody sets it', () => {
      expect(authMode()).toBe('COOKIE')
    })

    it('refuses a value that is not a mode, instead of reading it as the other one', () => {
      // v4 read anything that was not exactly `COOKIE` as `BEARER`, so `cookie` meant bearer.
      process.env.AUTH_MODE = 'cookie'
      expect(authMode()).toBe('COOKIE')
      process.env.AUTH_MODE = 'COOKIES'
      expect(() => authMode()).toThrow(/COOKIE or BEARER/)
    })
  })

  describe('T-10.37 · one kind of credential per channel', () => {
    it('writes the session into httpOnly cookies and leaves the body without tokens', async () => {
      const server = await build()
      const res = await tenantLogin(server)

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.token).toBeNull()
      expect(body.refreshToken).toBeNull()

      const access = cookieOf(res, 'auth_token')
      expect(access).toMatchObject({ path: '/', httpOnly: true, sameSite: 'Strict' })
      const refresh = cookieOf(res, 'refresh_token')
      // Only the renewal route ever receives the refresh token.
      expect(refresh).toMatchObject({ path: '/auth/refresh-token', httpOnly: true, sameSite: 'Strict' })
      await server.close()
    })

    it('authenticates a request by the cookie alone', async () => {
      const server = await build()
      const token = cookieOf(await tenantLogin(server), 'auth_token').value
      const res = await server.inject({ method: 'GET', url: '/orders', cookies: { auth_token: token } })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).who).toBe(USER.email)
      await server.close()
    })

    it('still accepts an integration token from the header, which v4 cookie mode did not read at all', async () => {
      const server = await build()
      const integration = server.jwt.sign({ sub: INTEGRATION.externalId })
      const res = await server.inject({ method: 'GET', url: '/orders', headers: { authorization: `Bearer ${integration}` } })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).who).toBe(INTEGRATION.id)
      await server.close()
    })

    it('refuses a session token taken out of its cookie and replayed in the header', async () => {
      const server = await build()
      const session = unsigned(server, cookieOf(await tenantLogin(server), 'auth_token').value)
      const res = await server.inject({ method: 'GET', url: '/orders', headers: { authorization: `Bearer ${session}` } })
      expect(res.statusCode).toBe(401)
      expect(codeOf(res)).toBe('CREDENTIAL_CHANNEL')
      await server.close()
    })

    it('treats that same header as no credential on a public route, as it does any bad token', async () => {
      const server = await build()
      const session = server.jwt.sign({ sub: USER.externalId, tid: ACME.id })
      const res = await server.inject({ method: 'GET', url: '/open', headers: { authorization: `Bearer ${session}` } })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).who).toBeNull()
      await server.close()
    })

    it('never resolves an integration token out of a cookie', async () => {
      const server = await build()
      const planted = server.signCookie(server.jwt.sign({ sub: INTEGRATION.externalId }))
      const res = await server.inject({ method: 'GET', url: '/orders', cookies: { auth_token: planted } })
      expect(res.statusCode).toBe(404)
      await server.close()
    })

    it('keeps the platform session in its own cookie, which a tenant route does not read', async () => {
      const server = await build()
      const res = await server.inject({ method: 'POST', url: '/system/auth/login', payload: { email: OPERATOR.email, password: 'pw' } })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).refreshToken).toBeNull()
      expect(cookieOf(res, 'auth_token')).toBeUndefined()
      expect(cookieOf(res, 'control_refresh_token')).toMatchObject({ path: '/system/auth/refresh-token' })

      const control = cookieOf(res, 'control_token').value
      const platform = await server.inject({ method: 'GET', url: '/platform', cookies: { control_token: control } })
      expect(platform.statusCode).toBe(200)
      expect(JSON.parse(platform.body).who).toBe(OPERATOR.email)

      const tenantSide = await server.inject({ method: 'GET', url: '/orders', cookies: { control_token: control } })
      expect(tenantSide.statusCode).toBe(401)
      await server.close()
    })

    it('does not let a platform route read the tenant cookie either', async () => {
      const server = await build()
      const token = cookieOf(await tenantLogin(server), 'auth_token').value
      const res = await server.inject({ method: 'GET', url: '/platform', cookies: { auth_token: token } })
      expect(res.statusCode).toBe(401)
      await server.close()
    })

    it('clears both cookies of the plane on logout', async () => {
      const server = await build()
      const res = await server.inject({ method: 'POST', url: '/auth/logout' })
      expect(cookieOf(res, 'auth_token')).toMatchObject({ value: '', path: '/' })
      expect(cookieOf(res, 'refresh_token')).toMatchObject({ value: '', path: '/auth/refresh-token' })
      await server.close()
    })

    it('limits the refresh cookie to the path the browser sees behind a prefix-stripping proxy', () => {
      process.env.COOKIE_PATH_PREFIX = '/api/'
      try {
        expect(refreshCookiePath('tenant')).toBe('/api/auth/refresh-token')
        expect(refreshCookiePath('control')).toBe('/api/system/auth/refresh-token')
      } finally {
        delete process.env.COOKIE_PATH_PREFIX
      }
      expect(refreshCookiePath('tenant')).toBe('/auth/refresh-token')
    })
  })

  describe('T-10.37 · MFA and impersonation go through the cookie too', () => {
    it('carries the pre-auth token in the cookie and completes the second factor from it', async () => {
      const server = await build()
      const first = await tenantLogin(server, MFA_USER.email)
      expect(first.statusCode).toBe(202)
      expect(JSON.parse(first.body).tempToken).toBeNull()
      const pre = cookieOf(first, 'auth_token')
      expect(Math.abs(pre.maxAge - 300)).toBeLessThanOrEqual(1)

      // Five minutes that open the MFA routes and nothing else.
      const blocked = await server.inject({ method: 'GET', url: '/orders', cookies: { auth_token: pre.value } })
      expect(blocked.statusCode).toBe(403)
      expect(codeOf(blocked)).toBe('MFA_REQUIRED')

      const second = await server.inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        cookies: { auth_token: pre.value },
        payload: { token: '123456' }
      })
      expect(second.statusCode).toBe(200)
      expect(JSON.parse(second.body).token).toBeNull()
      const session = cookieOf(second, 'auth_token').value
      expect(cookieOf(second, 'refresh_token')).toBeDefined()

      const res = await server.inject({ method: 'GET', url: '/orders', cookies: { auth_token: session } })
      expect(res.statusCode).toBe(200)
      await server.close()
    })

    it('opens an impersonation in the tenant cookie, and the operator keeps the session that can end it', async () => {
      const server = await build()
      const control = await systemSession(server)

      const opened = await server.inject({
        method: 'POST',
        url: `/tenants/${ACME.id}/impersonate`,
        cookies: { control_token: control },
        payload: { userId: TARGET.email, reason: 'ticket 4412' }
      })
      expect(opened.statusCode).toBe(200)
      const body = JSON.parse(opened.body)
      expect(body.token).toBeNull()
      expect(cookieOf(opened, 'control_token')).toBeUndefined()
      expect(cookieOf(opened, 'refresh_token')).toMatchObject({ value: '' })
      const imp = cookieOf(opened, 'auth_token')
      // Thirty minutes, the impersonation TTL, read from the token like every other cookie.
      expect(Math.abs(imp.maxAge - 1800)).toBeLessThanOrEqual(1)

      const acting = await server.inject({ method: 'GET', url: '/orders', cookies: { auth_token: imp.value } })
      expect(acting.statusCode).toBe(200)
      expect(JSON.parse(acting.body)).toEqual({ who: TARGET.email, imp: body.impersonationId })

      const ended = await server.inject({
        method: 'POST',
        url: '/tenants/impersonate/end',
        cookies: { control_token: control, auth_token: imp.value },
        payload: { impersonationId: body.impersonationId }
      })
      expect(ended.statusCode).toBe(200)
      expect(cookieOf(ended, 'auth_token')).toMatchObject({ value: '' })

      const after = await server.inject({ method: 'GET', url: '/orders', cookies: { auth_token: imp.value } })
      expect(after.statusCode).toBe(403)
      expect(codeOf(after)).toBe('IMPERSONATION_ENDED')
      await server.close()
    })

    it('leaves the tenant cookie alone when it holds another session than the one being ended', async () => {
      const server = await build()
      const control = await systemSession(server)
      const open = async () =>
        JSON.parse(
          (
            await server.inject({
              method: 'POST',
              url: `/tenants/${ACME.id}/impersonate`,
              cookies: { control_token: control },
              payload: { userId: TARGET.email, reason: 'ticket 4412' }
            })
          ).body
        )
      const first = await open()
      const tenantCookie = cookieOf(await tenantLogin(server), 'auth_token').value

      const ended = await server.inject({
        method: 'POST',
        url: '/tenants/impersonate/end',
        cookies: { control_token: control, auth_token: tenantCookie },
        payload: { impersonationId: first.impersonationId }
      })
      expect(ended.statusCode).toBe(200)
      expect(cookieOf(ended, 'auth_token')).toBeUndefined()
      await server.close()
    })
  })

  describe('T-10.38 · the cookie lives as long as its token', () => {
    it('reads Max-Age from the token it carries, for the access and the refresh cookie', async () => {
      const server = await build()
      const res = await tenantLogin(server)

      for (const [name, ttl] of [
        ['auth_token', ACCESS_TTL],
        ['refresh_token', REFRESH_TTL]
      ] as const) {
        const c = cookieOf(res, name)
        const claims = server.jwt.decode(unsigned(server, c.value))
        // One setting: the lifetime the token was signed with IS the cookie's lifetime. v4 wrote
        // 86400 by hand next to a fifteen-day token.
        expect(claims.exp - claims.iat).toBe(ttl)
        expect(Math.abs(c.maxAge - ttl)).toBeLessThanOrEqual(1)
      }
      await server.close()
    })
  })

  describe('T-10.39 · renewal from the refresh cookie', () => {
    it('renews the session with the refresh cookie alone, after the access cookie is gone', async () => {
      const server = await build()
      const refresh = cookieOf(await tenantLogin(server), 'refresh_token').value

      const res = await server.inject({ method: 'POST', url: '/auth/refresh-token', cookies: { refresh_token: refresh } })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).token).toBeNull()

      const renewed = cookieOf(res, 'auth_token').value
      const orders = await server.inject({ method: 'GET', url: '/orders', cookies: { auth_token: renewed } })
      expect(orders.statusCode).toBe(200)
      await server.close()
    })

    it('renews the platform session from its own refresh cookie', async () => {
      const server = await build()
      const login = await server.inject({ method: 'POST', url: '/system/auth/login', payload: { email: OPERATOR.email, password: 'pw' } })
      const refresh = cookieOf(login, 'control_refresh_token').value

      const res = await server.inject({ method: 'POST', url: '/system/auth/refresh-token', cookies: { control_refresh_token: refresh } })
      expect(res.statusCode).toBe(200)
      const platform = await server.inject({ method: 'GET', url: '/platform', cookies: { control_token: cookieOf(res, 'control_token').value } })
      expect(platform.statusCode).toBe(200)
      await server.close()
    })

    it('answers 401 REFRESH_REQUIRED when there is no refresh cookie, so the client goes to the login', async () => {
      const server = await build()
      const res = await server.inject({ method: 'POST', url: '/auth/refresh-token' })
      expect(res.statusCode).toBe(401)
      expect(codeOf(res)).toBe('REFRESH_REQUIRED')
      await server.close()
    })

    it('refuses a refresh cookie whose token does not verify, and clears the session', async () => {
      const server = await build()
      const token = unsigned(server, cookieOf(await tenantLogin(server), 'refresh_token').value)
      const forged = server.signCookie(token.slice(0, -4) + 'AAAA')
      const res = await server.inject({ method: 'POST', url: '/auth/refresh-token', cookies: { refresh_token: forged } })
      expect(res.statusCode).toBe(401)
      expect(cookieOf(res, 'refresh_token')).toMatchObject({ value: '' })
      await server.close()
    })

    it('does not let an access token renew itself, even with one secret for both', async () => {
      const server = await build()
      const access = unsigned(server, cookieOf(await tenantLogin(server), 'auth_token').value)
      const res = await server.inject({ method: 'POST', url: '/auth/refresh-token', cookies: { refresh_token: server.signCookie(access) } })
      expect(res.statusCode).toBe(403)
      await server.close()
    })

    it('does not let a refresh token open a route, even with one secret for both', async () => {
      const server = await build()
      const refresh = unsigned(server, cookieOf(await tenantLogin(server), 'refresh_token').value)
      expect(server.jwt.decode(refresh).typ).toBe(REFRESH_TYP)
      const res = await server.inject({ method: 'GET', url: '/orders', cookies: { auth_token: server.signCookie(refresh) } })
      expect(res.statusCode).toBe(401)
      await server.close()
    })
  })

  describe('bearer mode keeps its contract, with the same two refusals', () => {
    beforeEach(() => {
      process.env.AUTH_MODE = 'BEARER'
    })
    afterEach(() => delete process.env.AUTH_MODE)

    it('returns both tokens in the body and renews with them', async () => {
      const server = await build()
      const res = await tenantLogin(server)
      expect(cookieOf(res, 'auth_token')).toBeUndefined()
      const { token, refreshToken: refresh } = JSON.parse(res.body)
      expect(typeof token).toBe('string')

      const renewed = await server.inject({ method: 'POST', url: '/auth/refresh-token', payload: { token, refreshToken: refresh } })
      expect(renewed.statusCode).toBe(200)
      expect(typeof JSON.parse(renewed.body).token).toBe('string')
      await server.close()
    })

    it('refuses an access token in the place of the refresh token', async () => {
      const server = await build()
      const { token } = JSON.parse((await tenantLogin(server)).body)
      const res = await server.inject({ method: 'POST', url: '/auth/refresh-token', payload: { token, refreshToken: token } })
      expect(res.statusCode).toBe(403)
      await server.close()
    })

    it('refuses a refresh token in the Authorization header', async () => {
      const server = await build()
      const { refreshToken: refresh } = JSON.parse((await tenantLogin(server)).body)
      const res = await server.inject({ method: 'GET', url: '/orders', headers: { authorization: `Bearer ${refresh}` } })
      expect(res.statusCode).toBe(401)
      await server.close()
    })

    it('answers 403 instead of 500 for a refresh token that does not verify', async () => {
      const server = await build()
      const { token } = JSON.parse((await tenantLogin(server)).body)
      const res = await server.inject({ method: 'POST', url: '/auth/refresh-token', payload: { token, refreshToken: 'not.a.token' } })
      expect(res.statusCode).toBe(403)
      await server.close()
    })
  })
})
