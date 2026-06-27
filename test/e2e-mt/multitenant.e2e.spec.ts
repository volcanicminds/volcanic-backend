/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E (multi-tenant) — real schema isolation over embedded PGlite. Two tenants
// (acme, globex), each with its own admin seeded in its own Postgres schema.
// Verifies header resolution, tenant-context opt-out, cross-tenant data
// isolation, and token-to-tenant binding (a token bound to A cannot reach B).
//
// PGlite caveat: all requests share ONE connection whose search_path is switched
// per request, so we reset to `public` before each tenant-resolving request
// (tests are sequential). This is why production multi-tenancy needs real
// Postgres — see harness.resetSearchPath().
//
import { expect } from 'expect'
import { app, login, authHeader, resetSearchPath, HEADER, ACME, GLOBEX } from './harness.js'

describe('E2E (multi-tenant) — schema isolation & tenant resolution', () => {
  // Deterministic inject: clear any leftover tenant search_path first.
  const inject = async (opts: any) => {
    await resetSearchPath()
    return app().inject(opts)
  }

  describe('tenant resolution', () => {
    it('serves a tenantContext:false route without a tenant header (/health 200)', async () => {
      const res = await inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
    })

    it('returns 404 on a tenant-context route without the tenant header', async () => {
      const res = await inject({ method: 'GET', url: '/users' })
      expect(res.statusCode).toBe(404)
    })

    it('returns 404 for an unknown tenant slug', async () => {
      const res = await inject({ method: 'GET', url: '/users', headers: { [HEADER]: 'does-not-exist' } })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('login is scoped to the tenant schema', () => {
    it('logs in the acme admin under the acme tenant', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/login',
        headers: { [HEADER]: ACME.slug },
        payload: { email: ACME.adminEmail, password: ACME.adminPassword }
      })
      expect(res.statusCode).toBe(200)
      expect(typeof JSON.parse(res.body).token).toBe('string')
    })

    it('does NOT find the acme admin under the globex tenant (isolation, 403)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/login',
        headers: { [HEADER]: GLOBEX.slug },
        payload: { email: ACME.adminEmail, password: ACME.adminPassword }
      })
      expect(res.statusCode).toBe(403)
    })
  })

  describe('data isolation across tenants', () => {
    it('each tenant only sees its own users', async () => {
      const acmeTok = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      const globexTok = await login(GLOBEX.slug, GLOBEX.adminEmail, GLOBEX.adminPassword)

      const acmeCount = await inject({ method: 'GET', url: '/users/count', headers: authHeader(acmeTok, ACME.slug) })
      const globexCount = await inject({ method: 'GET', url: '/users/count', headers: authHeader(globexTok, GLOBEX.slug) })
      expect(acmeCount.statusCode).toBe(200)
      expect(globexCount.statusCode).toBe(200)
      expect(JSON.parse(acmeCount.body)).toBe(1)
      expect(JSON.parse(globexCount.body)).toBe(1)

      const acmeList = await inject({ method: 'GET', url: '/users', headers: authHeader(acmeTok, ACME.slug) })
      const emails = JSON.parse(acmeList.body).map((u: any) => u.email)
      expect(emails).toContain(ACME.adminEmail)
      expect(emails).not.toContain(GLOBEX.adminEmail)
    })

    it('a user created in acme is invisible to globex', async () => {
      const acmeTok = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      const created = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(acmeTok, ACME.slug),
        payload: { email: 'extra@acme.test', password: 'Extra-pw-123456', roles: ['public'] }
      })
      expect(created.statusCode).toBeLessThan(400)

      const acmeCount = await inject({ method: 'GET', url: '/users/count', headers: authHeader(acmeTok, ACME.slug) })
      expect(JSON.parse(acmeCount.body)).toBe(2)

      const globexTok = await login(GLOBEX.slug, GLOBEX.adminEmail, GLOBEX.adminPassword)
      const globexCount = await inject({ method: 'GET', url: '/users/count', headers: authHeader(globexTok, GLOBEX.slug) })
      expect(JSON.parse(globexCount.body)).toBe(1) // unchanged: isolated
    })
  })

  describe('token-to-tenant binding', () => {
    it('rejects an acme token used against the globex tenant (403 TENANT_MISMATCH)', async () => {
      const acmeTok = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      // Header resolves globex, but the token carries tid=acme -> onRequest rejects.
      const res = await inject({ method: 'GET', url: '/users', headers: authHeader(acmeTok, GLOBEX.slug) })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.body).code).toBe('TENANT_MISMATCH')
    })

    it('rejects an authenticated request that drops the tenant header (404)', async () => {
      const acmeTok = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      // No header -> tenant resolution fails before auth runs.
      const res = await inject({ method: 'GET', url: '/users', headers: { authorization: `Bearer ${acmeTok}` } })
      expect(res.statusCode).toBe(404)
    })
  })
})
