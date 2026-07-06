/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E (multi-tenant) — per-route cache tenant isolation over embedded PGlite.
// The cache key embeds the resolved tenant id, so acme and globex never share a
// cached entry, and a tenant-context route with no tenant header is never cached
// (the handler never runs → nothing to cache).
//
import { expect } from 'expect'
import { app, resetSearchPath, HEADER, ACME, GLOBEX } from './harness.js'

describe('E2E (multi-tenant) — per-route cache tenant isolation', () => {
  const inject = async (opts: any) => {
    await resetSearchPath()
    return app().inject(opts)
  }
  const getT = (slug?: string) =>
    inject({ method: 'GET', url: '/tcached', headers: slug ? { [HEADER]: slug } : {} })

  before(() => (global as any).cache.flushAll())

  it('isolates cached entries per tenant (no cross-tenant serve)', async () => {
    const a1 = JSON.parse((await getT(ACME.slug)).body)
    const a2 = JSON.parse((await getT(ACME.slug)).body)
    expect(a1.tenant).toBeTruthy()
    expect(a2.n).toBe(a1.n) // acme's second GET is served from cache

    const g1 = JSON.parse((await getT(GLOBEX.slug)).body)
    expect(g1.tenant).not.toBe(a1.tenant) // different tenant id resolved
    expect(g1.n).toBeGreaterThan(a1.n) // globex ran fresh (own scope) — NOT acme's entry

    const a3 = JSON.parse((await getT(ACME.slug)).body)
    expect(a3.n).toBe(a1.n) // acme's entry is still intact after globex was served
  })

  it('never caches a tenant-context route when the tenant header is missing (404)', async () => {
    const r1 = await getT() // no tenant header → resolution fails before the handler
    expect(r1.statusCode).toBe(404)
    const r2 = await getT()
    expect(r2.statusCode).toBe(404) // still 404, nothing was cached to mask it
  })
})
