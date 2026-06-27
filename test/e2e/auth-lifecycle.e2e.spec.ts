/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E batch 1 — full auth lifecycle: register (+validations/admin), confirm-email,
// login, refresh-token, logout, unregister, invalidate-tokens.
//
import { expect } from 'expect'
import { app, login, authHeader, seedConfirmedUser, getUserByEmail } from './harness.js'
import { userManager } from '../../typeorm.js'

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

    it('cannot log in before confirming (403)', async () => {
      const res = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: VALID_PW } })
      expect(res.statusCode).toBe(403)
    })

    it('rejects duplicate registration (400)', async () => {
      const res = await register({ username: 'dup', email, password1: VALID_PW, password2: VALID_PW })
      expect(res.statusCode).toBe(400)
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

    it('rejects a forged access token on refresh (403)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/refresh-token',
        payload: { token: 'forged.jwt.token', refreshToken: 'whatever' }
      })
      expect(res.statusCode).toBe(403)
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
      expect(after.statusCode).toBe(403) // blocked
    })
  })

  describe('invalidate-tokens', () => {
    it('requires authentication (401 without token)', async () => {
      const res = await inject({ method: 'POST', url: '/auth/invalidate-tokens' })
      expect(res.statusCode).toBe(401)
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

  describe('forgot-password → reset-password (full recovery flow)', () => {
    const email = 'recover@reg.test'
    const OLD = 'Old-pw-123456'
    const NEW = 'New-pw-987654'

    it('issues a reset token, resets the password, and logs in with the new one', async () => {
      await seedConfirmedUser(email, OLD)

      // 1. request recovery -> a resetPasswordToken is stored on the user
      const forgot = await inject({ method: 'POST', url: '/auth/forgot-password', payload: { email } })
      expect(forgot.statusCode).toBe(200)
      const withToken = await getUserByEmail(email)
      const code = withToken.resetPasswordToken
      expect(code).toBeTruthy()

      // 2. reset using the token
      const reset = await inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { code, newPassword1: NEW, newPassword2: NEW }
      })
      expect(reset.statusCode).toBe(200)
      expect(JSON.parse(reset.body).ok).toBe(true)

      // 3. old password no longer works, new one does
      const oldLogin = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: OLD } })
      expect(oldLogin.statusCode).toBe(403)
      const newLogin = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: NEW } })
      expect(newLogin.statusCode).toBe(200)
    })

    it('rejects reset with an invalid/unknown token (403)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { code: 'not-a-real-token', newPassword1: NEW, newPassword2: NEW }
      })
      expect(res.statusCode).toBe(403)
    })

    it('rejects reset when the two new passwords differ (400)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { code: 'whatever', newPassword1: NEW, newPassword2: 'Other-pw-111' }
      })
      expect(res.statusCode).toBe(400)
    })
  })

  // Account-enumeration hardening: forgot-password must not let a caller tell
  // apart an existing, a non-existing or a blocked account. Every case answers
  // with the same generic 200 / { ok: true } (only the input-shape 400 differs).
  describe('forgot-password is non-enumerable', () => {
    const forgot = (payload: any) => inject({ method: 'POST', url: '/auth/forgot-password', payload })

    it('returns 400 only for a missing/invalid identifier', async () => {
      const res = await forgot({ email: 'not-an-email' })
      expect(res.statusCode).toBe(400)
    })

    it('returns a generic 200 for an existing account', async () => {
      const email = 'forgot-exists@reg.test'
      await seedConfirmedUser(email, VALID_PW)
      const res = await forgot({ email })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ ok: true })
    })

    it('returns the same 200 for a non-existing account (no leak)', async () => {
      const res = await forgot({ email: 'forgot-nobody@reg.test' })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ ok: true })
    })

    it('returns the same 200 for a blocked account (no leak)', async () => {
      const email = 'forgot-blocked@reg.test'
      const u: any = await seedConfirmedUser(email, VALID_PW)
      await userManager.updateUserById(u.id, { blocked: true } as any)
      const res = await forgot({ email })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ ok: true })
    })

    it('does not actually issue a reset token for a non-existing account', async () => {
      const before = await getUserByEmail('forgot-nobody@reg.test')
      expect(before).toBeFalsy()
    })
  })
})
