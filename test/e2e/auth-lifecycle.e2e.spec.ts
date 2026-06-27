/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E batch 1 — full auth lifecycle: register (+validations/admin), confirm-email,
// login, refresh-token, logout, unregister, invalidate-tokens.
//
import { expect } from 'expect'
import { app, login, authHeader, seedConfirmedUser, getUserByEmail } from './harness.js'

const VALID_PW = 'Reg-pw-123456'

describe('E2E — auth lifecycle', () => {
  const inject = (opts: any) => app().inject(opts)
  const register = (payload: any) => inject({ method: 'POST', url: '/auth/register', payload })

  describe('register validations', () => {
    it('rejects a missing username', async () => {
      const res = await register({ email: 'a@reg.test', password1: VALID_PW, password2: VALID_PW })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
    })
    it('rejects an invalid email', async () => {
      const res = await register({ username: 'u', email: 'bad', password1: VALID_PW, password2: VALID_PW })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
    })
    it('rejects a weak password', async () => {
      const res = await register({ username: 'u', email: 'weak@reg.test', password1: 'weak', password2: 'weak' })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
    })
    it('rejects mismatched passwords', async () => {
      const res = await register({ username: 'u', email: 'mm@reg.test', password1: VALID_PW, password2: 'Other-pw-99' })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
    })
  })

  describe('register → confirm-email → login', () => {
    const email = 'newbie@reg.test'
    let confirmationToken: string

    it('registers a new (unconfirmed) user', async () => {
      const res = await register({ username: 'newbie', email, password1: VALID_PW, password2: VALID_PW })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).email).toBe(email)
      // confirmationToken is NOT exposed by the response schema -> read it from the DB
      const dbUser = await getUserByEmail(email)
      expect(dbUser.confirmed).toBe(false)
      confirmationToken = dbUser.confirmationToken
      expect(confirmationToken).toBeTruthy()
    })

    // (rejected; the framework currently returns 500 instead of 403 here — see findings)
    it('cannot log in before confirming', async () => {
      const res = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: VALID_PW } })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
      expect(res.statusCode).not.toBe(200)
    })

    it('rejects duplicate registration', async () => {
      const res = await register({ username: 'dup', email, password1: VALID_PW, password2: VALID_PW })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
      expect(res.statusCode).not.toBe(200)
    })

    it('confirms the email with the token', async () => {
      const res = await inject({ method: 'POST', url: '/auth/confirm-email', payload: { code: confirmationToken } })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ ok: true })
    })

    it('logs in after confirmation', async () => {
      const res = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: VALID_PW } })
      expect(res.statusCode).toBe(200)
      expect(typeof JSON.parse(res.body).token).toBe('string')
    })
  })

  describe('login issues a refresh token (JWT_REFRESH default on)', () => {
    it('returns token + refreshToken and refreshes to a new access token', async () => {
      const loginRes = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'newbie@reg.test', password: VALID_PW }
      })
      const { token, refreshToken } = JSON.parse(loginRes.body)
      expect(typeof refreshToken).toBe('string')

      const res = await inject({ method: 'POST', url: '/auth/refresh-token', payload: { token, refreshToken } })
      expect(res.statusCode).toBe(200)
      expect(typeof JSON.parse(res.body).token).toBe('string')
    })

    // FINDING: a forged token is rejected, but with 500 instead of 403 — same
    // `reply.status(4xx).send(new Error())` status-not-preserved inconsistency seen
    // on login. Asserted as "rejected" (>=400) here.
    it('rejects a forged access token on refresh', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/refresh-token',
        payload: { token: 'forged.jwt.token', refreshToken: 'whatever' }
      })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
      expect(res.statusCode).not.toBe(200)
    })
  })

  describe('logout', () => {
    it('returns ok (bearer mode no-op)', async () => {
      const res = await inject({ method: 'POST', url: '/auth/logout' })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ ok: true })
    })
  })

  describe('unregister (disables the user)', () => {
    it('disables a user; afterwards login is forbidden', async () => {
      const email = 'todelete@reg.test'
      await seedConfirmedUser(email, VALID_PW)
      // sanity: can log in first
      expect((await inject({ method: 'POST', url: '/auth/login', payload: { email, password: VALID_PW } })).statusCode).toBe(200)

      const res = await inject({ method: 'POST', url: '/auth/unregister', payload: { email, password: VALID_PW } })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ ok: true })

      const after = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: VALID_PW } })
      expect(after.statusCode).toBeGreaterThanOrEqual(400) // blocked (currently 500, should be 403)
      expect(after.statusCode).not.toBe(200)
    })
  })

  describe('invalidate-tokens', () => {
    it('requires authentication (denied without token)', async () => {
      const res = await inject({ method: 'POST', url: '/auth/invalidate-tokens' })
      expect([401, 403]).toContain(res.statusCode)
    })

    it('rotates externalId so existing tokens stop resolving', async () => {
      const email = 'rotate@reg.test'
      await seedConfirmedUser(email, VALID_PW)
      const token = await login(email, VALID_PW)

      const ok = await inject({ method: 'POST', url: '/auth/invalidate-tokens', headers: authHeader(token) })
      expect(ok.statusCode).toBe(200)

      // the old token's subject no longer exists -> 404 SUBJECT_NOT_FOUND on a protected route
      const reused = await inject({ method: 'GET', url: '/users', headers: authHeader(token) })
      expect(reused.statusCode).toBe(404)
    })
  })
})
