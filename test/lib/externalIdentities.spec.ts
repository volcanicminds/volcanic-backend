/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.27: the routes of external identities. A user sees and removes its own links and nobody
// else's; an administrator lists, creates and removes them for a user; every change is an event in
// the access log.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import cookie from '@fastify/cookie'
import authHook from '../../lib/hooks/onRequest.js'
import { processRoute } from '../../lib/loader/router.js'
import * as authSchemas from '../../lib/schemas/auth.js'
import { globalParamsSchema } from '../../lib/schemas/global.js'
import { defaultResponse, onlyIdSchema } from '../../lib/schemas/common.js'
import * as own from '../../lib/api/auth/controller/identities.js'
import * as admin from '../../lib/api/users/controller/identities.js'
import frameworkFlows from '../../lib/config/authFlows.js'
import { resolveAuthFlows } from '../../lib/loader/authFlows.js'

const bag = globalThis as any
bag.log = {}

const ISSUER = 'https://login.acme-idp.test/v2.0'
const ACME = { id: 'id-acme', slug: 'acme', status: 'active' }

describe('auth · external identity routes (T-12.27)', () => {
  let saved: any
  before(() => {
    saved = { config: bag.config, roles: bag.roles, authFlows: bag.authFlows, mode: process.env.AUTH_MODE }
    bag.config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
    bag.roles = { public: { code: 'public' }, admin: { code: 'admin' }, member: { code: 'member' } }
    bag.authFlows = resolveAuthFlows(frameworkFlows, {
      tenant: {
        identify: ['password'],
        flows: [{ roles: ['*'], stages: [] }],
        providers: { acme: { type: 'oidc', issuer: ISSUER, clientId: 'c', redirectUri: 'https://api.test/r', clientSecretEnv: 'X' } }
      }
    })
    process.env.AUTH_MODE = 'BEARER'
  })
  after(() => {
    bag.config = saved.config
    bag.roles = saved.roles
    bag.authFlows = saved.authFlows
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
  })

  async function build() {
    const users: any[] = [
      { id: 'u1', externalId: 'x-anna', roles: ['admin'], blocked: false },
      { id: 'u2', externalId: 'x-bruno', roles: ['member'], blocked: false }
    ]
    const rows: any[] = [
      { id: 'l1', scope: 'tenant', subjectId: 'x-anna', provider: 'acme', issuer: ISSUER, subject: 'sub-anna', createdAt: new Date() },
      { id: 'l2', scope: 'tenant', subjectId: 'x-bruno', provider: 'acme', issuer: ISSUER, subject: 'sub-bruno', createdAt: new Date() }
    ]
    const accesses: any[] = []
    const server: any = fastify()
    await server.register(cookie, { secret: 'external-identities-cookie-secret-3' })
    await server.register(jwtValidator, { secret: 'external-identities-test-secret-32c', sign: { expiresIn: '1h' } })
    for (const schema of [...Object.values(authSchemas), globalParamsSchema, onlyIdSchema, defaultResponse] as any[]) server.addSchema(schema)
    server.decorate('userManager', {
      isImplemented: () => true,
      isValidUser: async (u: any) => !!u,
      retrieveUserByExternalId: async (_c: any, ext: string) => users.find((u) => u.externalId === ext) ?? null,
      retrieveUserById: async (_c: any, id: string) => users.find((u) => u.id === id) ?? null
    })
    server.decorate('tokenManager', { isImplemented: () => false })
    server.decorate('identityProviderManager', { isImplemented: () => false })
    server.decorate('accessLogManager', { isImplemented: () => true, record: async (_c: any, e: any) => void accesses.push(e), purgeExpired: async () => 0 })
    server.decorate('externalIdentityManager', {
      isImplemented: () => true,
      listOfSubject: async (_c: any, subjectId: string) => rows.filter((r) => r.subjectId === subjectId),
      findLink: async (_c: any, key: any) => rows.find((r) => r.provider === key.provider && r.issuer === key.issuer && r.subject === key.subject) ?? null,
      createLink: async (_c: any, data: any) => {
        const row = { id: `l${rows.length + 1}`, createdAt: new Date(), ...data }
        rows.push(row)
        return row
      },
      removeLink: async (_c: any, id: string, subjectId: string) => {
        const at = rows.findIndex((r) => r.id === id && r.subjectId === subjectId)
        if (at < 0) return false
        rows.splice(at, 1)
        return true
      }
    })
    server.addHook('onRequest', async (req: any) => {
      req.control = { kind: 'control' }
      req.tenant = { kind: 'tenant', tenantId: ACME.id }
      req.tenantInfo = ACME
    })
    server.addHook('onRequest', authHook)

    const errors: string[] = []
    const mount = async (dir: string, prefix: string, controller: any) => {
      const file = (await import(`../../lib/api/${dir}/routes.js?fresh=${Date.now()}`)).default
      file.routes.forEach((r: any, i: number) => {
        if (!r.path.includes('identities')) return
        const configured: any = processRoute(r, i, `${dir}/routes.ts`, dir, '', file.config, ['global.isAuthenticated'], [], errors)
        server.route({
          method: r.method,
          url: prefix + r.path,
          schema: { response: r.config.response, ...(r.config.params ? { params: r.config.params } : {}), ...(r.config.body ? { body: r.config.body } : {}) },
          config: { tenantContext: true, requiredRoles: configured.roles },
          handler: controller[r.handler.split('.')[1]]
        })
      })
    }
    await mount('auth', '/auth', own)
    await mount('users', '/users', admin)
    expect(errors).toEqual([])
    await server.ready()
    const as = (sub: string) => ({ authorization: `Bearer ${server.jwt.sign({ sub, tid: ACME.id })}` })
    return { server, rows, accesses, as }
  }

  it("lists the caller's own links, without the account's external id", async () => {
    const { server, as } = await build()
    const res = await server.inject({ method: 'GET', url: '/auth/identities', headers: as('x-bruno') })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual([expect.objectContaining({ id: 'l2', provider: 'acme', issuer: ISSUER, subject: 'sub-bruno' })])
    expect(res.body).not.toContain('x-bruno')
    await server.close()
  })

  it('removes an own link, and answers 404 for somebody else’s', async () => {
    const { server, rows, accesses, as } = await build()
    expect((await server.inject({ method: 'DELETE', url: '/auth/identities/l1', headers: as('x-bruno') })).statusCode).toBe(404)
    expect(rows.map((r) => r.id)).toEqual(['l1', 'l2'])
    expect((await server.inject({ method: 'DELETE', url: '/auth/identities/l2', headers: as('x-bruno') })).statusCode).toBe(200)
    expect(rows.map((r) => r.id)).toEqual(['l1'])
    expect(accesses).toEqual([expect.objectContaining({ event: 'idp.unlinked', scope: 'tenant', subjectId: 'x-bruno', provider: 'acme' })])
    await server.close()
  })

  it('lets the admin link, list and unlink, and refuses a member', async () => {
    const { server, accesses, as } = await build()
    const link = { provider: 'acme', issuer: ISSUER, subject: 'sub-new' }
    expect((await server.inject({ method: 'POST', url: '/users/u2/identities', payload: link, headers: as('x-bruno') })).statusCode).toBe(403)

    const created = await server.inject({ method: 'POST', url: '/users/u2/identities', payload: link, headers: as('x-anna') })
    expect(created.statusCode).toBe(201)
    const id = JSON.parse(created.body).id
    const listed = JSON.parse((await server.inject({ method: 'GET', url: '/users/u2/identities', headers: as('x-anna') })).body)
    expect(listed.map((r: any) => r.subject)).toEqual(['sub-bruno', 'sub-new'])
    expect((await server.inject({ method: 'DELETE', url: `/users/u2/identities/${id}`, headers: as('x-anna') })).statusCode).toBe(200)
    // A link of another user, named under this one, is not found.
    expect((await server.inject({ method: 'DELETE', url: '/users/u2/identities/l1', headers: as('x-anna') })).statusCode).toBe(404)
    expect(accesses.map((a) => [a.event, a.subjectId])).toEqual([
      ['idp.linked', 'x-bruno'],
      ['idp.unlinked', 'x-bruno']
    ])
    await server.close()
  })

  it('refuses an identity already linked, to anyone, and a provider this tenant does not have', async () => {
    const { server, as } = await build()
    const taken = await server.inject({ method: 'POST', url: '/users/u2/identities', payload: { provider: 'acme', issuer: ISSUER, subject: 'sub-anna' }, headers: as('x-anna') })
    expect(taken.statusCode).toBe(409)
    expect(JSON.parse(taken.body).code).toBe('IDP_LINK_TAKEN')
    const unknown = await server.inject({ method: 'POST', url: '/users/u2/identities', payload: { provider: 'google', issuer: ISSUER, subject: 's' }, headers: as('x-anna') })
    expect(unknown.statusCode).toBe(400)
    expect(JSON.parse(unknown.body).code).toBe('IDP_UNKNOWN_PROVIDER')
    expect((await server.inject({ method: 'GET', url: '/users/nobody/identities', headers: as('x-anna') })).statusCode).toBe(404)
    await server.close()
  })
})
