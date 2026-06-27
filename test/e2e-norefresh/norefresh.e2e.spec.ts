/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E (JWT_REFRESH=false) — refresh tokens disabled. Login must not issue a
// refreshToken and the refresh endpoint must not mint new access tokens. Runs in
// its OWN mocha process (the refresh JWT namespace is wired at boot from env).
//
import { expect } from 'expect'
import { setup, teardown, app, ADMIN } from '../e2e/harness.js'

const inject = (opts: any) => app().inject(opts)

describe('E2E (no refresh) — JWT_REFRESH disabled', () => {
  before(async function () {
    this.timeout(60000)
    await setup()
  })
  after(async () => await teardown())

  it('login still works but issues no refreshToken', async () => {
    const res = await inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password }
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(typeof body.token).toBe('string')
    expect(body.refreshToken).toBeFalsy() // disabled -> null/undefined/empty
  })

  it('the refresh-token endpoint does not mint a new access token', async () => {
    const loginRes = await inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password }
    })
    const { token } = JSON.parse(loginRes.body)
    const res = await inject({
      method: 'POST',
      url: '/auth/refresh-token',
      payload: { token, refreshToken: 'whatever' }
    })
    // Clean 404 (feature disabled) — not an unhandled 500.
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).code).toBe('NOT_FOUND')
  })
})
