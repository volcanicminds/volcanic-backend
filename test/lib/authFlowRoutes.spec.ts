/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.15, T-12.16, T-12.19 to T-12.21: the `/auth/flow/*` routes of both planes, over HTTP.
//
// The routes are mounted from the framework's own route files, with their real schemas, their real
// handlers and the real authentication hook, because two of the properties in doubt live exactly
// there: what a response schema lets through (a 202 filtered to nothing would be a login that
// cannot continue), and what the gatekeeper does with a credential that is not a JWT.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import cookie from '@fastify/cookie'
import authHook from '../../lib/hooks/onRequest.js'
import tenantRoutes from '../../lib/api/auth/routes.js'
import systemRoutes from '../../lib/api/system/routes.js'
import * as tenantFlow from '../../lib/api/auth/controller/flow.js'
import * as systemFlow from '../../lib/api/system/controller/systemFlow.js'
import * as authSchemas from '../../lib/schemas/auth.js'
import { defaultResponse } from '../../lib/schemas/common.js'
import frameworkFlows from '../../lib/config/authFlows.js'
import { resolveAuthFlows } from '../../lib/loader/authFlows.js'
import { buildAuthenticatorRegistry } from '../../lib/auth/registry.js'
import { currentStep } from '../../lib/util/mfaCounter.js'
import { fakeSessionStore } from './fixtures/sessionStore.js'
import { fakeFlowStore } from './fixtures/flowStore.js'

const SECRET = 'auth-flow-routes-test-secret-32-chars'
const COOKIE_SECRET = 'auth-flow-routes-cookie-secret-32ch'
const ACME = { id: 'id-acme', slug: 'acme', status: 'active' }
const PUBLIC = [{ code: 'public' }]

const bag = globalThis as any
bag.log = {}

function people() {
  const users: any[] = [
    { id: 'u1', externalId: 'x-anna', email: 'anna@acme.test', password: 'HASH', roles: ['admin'], confirmed: true, blocked: false },
    { id: 'u2', externalId: 'x-mfa', email: 'mfa@acme.test', roles: [{ code: 'admin' }], confirmed: true, blocked: false, mfaEnabled: true },
    { id: 'u3', externalId: 'x-new', email: 'new@acme.test', roles: ['admin'], confirmed: false, blocked: false },
    { id: 'u4', externalId: 'x-off', email: 'off@acme.test', roles: ['admin'], confirmed: true, blocked: true },
    { id: 'u5', externalId: 'x-old', email: 'old@acme.test', roles: ['admin'], confirmed: true, blocked: false, expired: true }
  ]
  const operators: any[] = [
    { id: 's1', externalId: 'x-root', email: 'root@system.test', password: 'HASH', roles: ['system:admin'], blocked: false },
    { id: 's2', externalId: 'x-ops', email: 'ops@system.test', roles: ['system:admin'], blocked: false, mfaEnabled: true }
  ]
  const secrets: Record<string, string> = { u2: 'SECRET-2', s2: 'SECRET-S2' }
  return { users, operators, secrets }
}

async function build(over: { accessLog?: any } = {}) {
  const { users, operators, secrets } = people()
  const sessions = fakeSessionStore()
  const flows = fakeFlowStore()
  const accesses: any[] = []
  let rotations = 0

  const server: any = fastify()
  await server.register(cookie, { secret: COOKIE_SECRET })
  await server.register(jwtValidator, { secret: SECRET, sign: { expiresIn: '1h' } })
  for (const schema of Object.values(authSchemas)) server.addSchema(schema)
  server.addSchema(defaultResponse)

  server.decorate('userManager', {
    isImplemented: () => true,
    isValidUser: async (u: any) => !!u,
    isPasswordToBeChanged: (u: any) => Boolean(u?.expired),
    retrieveUserByPassword: async (_c: any, email: string, pw: string) => (pw === 'pw' ? (users.find((u) => u.email === email) ?? null) : null),
    retrieveUserByEmail: async (_c: any, email: string) => users.find((u) => u.email === email) ?? null,
    retrieveUserById: async (_c: any, id: string) => users.find((u) => u.id === id) ?? null,
    retrieveUserByExternalId: async (_c: any, ext: string) => users.find((u) => u.externalId === ext) ?? null,
    retrieveMfaSecret: async (_c: any, id: string) => secrets[id] ?? null,
    updateUserById: async (_c: any, id: string, data: any) => Object.assign(users.find((u) => u.id === id), data),
    saveMfaSecret: async (_c: any, id: string, secret: string) => ((secrets[id] = secret), true),
    enableMfa: async (_c: any, id: string) => ((users.find((u) => u.id === id).mfaEnabled = true), true),
    resetExternalId: async (_c: any, id: string) => {
      const user = users.find((u) => u.id === id)
      user.externalId = `x-rotated-${++rotations}`
      return user.externalId
    }
  })
  server.decorate('systemUserManager', {
    isImplemented: () => true,
    retrieveSystemUserByPassword: async (_c: any, email: string, pw: string) => (pw === 'pw' ? (operators.find((o) => o.email === email) ?? null) : null),
    retrieveSystemUserByExternalId: async (_c: any, ext: string) => operators.find((o) => o.externalId === ext) ?? null,
    retrieveSystemUserById: async (_c: any, id: string) => operators.find((o) => o.id === id) ?? null,
    retrieveMfaSecret: async (_c: any, id: string) => secrets[id] ?? null,
    recordMfaCounter: async (_c: any, id: string, counter: number) => ((operators.find((o) => o.id === id).mfaLastUsedCounter = counter), true),
    saveMfaSecret: async (_c: any, id: string, secret: string) => ((secrets[id] = secret), true),
    enableMfa: async (_c: any, id: string) => ((operators.find((o) => o.id === id).mfaEnabled = true), true)
  })
  // A delta of zero for the code of the secret it was given: a real verifier's answer to a code
  // typed in its own window.
  server.decorate('mfaManager', {
    isImplemented: () => true,
    generateSetup: async () => ({ secret: 'ENROLLED-SECRET', uri: 'otpauth://totp/app', qrCode: 'data:image/png;base64,AAAA' }),
    verify: (code: string, secret: string) => (code === `${secret}-ok` ? 0 : null)
  })
  server.decorate('sessionManager', sessions.manager)
  server.decorate('authFlowManager', flows.manager)
  server.decorate('accessLogManager', over.accessLog ?? { isImplemented: () => true, record: async (_c: any, entry: any) => (accesses.push(entry), entry) })
  for (const name of ['externalIdentityManager', 'identityProviderManager', 'challengeDeliveryManager']) {
    server.decorate(name, { isImplemented: () => false })
  }
  server.decorate('tokenManager', { isImplemented: () => false })
  server.decorate('authRegistry', buildAuthenticatorRegistry())

  // What the tenant resolution would have done: every tenant route of this server is acme's.
  server.addHook('onRequest', async (req: any) => {
    req.control = { kind: 'control' }
    if (req.routeOptions?.config?.tenantContext !== false) {
      req.tenant = { kind: 'tenant', tenantId: ACME.id }
      req.tenantInfo = ACME
    }
  })
  server.addHook('onRequest', authHook)

  const mount = (prefix: string, file: any, controller: any, tenantContext: boolean) => {
    for (const route of file.routes.filter((r: any) => r.path.includes('flow/'))) {
      const schema: any = {}
      if (route.config?.body) schema.body = route.config.body
      if (route.config?.response) schema.response = route.config.response
      server.route({
        method: route.method,
        url: prefix + route.path,
        schema,
        config: { tenantContext, requiredRoles: PUBLIC, tenantFrom: route.config?.tenantFrom },
        handler: controller[route.handler.split('.')[1]]
      })
    }
  }
  mount('/auth', tenantRoutes, tenantFlow, true)
  mount('/system', systemRoutes, systemFlow, false)
  server.get('/orders', { config: { tenantContext: true, requiredRoles: [{ code: 'admin' }] } }, async (req: any) => ({ who: req.user?.email }))

  await server.ready()
  return { server, users, operators, secrets, sessions, flows, accesses }
}

const json = (res: any) => JSON.parse(res.body)
const cookieOf = (res: any, name: string) => res.cookies.find((c: any) => c.name === name)
const start = (server: any, email: string, over: any = {}, prefix = '/auth') =>
  server.inject({ method: 'POST', url: `${prefix}/flow/start`, payload: { method: 'password', email, password: 'pw', ...over } })
const step = (server: any, flow: string | null, payload: any, prefix = '/auth', headers: any = {}) =>
  server.inject({ method: 'POST', url: `${prefix}/flow/step`, payload: { ...(flow ? { flow } : {}), ...payload }, headers })

const UNIFORM = { statusCode: 401, error: 'Unauthorized', code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' }

describe('auth · the flow routes of both planes (T-12.15, T-12.16, T-12.19 to T-12.21)', () => {
  let saved: any
  before(() => {
    saved = { config: bag.config, roles: bag.roles, authFlows: bag.authFlows, mode: process.env.AUTH_MODE }
    bag.roles = { public: { code: 'public' }, admin: { code: 'admin' } }
    bag.authFlows = resolveAuthFlows(frameworkFlows)
    process.env.AUTH_MODE = 'BEARER'
  })
  beforeEach(() => {
    bag.config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
  })
  after(() => {
    bag.config = saved.config
    bag.roles = saved.roles
    bag.authFlows = saved.authFlows
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
  })

  describe('the tenant plane, bearer', () => {
    it('lists the identifiers of the plane without writing anything', async () => {
      const { server, flows } = await build()
      const res = await server.inject({ method: 'GET', url: '/auth/flow/options' })
      expect(res.statusCode).toBe(200)
      // `invite`: the deployment's default when nobody chose (F49).
      expect(json(res)).toEqual({ options: [{ id: 'password', kind: 'identifier' }], accountCreation: 'invite' })
      expect(flows.rows.size).toBe(0)
      await server.close()
    })

    it('closes a password login in one request, with the body of the old login and the method on the session', async () => {
      const { server, sessions } = await build()
      const res = await start(server, 'anna@acme.test')
      expect(res.statusCode).toBe(200)
      const body = json(res)
      expect(body).toMatchObject({ externalId: 'x-anna', email: 'anna@acme.test', roles: ['admin'], securityPolicy: { mfaPolicy: 'OPTIONAL' } })
      expect(typeof body.token).toBe('string')
      expect(typeof body.refreshToken).toBe('string')
      // The response schema is the old login's: the row's other columns do not leave the process.
      expect(body.password).toBeUndefined()
      expect(server.jwt.decode(body.token)).toMatchObject({ sub: 'x-anna', tid: 'id-acme' })
      expect([...sessions.rows.values()].map((row: any) => row.authMethods)).toEqual([['password']])
      await server.close()
    })

    it('gives every failure before a verified password the one uniform refusal (D-17, T-12.19)', async () => {
      const { server } = await build()
      for (const email of ['nobody@acme.test', 'new@acme.test', 'off@acme.test']) {
        const res = await start(server, email)
        expect(res.statusCode).toBe(401)
        expect(json(res)).toEqual(UNIFORM)
      }
      const wrong = await start(server, 'anna@acme.test', { password: 'nope' })
      expect(wrong.statusCode).toBe(401)
      expect(json(wrong)).toEqual(UNIFORM)

      // Reached only after the password verified, so it tells nothing the caller did not prove.
      const expired = await start(server, 'old@acme.test')
      expect(expired.statusCode).toBe(403)
      expect(json(expired).code).toBe('PASSWORD_TO_BE_CHANGED')

      const malformed = await start(server, 'not-an-email')
      expect(malformed.statusCode).toBe(400)
      expect(json(malformed).code).toBe('AUTH_INPUT_INVALID')
      await server.close()
    })

    it('answers 202 with the credential and the stage, and a TOTP code then closes the login (T-12.20)', async () => {
      const { server, sessions, users } = await build()
      const first = await start(server, 'mfa@acme.test')
      expect(first.statusCode).toBe(202)
      const partial = json(first)
      expect(partial.flow).toMatch(/^vf1\.id-acme\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
      expect(new Date(partial.expiresAt).getTime()).toBeGreaterThan(Date.now())
      expect(partial.stage).toEqual({ options: [{ id: 'totp', kind: 'verifier' }] })

      const wrong = await step(server, partial.flow, { method: 'totp', code: '000000' })
      expect(wrong.statusCode).toBe(401)
      expect(json(wrong)).toMatchObject({ code: 'FLOW_CODE_INVALID', remaining: 4 })

      const done = await step(server, partial.flow, { method: 'totp', code: 'SECRET-2-ok' })
      expect(done.statusCode).toBe(200)
      expect(json(done)).toMatchObject({ externalId: 'x-mfa', roles: ['admin'] })
      expect(typeof json(done).token).toBe('string')
      expect([...sessions.rows.values()].map((row: any) => row.authMethods)).toEqual([['password', 'totp']])
      expect(users[1].mfaLastUsedCounter).toBe(currentStep())
      await server.close()
    })

    it('refuses a replayed TOTP step as a wrong code, spending an attempt of the flow', async () => {
      const { server } = await build()
      const once = json(await start(server, 'mfa@acme.test')).flow
      expect((await step(server, once, { method: 'totp', code: 'SECRET-2-ok' })).statusCode).toBe(200)

      const again = json(await start(server, 'mfa@acme.test')).flow
      const replay = await step(server, again, { method: 'totp', code: 'SECRET-2-ok' })
      expect(replay.statusCode).toBe(401)
      expect(json(replay)).toMatchObject({ code: 'FLOW_CODE_INVALID', remaining: 4 })
      await server.close()
    })

    it('ends the flow after five wrong codes, and the right one then finds nothing', async () => {
      const { server } = await build()
      const flow = json(await start(server, 'mfa@acme.test')).flow
      for (let i = 0; i < 4; i++) expect(json(await step(server, flow, { method: 'totp', code: `bad-${i}` })).code).toBe('FLOW_CODE_INVALID')
      expect(json(await step(server, flow, { method: 'totp', code: 'bad-4' })).code).toBe('FLOW_ATTEMPTS_EXHAUSTED')
      expect(json(await step(server, flow, { method: 'totp', code: 'SECRET-2-ok' })).code).toBe('FLOW_REQUIRED')
      await server.close()
    })

    it('enrols a subject with no factor inside the flow under MANDATORY, the secret shown once (T-12.21)', async () => {
      const { server, users, secrets, flows, accesses } = await build()
      bag.config.options.mfa_policy = 'MANDATORY'

      const first = json(await start(server, 'anna@acme.test'))
      expect(first.stage).toEqual({ options: [{ id: 'totp', kind: 'verifier', enrol: true }] })

      const enrol = await step(server, first.flow, { method: 'totp', action: 'enrol' })
      expect(enrol.statusCode).toBe(202)
      expect(json(enrol).stage.options[0].enrol).toEqual({ secret: 'ENROLLED-SECRET', uri: 'otpauth://totp/app', qrCode: 'data:image/png;base64,AAAA' })
      // Waiting in the row, not on the subject, until a code proves the authenticator holds it.
      expect(secrets.u1).toBeUndefined()
      expect([...flows.rows.values()].find((r: any) => r.subjectId === 'x-anna')?.external).toEqual({ enrolmentSecret: 'ENROLLED-SECRET' })

      const wrong = await step(server, first.flow, { method: 'totp', code: 'nope' })
      expect(wrong.statusCode).toBe(401)
      expect(wrong.body).not.toContain('ENROLLED-SECRET')

      const done = await step(server, first.flow, { method: 'totp', code: 'ENROLLED-SECRET-ok' })
      expect(done.statusCode).toBe(200)
      expect(done.body).not.toContain('ENROLLED-SECRET')
      expect(secrets.u1).toBe('ENROLLED-SECRET')
      expect(users[0].mfaEnabled).toBe(true)
      expect(json(done).securityPolicy).toEqual({ mfaPolicy: 'MANDATORY' })
      expect(accesses.map((a) => a.event)).toEqual(['flow.started', 'stage.failed', 'stage.passed', 'mfa.enrolled', 'login.succeeded'])
      expect(accesses[1]).toMatchObject({ outcome: 'failure', code: 'FLOW_CODE_INVALID', subjectId: 'x-anna', scope: 'tenant', ip: '127.0.0.1' })
      // The retired row keeps no secret at all.
      expect(JSON.stringify([...flows.rows.values()])).not.toContain('ENROLLED-SECRET')
      await server.close()
    })

    it('refuses to enrol a second factor inside the flow for a subject who has one', async () => {
      const { server } = await build()
      bag.config.options.mfa_policy = 'MANDATORY'
      const flow = json(await start(server, 'mfa@acme.test')).flow
      const res = await step(server, flow, { method: 'totp', action: 'enrol' })
      expect(res.statusCode).toBe(403)
      expect(json(res).code).toBe('FLOW_ENROLMENT_REFUSED')
      await server.close()
    })

    it('rotates the external id once, at the end, and issues the session to the new one (F45)', async () => {
      const { server, sessions } = await build()
      bag.config.options.reset_external_id_on_login = true
      const flow = json(await start(server, 'mfa@acme.test')).flow
      const done = json(await step(server, flow, { method: 'totp', code: 'SECRET-2-ok' }))
      expect(done.externalId).toBe('x-rotated-1')
      expect(server.jwt.decode(done.token).sub).toBe('x-rotated-1')
      expect([...sessions.rows.values()].map((row: any) => row.subjectId)).toEqual(['x-rotated-1'])
      // The new identity authenticates; the old one is gone.
      const orders = await server.inject({ method: 'GET', url: '/orders', headers: { authorization: `Bearer ${done.token}` } })
      expect(json(orders)).toEqual({ who: 'mfa@acme.test' })
      await server.close()
    })

    it('never reads the flow credential from the Authorization header, and the hook never takes it for a session', async () => {
      const { server } = await build()
      const flow = json(await start(server, 'mfa@acme.test')).flow
      const viaHeader = await step(server, null, { method: 'totp', code: 'SECRET-2-ok' }, '/auth', { authorization: `Bearer ${flow}` })
      expect(viaHeader.statusCode).toBe(401)
      expect(json(viaHeader).code).toBe('FLOW_REQUIRED')
      const orders = await server.inject({ method: 'GET', url: '/orders', headers: { authorization: `Bearer ${flow}` } })
      expect(orders.statusCode).toBe(401)
      await server.close()
    })

    it('cancels silently, whatever it is given', async () => {
      const { server } = await build()
      const flow = json(await start(server, 'mfa@acme.test')).flow
      for (const payload of [{ flow }, { flow: 'garbage' }, {}]) {
        const res = await server.inject({ method: 'POST', url: '/auth/flow/cancel', payload })
        expect(res.statusCode).toBe(200)
        expect(json(res)).toEqual({ ok: true })
      }
      expect(json(await step(server, flow, { method: 'totp', code: 'SECRET-2-ok' })).code).toBe('FLOW_REQUIRED')
      await server.close()
    })

    it('leaves a successful login identical when the access log cannot be written', async () => {
      const { server } = await build({ accessLog: { isImplemented: () => true, record: async () => Promise.reject(new Error('disk full')) } })
      const res = await start(server, 'anna@acme.test')
      expect(res.statusCode).toBe(200)
      expect(json(res).externalId).toBe('x-anna')
      await server.close()
    })
  })

  describe('the tenant plane, cookie', () => {
    before(() => {
      process.env.AUTH_MODE = 'COOKIE'
    })
    after(() => {
      process.env.AUTH_MODE = 'BEARER'
    })

    it('keeps the credential in a cookie of its own, scoped to the flow routes, and ignores the body', async () => {
      const { server } = await build()
      const first = await start(server, 'mfa@acme.test')
      expect(first.statusCode).toBe(202)
      expect(json(first).flow).toBeNull()
      const jar = cookieOf(first, 'auth_flow')
      expect(jar).toMatchObject({ path: '/auth/flow', httpOnly: true, sameSite: 'Strict' })
      expect(server.unsignCookie(jar.value).value).toMatch(/^vf1\.id-acme\./)

      // The credential in the body is the bearer channel, and this deployment is not bearer.
      const inBody = await step(server, server.unsignCookie(jar.value).value, { method: 'totp', code: 'SECRET-2-ok' })
      expect(json(inBody).code).toBe('FLOW_REQUIRED')

      const done = await step(server, null, { method: 'totp', code: 'SECRET-2-ok' }, '/auth', { cookie: `auth_flow=${jar.value}` })
      expect(done.statusCode).toBe(200)
      expect(json(done).token).toBeNull()
      expect(cookieOf(done, 'auth_token')).toBeDefined()
      // Spent, and forgotten by the browser too.
      expect(cookieOf(done, 'auth_flow')).toMatchObject({ value: '', path: '/auth/flow' })
      await server.close()
    })
  })

  describe('the control plane (T-12.16)', () => {
    it('answers a failed platform login 401 AUTH_INVALID_CREDENTIALS, as the tenant plane does', async () => {
      const { server } = await build()
      const res = await start(server, 'root@system.test', { password: 'nope' }, '/system/auth')
      expect(res.statusCode).toBe(401)
      expect(json(res)).toEqual(UNIFORM)
      await server.close()
    })

    it('issues a control session to an operator, never to a user of a tenant', async () => {
      const { server, sessions } = await build()
      const ok = await start(server, 'root@system.test', {}, '/system/auth')
      expect(ok.statusCode).toBe(200)
      const body = json(ok)
      expect(body.password).toBeUndefined()
      expect(server.jwt.decode(body.token)).toMatchObject({ sub: 'x-root', scp: 'control' })
      expect(server.jwt.decode(body.token).tid).toBeUndefined()
      expect([...sessions.rows.values()]).toMatchObject([{ scope: 'control', authMethods: ['password'] }])

      const tenantUser = await start(server, 'anna@acme.test', {}, '/system/auth')
      expect(tenantUser.statusCode).toBe(401)
      expect(json(tenantUser).code).toBe('AUTH_INVALID_CREDENTIALS')
      await server.close()
    })

    it('refuses the flow credential of one plane on the other', async () => {
      const { server } = await build()
      const tenantFlowCredential = json(await start(server, 'mfa@acme.test')).flow
      const controlFlowCredential = json(await start(server, 'ops@system.test', {}, '/system/auth')).flow
      expect(controlFlowCredential).toMatch(/^vf1\.ctl\./)

      const onControl = await step(server, tenantFlowCredential, { method: 'totp', code: 'SECRET-2-ok' }, '/system/auth')
      expect(onControl.statusCode).toBe(403)
      expect(json(onControl).code).toBe('TENANT_MISMATCH')
      const onTenant = await step(server, controlFlowCredential, { method: 'totp', code: 'SECRET-S2-ok' })
      expect(onTenant.statusCode).toBe(403)
      expect(json(onTenant).code).toBe('TENANT_MISMATCH')

      const done = await step(server, controlFlowCredential, { method: 'totp', code: 'SECRET-S2-ok' }, '/system/auth')
      expect(done.statusCode).toBe(200)
      expect(server.jwt.decode(json(done).token)).toMatchObject({ sub: 'x-ops', scp: 'control' })
      await server.close()
    })

    it('enrols an operator with no factor inside the flow under a MANDATORY platform policy', async () => {
      const { server, operators, secrets } = await build()
      bag.config.options.system_mfa_policy = 'MANDATORY'
      const first = json(await start(server, 'root@system.test', {}, '/system/auth'))
      expect(first.stage.options).toEqual([{ id: 'totp', kind: 'verifier', enrol: true }])
      expect(json(await step(server, first.flow, { method: 'totp', action: 'enrol' }, '/system/auth')).stage.options[0].enrol.secret).toBe('ENROLLED-SECRET')
      const done = await step(server, first.flow, { method: 'totp', code: 'ENROLLED-SECRET-ok' }, '/system/auth')
      expect(done.statusCode).toBe(200)
      expect(json(done).securityPolicy).toEqual({ mfaPolicy: 'MANDATORY' })
      expect(secrets.s1).toBe('ENROLLED-SECRET')
      expect(operators[0]).toMatchObject({ mfaEnabled: true, mfaLastUsedCounter: currentStep() })
      await server.close()
    })

    it('answers 503 on the platform routes of a build without platform identities', async () => {
      const { server } = await build()
      server.systemUserManager.isImplemented = () => false
      const res = await start(server, 'root@system.test', {}, '/system/auth')
      expect(res.statusCode).toBe(503)
      expect(json(res).code).toBe('SYSTEM_USERS_NOT_AVAILABLE')
      await server.close()
    })
  })

  describe('the declarations', () => {
    const limitOf = (file: any, path: string) => file.routes.find((r: any) => r.path === path)?.rateLimit
    it('puts the rate limits of F44 on both planes, and none on cancel', () => {
      for (const [file, prefix] of [[tenantRoutes, '/flow'], [systemRoutes, '/auth/flow']] as const) {
        expect(limitOf(file, `${prefix}/options`)).toEqual({ max: 60, timeWindow: 60000 })
        expect(limitOf(file, `${prefix}/start`)).toEqual({ max: 10, timeWindow: 60000 })
        expect(limitOf(file, `${prefix}/step`)).toEqual({ max: 10, timeWindow: 60000 })
        expect(limitOf(file, `${prefix}/challenge`)).toEqual({ max: 5, timeWindow: 60000 })
        expect(limitOf(file, `${prefix}/return/:method`)).toEqual({ max: 20, timeWindow: 60000 })
        expect(limitOf(file, `${prefix}/cancel`)).toBeUndefined()
      }
    })

    it('limits every tenant route that takes a secret, and renewal loosely (S5)', () => {
      const credential = { max: 10, timeWindow: 60000 }
      for (const path of [
        '/register',
        '/unregister',
        '/change-password',
        '/confirm-email',
        '/forgot-password',
        '/reset-password'
      ]) {
        expect([path, limitOf(tenantRoutes, path)]).toEqual([path, credential])
      }
      expect(limitOf(tenantRoutes, '/refresh-token')).toEqual({ max: 60, timeWindow: 60000 })
      expect(limitOf(systemRoutes, '/auth/refresh-token')).toEqual(credential)
    })
  })
})
