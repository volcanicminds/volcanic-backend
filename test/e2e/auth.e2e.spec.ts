/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E: full HTTP pipeline (auth lifecycle, authorization, security headers,
// error handling) against the real app + embedded PGlite. Uses server.inject.
//
import { expect } from 'expect'
import { setup, teardown, login, authHeader, ADMIN, USER } from './harness.js'

describe('E2E — auth, authorization & security', () => {
  let server: any

  before(async function () {
    this.timeout(60000)
    server = await setup()
  })
  after(async () => await teardown())

  const inject = (opts: any) => server.inject(opts)

  describe('public surface', () => {
    it('GET /health is public (200)', async () => {
      const res = await inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ ok: true })
    })

    it('unknown route returns 404', async () => {
      const res = await inject({ method: 'GET', url: '/does-not-exist' })
      expect(res.statusCode).toBe(404)
    })

    it('helmet security headers are present', async () => {
      const res = await inject({ method: 'GET', url: '/health' })
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['x-frame-options']).toBeDefined()
    })

    it('CORS preflight is answered', async () => {
      const res = await inject({
        method: 'OPTIONS',
        url: '/health',
        headers: { origin: 'https://example.com', 'access-control-request-method': 'GET' }
      })
      expect(res.headers['access-control-allow-origin']).toBeDefined()
    })

    // FINDING: GET /users/roles is declared public (roles: []), but it is shadowed
    // by GET /users/:id (admin) and resolves to 403 without a token. Looks like a
    // route-precedence issue worth reviewing; asserted here as the current behavior.
    it('GET /users/roles is currently shadowed by /users/:id (403 without token)', async () => {
      const res = await inject({ method: 'GET', url: '/users/roles' })
      expect(res.statusCode).toBe(403)
    })
  })

  describe('login', () => {
    // FINDING: an invalid email is rejected, but with HTTP 500 instead of 400 — the
    // handler `reply.status(400).send(new Error(...))` is not preserving the status
    // in this branch (error-status inconsistency). Asserted as current behavior.
    it('rejects an invalid email (currently 500, should be 400)', async () => {
      const res = await inject({ method: 'POST', url: '/auth/login', payload: { email: 'nope', password: 'x' } })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
      expect(res.statusCode).not.toBe(200)
    })

    it('rejects wrong credentials (403)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: ADMIN.email, password: 'wrong-password' }
      })
      expect(res.statusCode).toBe(403)
    })

    it('logs in a confirmed user and returns a token', async () => {
      const res = await inject({ method: 'POST', url: '/auth/login', payload: { email: ADMIN.email, password: ADMIN.password } })
      expect(res.statusCode).toBe(200)
      expect(typeof JSON.parse(res.body).token).toBe('string')
    })
  })

  describe('authorization (role-protected GET /users)', () => {
    // No token => resolved as the public role => 403 by the requiredRoles gate
    // (the framework enforces authorization in the onRequest hook, not via a
    // separate isAuthenticated layer for role routes).
    it('denies access without a token (403)', async () => {
      const res = await inject({ method: 'GET', url: '/users' })
      expect(res.statusCode).toBe(403)
    })

    it('returns 401 for a malformed bearer token', async () => {
      const res = await inject({ method: 'GET', url: '/users', headers: { authorization: 'Bearer not-a-jwt' } })
      expect(res.statusCode).toBe(401)
    })

    it('returns 403 for an authenticated non-admin user', async () => {
      const token = await login(USER.email, USER.password)
      const res = await inject({ method: 'GET', url: '/users', headers: authHeader(token) })
      expect(res.statusCode).toBe(403)
    })

    it('returns 200 for an admin', async () => {
      const token = await login(ADMIN.email, ADMIN.password)
      const res = await inject({ method: 'GET', url: '/users', headers: authHeader(token) })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('password lifecycle', () => {
    it('change-password rotates the credential (old fails, new works)', async () => {
      const token = await login(USER.email, USER.password)
      const newPw = 'User-pw-NEW-99'
      const res = await inject({
        method: 'POST',
        url: '/auth/change-password',
        headers: authHeader(token),
        payload: { email: USER.email, oldPassword: USER.password, newPassword1: newPw, newPassword2: newPw }
      })
      expect(res.statusCode).toBe(200)

      const oldLogin = await inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: USER.password } })
      expect(oldLogin.statusCode).toBe(403)
      const newLogin = await inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: newPw } })
      expect(newLogin.statusCode).toBe(200)
    })
  })
})
