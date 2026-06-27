/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E (AUTH_MODE=COOKIE) — the auth pipeline driven by a signed httpOnly cookie
// instead of a Bearer header. Runs in its OWN mocha process (the cookie plugin
// and AUTH_MODE are wired at boot from env). Reuses the standard single-tenant
// harness over embedded PGlite.
//
import { expect } from 'expect'
import { setup, teardown, app, ADMIN } from '../e2e/harness.js'

const inject = (opts: any) => app().inject(opts)

// Pull the signed auth cookie out of a login response and rebuild a Cookie header.
function authCookie(loginRes: any): string {
  const c = (loginRes.cookies || []).find((x: any) => x.name === 'auth_token')
  if (!c) throw new Error('auth_token cookie not set on login')
  return `auth_token=${c.value}`
}

describe('E2E (cookie mode) — signed cookie auth', () => {
  before(async function () {
    this.timeout(60000)
    await setup()
  })
  after(async () => await teardown())

  it('login sets a signed httpOnly auth_token cookie and hides the token from the body', async () => {
    const res = await inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password }
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.token).toBeFalsy() // token lives in the cookie, not the body (schema serializes null -> "")

    const cookie = (res.cookies || []).find((c: any) => c.name === 'auth_token')
    expect(cookie).toBeTruthy()
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.value.length).toBeGreaterThan(0)
  })

  it('authorizes a protected route using the cookie (no Authorization header)', async () => {
    const loginRes = await inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password }
    })
    const res = await inject({ method: 'GET', url: '/users', headers: { cookie: authCookie(loginRes) } })
    expect(res.statusCode).toBe(200)
  })

  it('returns 401 on a protected route without the cookie', async () => {
    const res = await inject({ method: 'GET', url: '/users' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a tampered cookie (401)', async () => {
    const res = await inject({ method: 'GET', url: '/users', headers: { cookie: 'auth_token=tampered.value.nope' } })
    expect(res.statusCode).toBe(401)
  })

  it('logout clears the auth_token cookie', async () => {
    const res = await inject({ method: 'POST', url: '/auth/logout' })
    expect(res.statusCode).toBe(200)
    const cleared = (res.cookies || []).find((c: any) => c.name === 'auth_token')
    // clearCookie emits a set-cookie with an empty value / past expiry
    expect(cleared).toBeTruthy()
    expect(cleared.value).toBe('')
  })
})
