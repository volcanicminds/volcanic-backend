/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E (consumer-app fixture) — per-route cache OOTB capability. Verifies the real
// HTTP behavior of the read (preHandler) + write (onSend) hooks: a GET is served
// from cache (handler runs once), custom `v-*` headers are replayed, and a
// declared `invalidates` flushes the key-group on a successful mutation.
//
import { expect } from 'expect'
import { app, login, authHeader, ADMIN } from './harness.js'
import { configureCache } from '../../lib/util/cache.js'

describe('E2E (consumer-app fixture) — per-route cache', () => {
  const get = () => app().inject({ method: 'GET', url: '/cached' })
  const bodyN = (r: any) => JSON.parse(r.body).n

  it('serves a GET from cache (handler runs once) and replays v- headers', async () => {
    const r1 = await get()
    expect(r1.statusCode).toBe(200)
    const n1 = JSON.parse(r1.body).n
    expect(r1.headers['v-count']).toBe(String(n1))

    const r2 = await get()
    expect(r2.statusCode).toBe(200)
    expect(JSON.parse(r2.body).n).toBe(n1) // identical → served from cache
    expect(r2.headers['v-count']).toBe(String(n1)) // header replayed from cache
  })

  it('flushes the key-group on a successful mutation (invalidates)', async () => {
    const before = JSON.parse((await get()).body).n // warm (cached)
    const bump = await app().inject({ method: 'POST', url: '/cached/bump' })
    expect(bump.statusCode).toBe(200)

    const after = JSON.parse((await get()).body).n // cache flushed → handler ran again
    expect(after).toBeGreaterThan(before)
  })

  it('does not cache non-2xx responses (each call runs fresh)', async () => {
    const r1 = await app().inject({ method: 'GET', url: '/cached/failing' })
    const r2 = await app().inject({ method: 'GET', url: '/cached/failing' })
    expect(r1.statusCode).toBe(500)
    expect(r2.statusCode).toBe(500)
    expect(JSON.parse(r2.body).f).toBeGreaterThan(JSON.parse(r1.body).f) // handler ran both times
  })

  it('scopes the cache by caller (anonymous vs authenticated do not share)', async () => {
    ;(global as any).cache.flushAll() // clean slate
    const anon = bodyN(await get()) // fresh → cached for the anonymous scope

    const tok = await login(ADMIN.email, ADMIN.password)
    const adminGet = () => app().inject({ method: 'GET', url: '/cached', headers: authHeader(tok) })
    const adminFirst = bodyN(await adminGet())
    expect(adminFirst).toBeGreaterThan(anon) // different scope → not the anon entry (ran fresh)
    expect(bodyN(await adminGet())).toBe(adminFirst) // admin's own entry is cached
    expect(bodyN(await get())).toBe(anon) // the anon entry is still intact
  })

  it('global.cache.flushAll() clears entries (next GET is fresh)', async () => {
    const before = bodyN(await get()) // cached
    ;(global as any).cache.flushAll()
    expect(bodyN(await get())).toBeGreaterThan(before) // store cleared → handler ran again
  })

  describe('file-level config.cache inheritance', () => {
    const getFile = () => app().inject({ method: 'GET', url: '/cachedfile' })

    it('caches a GET that inherits caching from the file-level config (no per-route cache)', async () => {
      ;(global as any).cache.flushAll()
      const r1 = await getFile()
      expect(r1.statusCode).toBe(200)
      const n1 = JSON.parse(r1.body).n
      const r2 = await getFile()
      expect(JSON.parse(r2.body).n).toBe(n1) // served from cache → inherited caching works
    })

    it('flushes a foreign key-group via file-level invalidates (cross-folder, inherited by the POST)', async () => {
      ;(global as any).cache.flushAll()
      const before = JSON.parse((await getFile()).body).n // warm 'cachedfile'
      expect(JSON.parse((await getFile()).body).n).toBe(before) // confirm it is cached

      const bump = await app().inject({ method: 'POST', url: '/cachedinval/bump' })
      expect(bump.statusCode).toBe(200)

      const after = JSON.parse((await getFile()).body).n // inherited invalidates flushed it
      expect(after).toBeGreaterThan(before)
    })
  })

  describe('LRU eviction under HTTP (maxEntries)', () => {
    // Distinct query strings → distinct cache keys under the same key-group.
    const gq = (p: number) => app().inject({ method: 'GET', url: `/cached?p=${p}` })

    after(() => configureCache({ enabled: true, ttl: 3600, maxEntries: 1000 })) // restore boot config

    it('evicts the least-recently-used entry once the cap is exceeded', async () => {
      configureCache({ enabled: true, ttl: 3600, maxEntries: 2 }) // shrink cap + clear store

      const p1 = JSON.parse((await gq(1)).body).n // cache [p1]
      JSON.parse((await gq(2)).body) // cache [p1, p2]
      expect(JSON.parse((await gq(1)).body).n).toBe(p1) // hit → touch p1 (now MRU, p2 = LRU)

      const p3 = JSON.parse((await gq(3)).body).n // over cap → evict LRU (p2); store [p1, p3]
      expect(JSON.parse((await gq(1)).body).n).toBe(p1) // p1 survived (was most-recently used)

      const p2b = JSON.parse((await gq(2)).body).n // p2 was evicted → runs fresh
      expect(p2b).toBeGreaterThan(p3) // counter advanced past p3 → confirms a fresh handler run
    })
  })
})
