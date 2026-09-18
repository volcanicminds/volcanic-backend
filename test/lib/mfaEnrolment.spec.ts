/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Enrolment is for a subject without a second factor, on both planes.
//
// The pre-auth token that a first factor buys opens the enrolment routes, so that a MANDATORY
// policy can enrol at first login. Without a check on the subject, the same token let whoever
// had the password alone enrol a secret of their own over the victim's, and come back with a
// session: directly from the tenant `enable`, through `verify` on the control plane. These tests
// drive that attack through the real hook and the real handlers, and assert it stops at 409.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import cookie from '@fastify/cookie'
import authHook from '../../lib/hooks/onRequest.js'
import { login, mfaSetup, mfaEnable } from '../../lib/api/auth/controller/auth.js'
import {
  login as systemLogin,
  mfaSetup as systemMfaSetup,
  mfaEnable as systemMfaEnable
} from '../../lib/api/system/controller/systemAuth.js'
import { fakeSessionStore } from './fixtures/sessionStore.js'

const SECRET = 'mfa-enrolment-test-secret-32-chars!!'
const ACME = { id: 'id-acme', slug: 'acme', status: 'active' }
const USER: any = { id: 'u1', externalId: 'u-ext-1', email: 'anna@acme.test', roles: ['admin'], confirmed: true, blocked: false }
const MFA_USER: any = { ...USER, id: 'u2', externalId: 'u-ext-2', email: 'mfa@acme.test', mfaEnabled: true }
const MFA_OPERATOR: any = {
  id: 's1',
  externalId: 's-ext-1',
  email: 'root@system.test',
  roles: ['system:admin'],
  blocked: false,
  mfaEnabled: true
}
const PUBLIC = [{ code: 'public' }]

;(global as any).log = {}

async function build() {
  const users = [USER, MFA_USER]
  const written: Array<{ plane: string; id: string; secret: string }> = []

  const server: any = fastify()
  await server.register(cookie, { secret: 'mfa-enrolment-cookie-secret-32-chars' })
  await server.register(jwtValidator, { secret: SECRET, sign: { expiresIn: '7200s' } })
  server.decorate('sessionManager', fakeSessionStore().manager)
  server.decorate('userManager', {
    isImplemented: () => true,
    isValidUser: async (u: any) => !!u && !u.blocked,
    isPasswordToBeChanged: () => false,
    retrieveUserByPassword: async (_c: any, email: string, pw: string) => (pw === 'pw' ? users.find((u) => u.email === email) ?? null : null),
    retrieveUserByExternalId: async (_c: any, ext: string) => users.find((u) => u.externalId === ext) ?? null,
    updateUserById: async () => ({}),
    saveMfaSecret: async (_c: any, id: string, secret: string) => written.push({ plane: 'tenant', id, secret }),
    enableMfa: async () => ({})
  })
  server.decorate('systemUserManager', {
    isImplemented: () => true,
    retrieveSystemUserByPassword: async (_c: any, email: string, pw: string) =>
      email === MFA_OPERATOR.email && pw === 'pw' ? MFA_OPERATOR : null,
    retrieveSystemUserByExternalId: async (_c: any, ext: string) => (ext === MFA_OPERATOR.externalId ? MFA_OPERATOR : null),
    saveMfaSecret: async (_c: any, id: string, secret: string) => written.push({ plane: 'control', id, secret }),
    enableMfa: async () => ({}),
    recordMfaCounter: async () => ({})
  })
  server.decorate('tenantManager', { isImplemented: () => true, getTenant: async () => ACME })
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

  const tenant = { config: { tenantContext: true, requiredRoles: PUBLIC } }
  const control = { config: { tenantContext: false, requiredRoles: PUBLIC } }
  server.post('/auth/login', tenant, login)
  server.post('/auth/mfa/setup', tenant, mfaSetup)
  server.post('/auth/mfa/enable', tenant, mfaEnable)
  server.post('/system/auth/login', control, systemLogin)
  server.post('/system/auth/mfa/setup', control, systemMfaSetup)
  server.post('/system/auth/mfa/enable', control, systemMfaEnable)

  await server.ready()
  return { server, written }
}

const cookieOf = (res: any, name: string) => res.cookies.find((c: any) => c.name === name)
const codeOf = (res: any) => JSON.parse(res.body)?.code

async function preAuth(server: any, url: string, email: string, cookieName: string) {
  const res = await server.inject({ method: 'POST', url, payload: { email, password: 'pw' } })
  expect(res.statusCode).toBe(202)
  return cookieOf(res, cookieName).value as string
}

describe('mfa enrolment · only for a subject without a second factor', () => {
  let saved: any

  before(() => {
    saved = { mode: process.env.AUTH_MODE, roles: (global as any).roles, config: (global as any).config }
    ;(global as any).roles = { public: { code: 'public', name: 'Public' }, admin: { code: 'admin', name: 'Admin' } }
    ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
    delete process.env.AUTH_MODE
  })

  after(() => {
    ;(global as any).roles = saved.roles
    ;(global as any).config = saved.config
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
  })

  it('refuses the tenant enable with 409 MFA_ALREADY_ENABLED, and overwrites nothing', async () => {
    const { server, written } = await build()
    const pre = await preAuth(server, '/auth/login', MFA_USER.email, 'auth_token')

    const res = await server.inject({
      method: 'POST',
      url: '/auth/mfa/enable',
      cookies: { auth_token: pre },
      payload: { secret: 'ATTACKER-SECRET', token: '123456' }
    })
    expect(res.statusCode).toBe(409)
    expect(codeOf(res)).toBe('MFA_ALREADY_ENABLED')
    expect(cookieOf(res, 'refresh_token')).toBeUndefined()
    expect(written).toEqual([])
    await server.close()
  })

  it('refuses the tenant setup too, so no new secret is even offered', async () => {
    const { server } = await build()
    const pre = await preAuth(server, '/auth/login', MFA_USER.email, 'auth_token')
    const res = await server.inject({ method: 'POST', url: '/auth/mfa/setup', cookies: { auth_token: pre } })
    expect(res.statusCode).toBe(409)
    expect(codeOf(res)).toBe('MFA_ALREADY_ENABLED')
    await server.close()
  })

  it('still enrols a subject without a factor', async () => {
    const { server, written } = await build()
    const first = await server.inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: 'pw' } })
    expect(first.statusCode).toBe(200)
    const session = cookieOf(first, 'auth_token').value

    const res = await server.inject({
      method: 'POST',
      url: '/auth/mfa/enable',
      cookies: { auth_token: session },
      payload: { secret: 'NEW-SECRET', token: '123456' }
    })
    expect(res.statusCode).toBe(200)
    expect(written).toEqual([{ plane: 'tenant', id: USER.id, secret: 'NEW-SECRET' }])
    await server.close()
  })

  it('refuses the platform setup and enable for an operator who already has a factor', async () => {
    const { server, written } = await build()
    const pre = await preAuth(server, '/system/auth/login', MFA_OPERATOR.email, 'control_token')

    const setup = await server.inject({ method: 'POST', url: '/system/auth/mfa/setup', cookies: { control_token: pre } })
    expect(setup.statusCode).toBe(409)
    expect(codeOf(setup)).toBe('MFA_ALREADY_ENABLED')

    const enable = await server.inject({
      method: 'POST',
      url: '/system/auth/mfa/enable',
      cookies: { control_token: pre },
      payload: { secret: 'ATTACKER-SECRET', token: '123456' }
    })
    expect(enable.statusCode).toBe(409)
    expect(codeOf(enable)).toBe('MFA_ALREADY_ENABLED')
    expect(written).toEqual([])
    await server.close()
  })
})
