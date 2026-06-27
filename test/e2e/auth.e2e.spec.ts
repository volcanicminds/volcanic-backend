/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E: full HTTP pipeline (auth lifecycle, authorization, security headers,
// error handling) against the real app + embedded PGlite. Uses server.inject.
//
import { expect } from 'expect'
import { app, login, authHeader, ADMIN, USER } from './harness.js'

describe('E2E — auth, authorization & security', () => {
  const inject = (opts: any) => app().inject(opts)

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

    // DECISION: GET /users/roles is authenticated-only (any logged-in user), like
    // /users/me and /users/is-admin. It declares `roles: []` + the
    // `global.isAuthenticated` middleware: 401 without a token, 200 for any
    // authenticated user. Kept behind auth on purpose — it exposes the role
    // taxonomy, which anonymous callers don't need.
    it('GET /users/roles requires authentication (401 without token, 200 when logged in)', async () => {
      const noTok = await inject({ method: 'GET', url: '/users/roles' })
      expect(noTok.statusCode).toBe(401)
      const tok = await login(ADMIN.email, ADMIN.password)
      const withAuth = await inject({ method: 'GET', url: '/users/roles', headers: authHeader(tok) })
      expect(withAuth.statusCode).toBe(200)
    })
  })

  describe('login', () => {
    it('rejects an invalid email (400)', async () => {
      const res = await inject({ method: 'POST', url: '/auth/login', payload: { email: 'nope', password: 'x' } })
      expect(res.statusCode).toBe(400)
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
    // No authenticated subject => 401 (must log in). Authenticated-but-wrong-role => 403.
    it('returns 401 without a token', async () => {
      const res = await inject({ method: 'GET', url: '/users' })
      expect(res.statusCode).toBe(401)
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
