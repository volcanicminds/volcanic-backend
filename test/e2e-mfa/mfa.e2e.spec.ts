/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E (MFA) — TOTP setup/enable/verify flow, the pre-auth gatekeeper, anti-replay,
// and the MANDATORY policy. Uses a controllable mfaManager stub (see harness).
//
import { expect } from 'expect'
import { setup, teardown, app, login, authHeader, setMfaPolicy, codeForDelta, USER } from './harness.js'

describe('E2E (MFA) — TOTP lifecycle, gatekeeper & policy', () => {
  const inject = (opts: any) => app().inject(opts)

  before(async function () {
    this.timeout(60000)
    await setup()
  })
  after(async () => await teardown())

  let fullToken: string
  let secret: string

  describe('OPTIONAL policy — opt-in enablement', () => {
    it('logs in normally (no MFA yet) and returns a full token', async () => {
      fullToken = await login()
      expect(typeof fullToken).toBe('string')
    })

    it('mfa/setup returns a secret + provisioning URI (authenticated)', async () => {
      const res = await inject({ method: 'POST', url: '/auth/mfa/setup', headers: authHeader(fullToken) })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(typeof body.secret).toBe('string')
      expect(body.uri).toContain('otpauth://')
      secret = body.secret
    })

    it('mfa/setup requires authentication (401 without token)', async () => {
      const res = await inject({ method: 'POST', url: '/auth/mfa/setup' })
      expect(res.statusCode).toBe(401)
    })

    it('mfa/enable rejects an invalid code (400)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/mfa/enable',
        headers: authHeader(fullToken),
        payload: { secret, token: 'nope' }
      })
      expect(res.statusCode).toBe(400)
    })

    it('mfa/enable activates MFA with a valid code', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/mfa/enable',
        headers: authHeader(fullToken),
        payload: { secret, token: codeForDelta(0) }
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).mfaEnabled).toBe(true)
    })
  })

  describe('login once MFA is enabled → 202 gatekeeper', () => {
    let tempToken: string

    it('login no longer returns a full token but a 202 + tempToken', async () => {
      const res = await inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: USER.password } })
      expect(res.statusCode).toBe(202)
      const body = JSON.parse(res.body)
      expect(body.mfaRequired).toBe(true)
      expect(typeof body.tempToken).toBe('string')
      tempToken = body.tempToken
    })

    it('the pre-auth token cannot reach a protected route (403 MFA_REQUIRED)', async () => {
      const res = await inject({ method: 'GET', url: '/users', headers: authHeader(tempToken) })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.body).code).toBe('MFA_REQUIRED')
    })

    it('mfa/verify with a fresh code completes login and returns a full token', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        headers: authHeader(tempToken),
        payload: { token: codeForDelta(1) }
      })
      expect(res.statusCode).toBe(200)
      const full = JSON.parse(res.body).token
      expect(typeof full).toBe('string')
      // the full token is past the gatekeeper: an authenticated-only route works
      // (use /users/me, not /users — this user is `public`, not admin).
      const ok = await inject({ method: 'GET', url: '/users/me', headers: authHeader(full) })
      expect(ok.statusCode).toBe(200)
    })

    it('anti-replay: re-using the same code/time-step is rejected (403)', async () => {
      const relogin = await inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: USER.password } })
      const tt = JSON.parse(relogin.body).tempToken
      const res = await inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        headers: authHeader(tt),
        payload: { token: codeForDelta(1) } // same step as the previous verify
      })
      expect(res.statusCode).toBe(403)
    })
  })

  describe('MANDATORY policy — forced setup', () => {
    before(() => setMfaPolicy('MANDATORY'))
    after(() => setMfaPolicy('OPTIONAL'))

    it('a user without MFA is forced into setup on login (202 mfaSetupRequired)', async () => {
      // brand-new user with no MFA configured
      const res = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: USER.email, password: USER.password }
      })
      expect(res.statusCode).toBe(202)
      const body = JSON.parse(res.body)
      expect(typeof body.tempToken).toBe('string')
    })
  })
})
