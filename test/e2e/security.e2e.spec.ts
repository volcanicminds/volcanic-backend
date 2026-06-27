/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E — security regressions (OWASP API3: mass assignment / property-level authz,
// API1/API5: privilege escalation). BEARER, single-tenant.
//
import { expect } from 'expect'
import { app, login, authHeader, seedConfirmedUser, getUserByEmail } from './harness.js'

describe('E2E — security regressions', () => {
  const inject = (opts: any) => app().inject(opts)

  describe('mass assignment on PUT /users/me', () => {
    const email = 'sec-selfedit@e2e.test'
    const PW = 'Sec-pw-123456'
    let tok: string

    before(async () => {
      await seedConfirmedUser(email, PW)
      tok = await login(email, PW)
    })

    it('a normal user CANNOT escalate to admin via /users/me', async () => {
      const res = await inject({
        method: 'PUT',
        url: '/users/me',
        headers: authHeader(tok),
        payload: { username: 'newname', roles: ['admin'] }
      })
      // extra props are stripped (schema) / ignored (controller whitelist): no 5xx,
      // and crucially the role must NOT change.
      expect(res.statusCode).toBeLessThan(500)
      const after = await getUserByEmail(email)
      expect(after.roles).not.toContain('admin')
    })

    it('a normal user CANNOT set blocked/confirmed/password via /users/me', async () => {
      const before = await getUserByEmail(email)
      const res = await inject({
        method: 'PUT',
        url: '/users/me',
        headers: authHeader(tok),
        payload: { password: 'plaintext-hack', blocked: true, confirmed: false }
      })
      expect(res.statusCode).toBeLessThan(500)
      const after = await getUserByEmail(email)
      expect(after.password).toBe(before.password) // credential untouched
      expect(after.blocked).toBe(false)
      // and the account still authenticates (password not corrupted)
      const stillWorks = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } })
      expect(stillWorks.statusCode).toBe(200)
    })

    it('a legitimate self-edit (username) still works', async () => {
      const res = await inject({
        method: 'PUT',
        url: '/users/me',
        headers: authHeader(tok),
        payload: { username: 'legit-name' }
      })
      expect(res.statusCode).toBe(200)
      const after = await getUserByEmail(email)
      expect(after.username).toBe('legit-name')
    })
  })

  describe('Magic Query never leaks sensitive columns over HTTP', () => {
    it('filtering by password is ignored (no oracle) and admin listing hides it', async () => {
      const admin = await login('admin@e2e.test', 'Admin-pw-12345')
      // a sensitive-field filter must not act as a lookup oracle nor 500
      const res = await inject({ method: 'GET', url: '/users?password=whatever', headers: authHeader(admin) })
      expect(res.statusCode).toBe(200)
      const rows = JSON.parse(res.body)
      // response must never carry password / mfaSecret
      for (const r of rows) {
        expect(r.password).toBeUndefined()
        expect(r.mfaSecret).toBeUndefined()
      }
    })
  })
})
