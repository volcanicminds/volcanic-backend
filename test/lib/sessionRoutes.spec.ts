/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-11.14: the sessions of the caller, listed and closed one at a time.
//
// The registry was built for rotation, and these two routes are what it makes possible: seeing
// where an account is logged in, and closing one device without closing the others. What the
// tests hold to is the part that is easy to get wrong in a hurry — a `sid` is a handle and not
// an authorisation, so somebody else's session must answer exactly what a session that does not
// exist answers, and closing the session you are speaking from has to look like a logout.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import cookie from '@fastify/cookie'
import authHook from '../../lib/hooks/onRequest.js'
import { login, listSessions, revokeSession, logout, refreshToken } from '../../lib/api/auth/controller/auth.js'
import { authRefreshTokenBodySchema, authRefreshTokenResponseSchema } from '../../lib/schemas/auth.js'
import { fakeSessionStore } from './fixtures/sessionStore.js'

const SECRET = 'session-routes-test-secret-32-chars!'
const COOKIE_SECRET = 'session-routes-cookie-secret-32-char'

const ANNA: any = { id: 'u1', externalId: 'u-ext-1', email: 'anna@acme.test', roles: ['admin'], confirmed: true, blocked: false }
const BRUNO: any = { id: 'u2', externalId: 'u-ext-2', email: 'bruno@acme.test', roles: ['admin'], confirmed: true, blocked: false }

;(global as any).log = {}

const PUBLIC = [{ code: 'public' }]

let store: ReturnType<typeof fakeSessionStore>

async function build(extra?: (server: any) => void) {
  const users = [ANNA, BRUNO]
  store = fakeSessionStore()

  const server: any = fastify()
  await server.register(cookie, { secret: COOKIE_SECRET })
  await server.register(jwtValidator, { secret: SECRET, sign: { expiresIn: '1h' } })
  server.decorate('sessionManager', store.manager)
  server.decorate('userManager', {
    isImplemented: () => true,
    isValidUser: async (u: any) => !!u && !u.blocked,
    isPasswordToBeChanged: () => false,
    retrieveUserByPassword: async (_c: any, email: string, pw: string) =>
      pw === 'pw' ? users.find((u) => u.email === email) ?? null : null,
    retrieveUserByExternalId: async (_c: any, ext: string) => users.find((u) => u.externalId === ext) ?? null,
    updateUserById: async () => ({})
  })
  server.decorate('tokenManager', { isImplemented: () => true, isValidToken: async () => true, retrieveTokenByExternalId: async () => null })

  // Single tenant: the container of the request is the control plane's own, as it is in a
  // deployment without a `tenants` block.
  server.addHook('onRequest', async (req: any) => {
    req.control = { kind: 'control' }
    req.dataScope = { requestId: String(req.id) }
    req.tenant = undefined
  })
  server.addHook('onRequest', authHook)

  const route = (requiredRoles: any[]) => ({ config: { tenantContext: true, requiredRoles } })

  server.post('/auth/login', route(PUBLIC), login)
  server.post('/auth/logout', route(PUBLIC), logout)
  server.get('/auth/sessions', route(PUBLIC), listSessions)
  server.delete('/auth/sessions/:id', route(PUBLIC), revokeSession)

  // Anything a single test needs registered goes in before the instance starts listening: schemas
  // and routes cannot be added afterwards.
  extra?.(server)

  await server.ready()
  return server
}

const cookieOf = (res: any, name: string) => res.cookies.find((c: any) => c.name === name)
const sessionsOf = (res: any) => JSON.parse(res.body)

async function loginAs(server: any, email: string) {
  const res = await server.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'pw' } })
  const access = cookieOf(res, 'auth_token')
  // A login that did not set the session says why, instead of failing later on `undefined.value`.
  if (!access) throw new Error(`login did not open a session: ${res.statusCode} ${res.body}`)
  return { access: access.value, refresh: cookieOf(res, 'refresh_token')?.value }
}

describe('auth · the renewal contract survives serialization (T-11.8)', () => {
  //
  // Fastify serializes a 200 through the route's response schema and drops, in silence, every
  // field the schema does not declare. That makes a forgotten property in a schema a behaviour
  // change and not a documentation slip: a renewal that rotates the credential and then loses it
  // on the way out hands a bearer client an access token and no way to renew again, and the next
  // call presents the spent credential and gets its own session closed by the reuse detection.
  //
  // So the route is mounted here WITH the real schema. Every other test in this repository mounts
  // the handler bare, which is why nothing saw it.
  //
  let saved: Record<string, any>

  before(() => {
    saved = { roles: (global as any).roles, config: (global as any).config, mode: process.env.AUTH_MODE }
    ;(global as any).roles = { public: { code: 'public', name: 'Public' }, admin: { code: 'admin', name: 'Admin' } }
    ;(global as any).config = { options: {} }
    process.env.AUTH_MODE = 'BEARER'
  })

  after(() => {
    ;(global as any).roles = saved.roles
    ;(global as any).config = saved.config
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
  })

  it('returns the rotated credential, and not only the access token', async () => {
    const server = await build((instance) => {
      instance.addSchema(authRefreshTokenBodySchema)
      instance.addSchema(authRefreshTokenResponseSchema)
      instance.post(
        '/auth/renew-with-schema',
        {
          config: { tenantContext: true, requiredRoles: PUBLIC },
          schema: {
            body: { $ref: 'authRefreshTokenBodySchema#' },
            response: { 200: { $ref: 'authRefreshTokenResponseSchema#' } }
          }
        },
        refreshToken
      )
    })

    const first = await server.inject({ method: 'POST', url: '/auth/login', payload: { email: ANNA.email, password: 'pw' } })
    const { refreshToken: credential } = JSON.parse(first.body)

    const renewed = await server.inject({ method: 'POST', url: '/auth/renew-with-schema', payload: { refreshToken: credential } })
    expect(renewed.statusCode).toBe(200)

    const body = JSON.parse(renewed.body)
    expect(typeof body.token).toBe('string')
    expect(typeof body.refreshToken).toBe('string')
    expect(body.refreshToken).not.toBe(credential)
    await server.close()
  })
})

describe('auth · the sessions of the caller (T-11.14)', () => {
  let saved: Record<string, any>

  before(() => {
    saved = { roles: (global as any).roles, config: (global as any).config, mode: process.env.AUTH_MODE }
    ;(global as any).roles = { public: { code: 'public', name: 'Public' }, admin: { code: 'admin', name: 'Admin' } }
    ;(global as any).config = { options: {} }
    // Declared rather than assumed: the mode is process-wide, another spec file may have left it
    // on bearer, and these tests are about what the browser holds.
    process.env.AUTH_MODE = 'COOKIE'
  })

  after(() => {
    ;(global as any).roles = saved.roles
    ;(global as any).config = saved.config
    if (saved.mode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved.mode
  })

  it('lists one row per device, and marks the one the request came from', async () => {
    const server = await build()
    const phone = await loginAs(server, ANNA.email)
    await loginAs(server, ANNA.email)

    const res = await server.inject({ method: 'GET', url: '/auth/sessions', cookies: { auth_token: phone.access } })
    expect(res.statusCode).toBe(200)

    const rows = sessionsOf(res)
    expect(rows.length).toBe(2)
    expect(rows.filter((r: any) => r.current).length).toBe(1)
    // Nothing of the credential leaves the process, not even its hash.
    expect(JSON.stringify(rows)).not.toContain('secret')
    await server.close()
  })

  it('never shows the sessions of somebody else', async () => {
    const server = await build()
    const anna = await loginAs(server, ANNA.email)
    await loginAs(server, BRUNO.email)

    const rows = sessionsOf(await server.inject({ method: 'GET', url: '/auth/sessions', cookies: { auth_token: anna.access } }))
    expect(rows.length).toBe(1)
    await server.close()
  })

  it('closes one session and leaves the others open', async () => {
    const server = await build()
    const phone = await loginAs(server, ANNA.email)
    const laptop = await loginAs(server, ANNA.email)

    const rows = sessionsOf(await server.inject({ method: 'GET', url: '/auth/sessions', cookies: { auth_token: laptop.access } }))
    const other = rows.find((r: any) => !r.current)

    const closed = await server.inject({
      method: 'DELETE',
      url: `/auth/sessions/${other.sid}`,
      cookies: { auth_token: laptop.access }
    })
    expect(closed.statusCode).toBe(200)

    const left = sessionsOf(await server.inject({ method: 'GET', url: '/auth/sessions', cookies: { auth_token: laptop.access } }))
    expect(left.length).toBe(1)
    expect(left[0].current).toBe(true)
    // The closed one is the phone's, and its credential is worth nothing from now on.
    expect([...store.rows.values()].find((r) => r.sid === other.sid)?.revokedReason).toBe('closed by the user')
    expect(phone.refresh).toBeTruthy()
    await server.close()
  })

  it('answers 404 for a session of another account, exactly as for one that does not exist', async () => {
    const server = await build()
    const anna = await loginAs(server, ANNA.email)
    const bruno = await loginAs(server, BRUNO.email)
    const brunoSid = sessionsOf(await server.inject({ method: 'GET', url: '/auth/sessions', cookies: { auth_token: bruno.access } }))[0].sid

    const stolen = await server.inject({ method: 'DELETE', url: `/auth/sessions/${brunoSid}`, cookies: { auth_token: anna.access } })
    const absent = await server.inject({ method: 'DELETE', url: '/auth/sessions/sid-does-not-exist', cookies: { auth_token: anna.access } })

    // Telling the two apart would make the identifier an oracle for "does this session exist".
    expect(stolen.statusCode).toBe(404)
    expect(absent.statusCode).toBe(404)
    // And Bruno is still logged in.
    expect(sessionsOf(await server.inject({ method: 'GET', url: '/auth/sessions', cookies: { auth_token: bruno.access } })).length).toBe(1)
    await server.close()
  })

  it('clears the cookies when the session being closed is the one speaking', async () => {
    const server = await build()
    const anna = await loginAs(server, ANNA.email)
    const mine = sessionsOf(await server.inject({ method: 'GET', url: '/auth/sessions', cookies: { auth_token: anna.access } }))[0]

    const res = await server.inject({ method: 'DELETE', url: `/auth/sessions/${mine.sid}`, cookies: { auth_token: anna.access } })
    expect(res.statusCode).toBe(200)
    expect(cookieOf(res, 'auth_token')).toMatchObject({ value: '' })
    expect(cookieOf(res, 'refresh_token')).toMatchObject({ value: '' })
    await server.close()
  })

  it('refuses an anonymous caller instead of listing nothing', async () => {
    const server = await build()
    const res = await server.inject({ method: 'GET', url: '/auth/sessions' })
    expect(res.statusCode).toBe(401)
    await server.close()
  })
})
