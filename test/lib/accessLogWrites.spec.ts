/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.31: the access log is written by the routes that end, revoke or change a way in, on both
// planes, and the write never decides the outcome of the request. T-12.32: it is read back by the
// tenant's admin and by the platform's auditor, each on its own plane.
//
// The handlers are the framework's own, mounted bare behind the real authentication hook. What the
// tests hold to: each event lands in the container of its plane with the right subject, no row ever
// carries the password, the code, the secret or a credential the caller sent, and a manager that
// throws leaves every response exactly as it would have been.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import cookie from '@fastify/cookie'
import authHook from '../../lib/hooks/onRequest.js'
import * as tenantAuth from '../../lib/api/auth/controller/auth.js'
import * as systemAuth from '../../lib/api/system/controller/systemAuth.js'
import * as systemUser from '../../lib/api/system/controller/systemUser.js'
import { resetMfaByAdmin } from '../../lib/api/users/controller/user.js'
import { recordAccess } from '../../lib/util/accessLog.js'
import { fakeSessionStore } from './fixtures/sessionStore.js'
import { controlStart, decorateAuthRegistry, passwordLogin, tenantStart, useFrameworkFlows } from './fixtures/flowLogin.js'
import { processRoute } from '../../lib/loader/router.js'
import { loadSystem } from '../../lib/loader/roles.js'
import { accessLogSchema } from '../../lib/schemas/accessLog.js'
import * as tenantAccessLog from '../../lib/api/access-log/controller/accessLog.js'
import * as systemAccessLog from '../../lib/api/system/controller/systemAccessLog.js'

const SECRET = 'access-log-writes-test-secret-32-ch'
const COOKIE_SECRET = 'access-log-writes-cookie-secret-32c'
const ACME = { id: 'id-acme', slug: 'acme', status: 'active' }
const PUBLIC = [{ code: 'public' }]
const ADMIN = [{ code: 'admin' }]
const SYSTEM_ADMIN = [{ code: 'system:admin' }]
const PASSWORD = 'Pa55-word-never-logged'

const bag = globalThis as any
bag.log = {}

function people() {
  return {
    users: [
      { id: 'u1', externalId: 'x-anna', email: 'anna@acme.test', roles: ['admin'], confirmed: true, blocked: false },
      { id: 'u2', externalId: 'x-bruno', email: 'bruno@acme.test', roles: ['admin'], confirmed: true, blocked: false, mfaEnabled: true }
    ] as any[],
    operators: [{ id: 's1', externalId: 'x-root', email: 'root@system.test', roles: ['system:admin'], blocked: false }] as any[]
  }
}

async function build(accessLog?: any) {
  const { users, operators } = people()
  const sessions = fakeSessionStore()
  const rows: any[] = []
  let rotations = 0

  const server: any = fastify()
  await server.register(cookie, { secret: COOKIE_SECRET })
  await server.register(jwtValidator, { secret: SECRET, sign: { expiresIn: '1h' } })

  server.decorate('userManager', {
    isImplemented: () => true,
    isValidUser: async (u: any) => !!u && !u.blocked,
    isPasswordToBeChanged: () => false,
    retrieveUserByPassword: async (_c: any, email: string, pw: string) => (pw === PASSWORD ? (users.find((u) => u.email === email) ?? null) : null),
    retrieveUserByEmail: async (_c: any, email: string) => users.find((u) => u.email === email) ?? null,
    retrieveUserById: async (_c: any, id: string) => users.find((u) => u.id === id) ?? null,
    retrieveUserByExternalId: async (_c: any, ext: string) => users.find((u) => u.externalId === ext) ?? null,
    updateUserById: async (_c: any, id: string, data: any) => Object.assign(users.find((u) => u.id === id), data),
    saveMfaSecret: async () => true,
    enableMfa: async (_c: any, id: string) => ((users.find((u) => u.id === id).mfaEnabled = true), true),
    disableMfa: async (_c: any, id: string) => ((users.find((u) => u.id === id).mfaEnabled = false), true),
    resetExternalId: async (_c: any, id: string) => {
      const user = users.find((u) => u.id === id)
      user.externalId = `x-rotated-${++rotations}`
      return user
    }
  })
  server.decorate('systemUserManager', {
    isImplemented: () => true,
    retrieveSystemUserByPassword: async (_c: any, email: string, pw: string) =>
      pw === PASSWORD ? (operators.find((o) => o.email === email) ?? null) : null,
    retrieveSystemUserByExternalId: async (_c: any, ext: string) => operators.find((o) => o.externalId === ext) ?? null,
    retrieveSystemUserById: async (_c: any, id: string) => operators.find((o) => o.id === id) ?? null,
    saveMfaSecret: async () => true,
    enableMfa: async (_c: any, id: string) => ((operators.find((o) => o.id === id).mfaEnabled = true), true),
    disableMfa: async (_c: any, id: string) => ((operators.find((o) => o.id === id).mfaEnabled = false), true),
    recordMfaCounter: async () => true
  })
  server.decorate('mfaManager', {
    isImplemented: () => true,
    verify: (code: string, secret: string) => (code === `${secret}-ok` ? 0 : null)
  })
  server.decorate('tokenManager', { isImplemented: () => false })
  server.decorate('sessionManager', sessions.manager)
  decorateAuthRegistry(server)
  server.decorate(
    'accessLogManager',
    accessLog ?? {
      isImplemented: () => true,
      record: async (handle: any, entry: any) => (rows.push({ handle: handle.kind, ...entry }), entry),
      purgeExpired: async () => 0
    }
  )

  server.addHook('onRequest', async (req: any) => {
    req.control = { kind: 'control' }
    if (req.routeOptions?.config?.tenantContext !== false) {
      req.tenant = { kind: 'tenant', tenantId: ACME.id }
      req.tenantInfo = ACME
    }
  })
  server.addHook('onRequest', authHook)

  const tenant = (requiredRoles: any[]) => ({ config: { tenantContext: true, requiredRoles } })
  const control = (requiredRoles: any[]) => ({ config: { tenantContext: false, requiredRoles } })

  server.post('/auth/flow/start', tenant(PUBLIC), tenantStart)
  server.post('/auth/logout', tenant(PUBLIC), tenantAuth.logout)
  server.post('/auth/refresh-token', tenant(PUBLIC), tenantAuth.refreshToken)
  server.post('/auth/invalidate-tokens', tenant(PUBLIC), tenantAuth.invalidateTokens)
  server.delete('/auth/sessions/:id', tenant(PUBLIC), tenantAuth.revokeSession)
  server.post('/auth/mfa/enable', tenant(PUBLIC), tenantAuth.mfaEnable)
  server.post('/auth/mfa/disable', tenant(PUBLIC), tenantAuth.mfaDisable)
  server.post('/users/:id/mfa/reset', tenant(ADMIN), resetMfaByAdmin)

  server.post('/system/auth/flow/start', control(PUBLIC), controlStart)
  server.post('/system/auth/logout', control(PUBLIC), systemAuth.logout)
  server.post('/system/auth/refresh-token', control(PUBLIC), systemAuth.renew)
  server.delete('/system/auth/sessions/:id', control(PUBLIC), systemAuth.revokeSession)
  server.post('/system/auth/mfa/enable', control(PUBLIC), systemAuth.mfaEnable)
  server.post('/system/users/:id/mfa/reset', control(SYSTEM_ADMIN), systemUser.resetMfa)

  // The rows the login leaves are dropped by `loginAs`: its own events are proven with the flow
  // (authFlowRoutes), and these tests count what the routes after it write.
  server.decorate('loginRows', rows)
  await server.ready()
  return { server, rows, sessions, users, operators }
}

const json = (res: any) => JSON.parse(res.body)
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function loginAs(server: any, email: string, prefix = '/auth') {
  const before = server.loginRows.length
  const res = await server.inject({ method: 'POST', url: `${prefix}/flow/start`, payload: passwordLogin(email, PASSWORD) })
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`)
  server.loginRows.splice(before)
  const body = json(res)
  return { token: body.token as string, refresh: body.refreshToken as string, sid: (server.jwt.decode(body.token) as any).sid as string }
}

/** Every value a caller sent that is a secret: none of them may appear in any row. */
function assertNoSecret(rows: any[], secrets: string[]) {
  const written = JSON.stringify(rows)
  for (const secret of secrets.filter(Boolean)) expect(written.includes(secret)).toBe(false)
}

describe('access log · the writes of the session and factor routes (T-12.31)', () => {
  let restoreFlows: () => void
  before(() => (restoreFlows = useFrameworkFlows()))
  after(() => restoreFlows())

  let saved: any
  before(() => {
    saved = { config: bag.config, roles: bag.roles, systemRoles: bag.systemRoles, mode: process.env.AUTH_MODE, grace: process.env.SESSION_GRACE_SECONDS }
    bag.roles = { public: { code: 'public' }, admin: { code: 'admin' } }
    bag.systemRoles = { 'system:admin': { code: 'system:admin', capabilities: [] } }
    process.env.AUTH_MODE = 'BEARER'
    // No tolerance: the second presentation of a spent credential is reuse, not two tabs.
    process.env.SESSION_GRACE_SECONDS = '0'
  })
  beforeEach(() => {
    bag.config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
  })
  after(() => {
    bag.config = saved.config
    bag.roles = saved.roles
    bag.systemRoles = saved.systemRoles
    for (const [key, value] of [
      ['AUTH_MODE', saved.mode],
      ['SESSION_GRACE_SECONDS', saved.grace]
    ]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  describe('the tenant plane', () => {
    it('writes a logout and a closed session in the tenant container, with the subject and the sid', async () => {
      const { server, rows } = await build()
      const first = await loginAs(server, 'anna@acme.test')
      const second = await loginAs(server, 'anna@acme.test')

      const closed = await server.inject({ method: 'DELETE', url: `/auth/sessions/${second.sid}`, headers: bearer(first.token) })
      expect(closed.statusCode).toBe(200)
      const out = await server.inject({ method: 'POST', url: '/auth/logout', headers: bearer(first.token) })
      expect(out.statusCode).toBe(200)

      expect(rows.map((r) => [r.event, r.handle, r.scope, r.subjectId, r.sid])).toEqual([
        ['session.revoked', 'tenant', 'tenant', 'x-anna', second.sid],
        ['logout', 'tenant', 'tenant', 'x-anna', first.sid]
      ])
      assertNoSecret(rows, [PASSWORD, first.token, first.refresh, second.token, second.refresh])
      await server.close()
    })

    it('writes nothing for a logout that names no session', async () => {
      const { server, rows } = await build()
      const res = await server.inject({ method: 'POST', url: '/auth/logout' })
      expect(res.statusCode).toBe(200)
      expect(rows).toEqual([])
      await server.close()
    })

    it('writes the invalidation under the identifier being retired', async () => {
      const { server, rows, users } = await build()
      const { token, refresh } = await loginAs(server, 'anna@acme.test')
      const res = await server.inject({ method: 'POST', url: '/auth/invalidate-tokens', headers: bearer(token) })
      expect(res.statusCode).toBe(200)
      expect(users[0].externalId).toBe('x-rotated-1')
      expect(rows).toEqual([expect.objectContaining({ event: 'tokens.invalidated', outcome: 'success', scope: 'tenant', subjectId: 'x-anna' })])
      assertNoSecret(rows, [PASSWORD, token, refresh])
      await server.close()
    })

    it('writes the enrolment and the removal of a factor, never the secret or the code', async () => {
      const { server, rows } = await build()
      const { token } = await loginAs(server, 'anna@acme.test')
      const enabled = await server.inject({
        method: 'POST',
        url: '/auth/mfa/enable',
        headers: bearer(token),
        payload: { secret: 'TOTP-SECRET-ANNA', token: 'TOTP-SECRET-ANNA-ok' }
      })
      expect(enabled.statusCode).toBe(200)
      const disabled = await server.inject({ method: 'POST', url: '/auth/mfa/disable', headers: bearer(token) })
      expect(disabled.statusCode).toBe(200)

      expect(rows.map((r) => [r.event, r.scope, r.subjectId, r.methods])).toEqual([
        ['mfa.enrolled', 'tenant', 'x-anna', ['totp']],
        ['mfa.disabled', 'tenant', 'x-anna', ['totp']]
      ])
      assertNoSecret(rows, [PASSWORD, token, 'TOTP-SECRET-ANNA'])
      await server.close()
    })

    it("writes an admin's reset under the subject who lost the factor", async () => {
      const { server, rows } = await build()
      const { token } = await loginAs(server, 'anna@acme.test')
      const res = await server.inject({ method: 'POST', url: '/users/u2/mfa/reset', headers: bearer(token) })
      expect(res.statusCode).toBe(200)
      expect(rows).toEqual([expect.objectContaining({ event: 'mfa.disabled', scope: 'tenant', subjectId: 'x-bruno' })])
      await server.close()
    })

    it('writes the reuse of a spent refresh credential as a failure, with the session it closed', async () => {
      const { server, rows } = await build()
      const { refresh, sid } = await loginAs(server, 'anna@acme.test')
      const renewed = await server.inject({ method: 'POST', url: '/auth/refresh-token', payload: { refreshToken: refresh } })
      expect(renewed.statusCode).toBe(200)
      const replayed = await server.inject({ method: 'POST', url: '/auth/refresh-token', payload: { refreshToken: refresh } })
      expect(replayed.statusCode).toBe(401)
      expect(json(replayed).code).toBe('SESSION_REUSE_DETECTED')

      // A successful renewal is deliberately not an event (F44): one row, the reuse.
      expect(rows).toEqual([
        expect.objectContaining({
          event: 'session.reuse_detected',
          outcome: 'failure',
          code: 'SESSION_REUSE_DETECTED',
          handle: 'tenant',
          scope: 'tenant',
          subjectId: 'x-anna',
          sid
        })
      ])
      assertNoSecret(rows, [PASSWORD, refresh, json(renewed).refreshToken, json(renewed).token])
      await server.close()
    })
  })

  describe('the control plane', () => {
    it('writes logout, closed session, enrolment and reset in the control plane with scope control', async () => {
      const { server, rows } = await build()
      const first = await loginAs(server, 'root@system.test', '/system/auth')
      const second = await loginAs(server, 'root@system.test', '/system/auth')

      expect((await server.inject({ method: 'DELETE', url: `/system/auth/sessions/${second.sid}`, headers: bearer(first.token) })).statusCode).toBe(200)
      const enabled = await server.inject({
        method: 'POST',
        url: '/system/auth/mfa/enable',
        headers: bearer(first.token),
        payload: { secret: 'TOTP-SECRET-ROOT', token: 'TOTP-SECRET-ROOT-ok' }
      })
      expect(enabled.statusCode).toBe(200)
      expect((await server.inject({ method: 'POST', url: '/system/users/s1/mfa/reset', headers: bearer(first.token) })).statusCode).toBe(200)
      expect((await server.inject({ method: 'POST', url: '/system/auth/logout', headers: bearer(first.token) })).statusCode).toBe(200)

      expect(rows.map((r) => [r.event, r.handle, r.scope, r.subjectId])).toEqual([
        ['session.revoked', 'control', 'control', 'x-root'],
        ['mfa.enrolled', 'control', 'control', 'x-root'],
        ['mfa.disabled', 'control', 'control', 'x-root'],
        ['logout', 'control', 'control', 'x-root']
      ])
      assertNoSecret(rows, [PASSWORD, first.token, first.refresh, second.token, second.refresh, 'TOTP-SECRET-ROOT'])
      await server.close()
    })

    it('writes the reuse of a platform credential in the control plane', async () => {
      const { server, rows } = await build()
      const { refresh, sid } = await loginAs(server, 'root@system.test', '/system/auth')
      expect((await server.inject({ method: 'POST', url: '/system/auth/refresh-token', payload: { refreshToken: refresh } })).statusCode).toBe(200)
      const replayed = await server.inject({ method: 'POST', url: '/system/auth/refresh-token', payload: { refreshToken: refresh } })
      expect(replayed.statusCode).toBe(401)
      expect(rows).toEqual([expect.objectContaining({ event: 'session.reuse_detected', handle: 'control', scope: 'control', subjectId: 'x-root', sid })])
      await server.close()
    })
  })

  describe('a manager that throws', () => {
    it('leaves every response identical in status and body', async () => {
      const throwing = { isImplemented: () => true, record: async () => Promise.reject(new Error('disk full')), purgeExpired: async () => 0 }
      const scenario = async (accessLog?: any) => {
        const { server } = await build(accessLog)
        const out: any[] = []
        const { token, refresh, sid } = await loginAs(server, 'anna@acme.test')
        const other = await loginAs(server, 'anna@acme.test')
        const call = async (method: string, url: string, headers: any = {}, payload?: any) => {
          const res = await server.inject({ method, url, headers, payload })
          const body = res.body ? json(res) : null
          // Tokens are minted per call, so they are compared by presence and not by value.
          if (body && typeof body === 'object') for (const key of ['token', 'refreshToken']) if (key in body) body[key] = typeof body[key]
          out.push([res.statusCode, body])
        }
        await call('POST', '/auth/mfa/enable', bearer(token), { secret: 'S', token: 'S-ok' })
        await call('POST', '/auth/mfa/disable', bearer(token))
        await call('POST', '/users/u2/mfa/reset', bearer(token))
        await call('DELETE', `/auth/sessions/${other.sid}`, bearer(token))
        await call('POST', '/auth/refresh-token', {}, { refreshToken: refresh })
        await call('POST', '/auth/refresh-token', {}, { refreshToken: refresh })
        await call('POST', '/auth/logout', bearer(token))
        void sid
        await server.close()
        return out
      }
      expect(await scenario(throwing)).toEqual(await scenario())
    })
  })
})

describe('access log · the writer (T-12.31, T-12.33)', () => {
  let restoreFlows: () => void
  before(() => (restoreFlows = useFrameworkFlows()))
  after(() => restoreFlows())

  const req = (manager: any) => ({ ip: '203.0.113.9', server: { accessLogManager: manager } }) as any
  const entry = { event: 'logout', outcome: 'success', scope: 'tenant', subjectId: 'x-anna' } as const
  let random: () => number
  beforeEach(() => (random = Math.random))
  afterEach(() => (Math.random = random))

  it('fills the address from the request and writes on the handle it is given', async () => {
    const seen: any[] = []
    await recordAccess(req({ isImplemented: () => true, record: async (h: any, e: any) => seen.push([h, e]), purgeExpired: async () => 0 }), { kind: 'h' } as any, entry)
    expect(seen).toEqual([[{ kind: 'h' }, { ...entry, ip: '203.0.113.9' }]])
  })

  it('writes nothing without a handle or without an implemented manager, and does not throw', async () => {
    let calls = 0
    const counting = { isImplemented: () => true, record: async () => (calls += 1), purgeExpired: async () => 0 }
    await recordAccess(req(counting), null, entry)
    await recordAccess(req({ ...counting, isImplemented: () => false }), { kind: 'h' } as any, entry)
    await recordAccess(req(undefined), { kind: 'h' } as any, entry)
    expect(calls).toBe(0)
  })

  it('purges on about one write in fifty, and a failing purge is only a warning', async () => {
    let purges = 0
    const manager = {
      isImplemented: () => true,
      record: async () => undefined,
      purgeExpired: async () => {
        purges += 1
        throw new Error('locked')
      }
    }
    Math.random = () => 0.5
    await recordAccess(req(manager), { kind: 'h' } as any, entry)
    expect(purges).toBe(0)
    Math.random = () => 0.01
    await recordAccess(req(manager), { kind: 'h' } as any, entry)
    expect(purges).toBe(1)
  })

  it('does not purge after a write that failed', async () => {
    let purges = 0
    const manager = { isImplemented: () => true, record: async () => Promise.reject(new Error('x')), purgeExpired: async () => (purges += 1) }
    Math.random = () => 0
    await recordAccess(req(manager), { kind: 'h' } as any, entry)
    expect(purges).toBe(0)
  })
})

describe('access log · the read routes of both planes (T-12.32)', () => {
  let restoreFlows: () => void
  before(() => (restoreFlows = useFrameworkFlows()))
  after(() => restoreFlows())

  let saved: any
  before(async () => {
    saved = { config: bag.config, roles: bag.roles, systemRoles: bag.systemRoles, mode: process.env.AUTH_MODE }
    bag.config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
    bag.roles = { public: { code: 'public' }, admin: { code: 'admin' }, viewer: { code: 'viewer' } }
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

  async function reader() {
    const asked: any[] = []
    const row = {
      id: 'r1',
      occurredAt: '2026-09-22T10:00:00.000Z',
      scope: 'tenant',
      event: 'login.failed',
      outcome: 'failure',
      code: 'AUTH_INVALID_CREDENTIALS',
      subjectId: null,
      methods: ['password'],
      provider: null,
      flowId: null,
      sid: null,
      ip: '203.0.113.0',
      // A column the schema does not name must not reach the client.
      userAgent: 'curl/8'
    }
    const users: any[] = [
      { id: 'u1', externalId: 'x-anna', roles: ['admin'], blocked: false },
      { id: 'u9', externalId: 'x-vera', roles: ['viewer'], blocked: false }
    ]
    const operators: any[] = [
      { id: 's1', externalId: 'x-audit', roles: ['system:auditor'], blocked: false },
      { id: 's2', externalId: 'x-ops', roles: ['system:operator'], blocked: false }
    ]
    const server: any = fastify()
    await server.register(cookie, { secret: COOKIE_SECRET })
    await server.register(jwtValidator, { secret: SECRET, sign: { expiresIn: '1h' } })
    server.addSchema(accessLogSchema)
    server.decorate('userManager', {
      isImplemented: () => true,
      isValidUser: async (u: any) => !!u,
      retrieveUserByExternalId: async (_c: any, ext: string) => users.find((u) => u.externalId === ext) ?? null
    })
    server.decorate('systemUserManager', {
      isImplemented: () => true,
      retrieveSystemUserByExternalId: async (_c: any, ext: string) => operators.find((o) => o.externalId === ext) ?? null
    })
    server.decorate('tokenManager', { isImplemented: () => false })
    server.decorate('accessLogManager', {
      isImplemented: () => true,
      findQuery: async (handle: any, query: any, scope: any) => (asked.push([handle.kind, scope, query]), { records: [row], headers: { 'v-total': 1 } }),
      countQuery: async (handle: any, query: any, scope: any) => (asked.push([handle.kind, scope, query]), 1)
    })
    server.addHook('onRequest', async (req: any) => {
      req.control = { kind: 'control' }
      if (req.routeOptions?.config?.tenantContext !== false) {
        req.tenant = { kind: 'tenant', tenantId: ACME.id }
        req.tenantInfo = ACME
      }
    })
    server.addHook('onRequest', authHook)

    // Mounted through the real loader, so the roles are the ones the route files resolve to.
    const errors: string[] = []
    const mount = (file: any, dir: string, prefix: string, controller: any, only: (path: string) => boolean) => {
      file.routes.forEach((r: any, i: number) => {
        if (!only(r.path)) return
        const configured: any = processRoute(r, i, `${dir}/routes.ts`, dir, '', file.config, ['global.isAuthenticated'], [], errors)
        server.route({
          method: r.method,
          url: prefix + (r.path === '/' ? '' : r.path),
          schema: { response: r.config.response },
          config: { tenantContext: configured.tenantContext !== false, requiredRoles: configured.roles },
          handler: controller[r.handler.split('.')[1]]
        })
      })
    }
    // Imported afresh: the system file decides at import time whether it is enabled at all.
    const fresh = async (dir: string) => (await import(`../../lib/api/${dir}/routes.js?fresh=${Date.now()}`)).default
    mount(await fresh('access-log'), 'access-log', '/access-log', tenantAccessLog, () => true)
    mount(await fresh('system'), 'system', '/system', systemAccessLog, (path) => path.startsWith('/access-log'))
    expect(errors).toEqual([])
    await server.ready()

    const tokenOf = (sub: string, control = false) => server.jwt.sign(control ? { sub, scp: 'control' } : { sub, tid: ACME.id })
    return { server, asked, tokenOf }
  }

  it('lets the tenant admin read the tenant plane only, with the fields of F44 and nothing else', async () => {
    const { server, asked, tokenOf } = await reader()
    const res = await server.inject({ method: 'GET', url: '/access-log?event=login.failed', headers: bearer(tokenOf('x-anna')) })
    expect(res.statusCode).toBe(200)
    const [record] = json(res)
    expect(Object.keys(record).sort()).toEqual(
      ['code', 'event', 'flowId', 'id', 'ip', 'methods', 'occurredAt', 'outcome', 'provider', 'scope', 'sid', 'subjectId'].sort()
    )
    expect(res.headers['v-total']).toBe('1')
    const count = await server.inject({ method: 'GET', url: '/access-log/count', headers: bearer(tokenOf('x-anna')) })
    expect(json(count)).toBe(1)
    expect(asked.map(([handle, scope]) => [handle, scope])).toEqual([
      ['tenant', 'tenant'],
      ['tenant', 'tenant']
    ])
    await server.close()
  })

  it('refuses a tenant user without admin, and an anonymous caller', async () => {
    const { server, asked, tokenOf } = await reader()
    expect((await server.inject({ method: 'GET', url: '/access-log', headers: bearer(tokenOf('x-vera')) })).statusCode).toBe(403)
    expect((await server.inject({ method: 'GET', url: '/access-log/count', headers: bearer(tokenOf('x-vera')) })).statusCode).toBe(403)
    expect((await server.inject({ method: 'GET', url: '/access-log' })).statusCode).toBe(401)
    expect(asked).toEqual([])
    await server.close()
  })

  it('lets system:auditor read the control plane only, and refuses an operator without access-log', async () => {
    const { server, asked, tokenOf } = await reader()
    const res = await server.inject({ method: 'GET', url: '/system/access-log', headers: bearer(tokenOf('x-audit', true)) })
    expect(res.statusCode).toBe(200)
    expect(json(res)[0].userAgent).toBeUndefined()
    expect(asked.map(([handle, scope]) => [handle, scope])).toEqual([['control', 'control']])
    expect((await server.inject({ method: 'GET', url: '/system/access-log', headers: bearer(tokenOf('x-ops', true)) })).statusCode).toBe(403)
    // A tenant token is not a platform identity, admin or not.
    expect((await server.inject({ method: 'GET', url: '/system/access-log', headers: bearer(tokenOf('x-anna')) })).statusCode).toBe(403)
    await server.close()
  })
})
