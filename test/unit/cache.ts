/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import {
  configureCache,
  cacheGet,
  cacheSet,
  invalidateCache,
  cacheStats,
  cache,
  normalizeRouteCache,
  buildCacheHooks
} from '../../lib/util/cache.js'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Minimal Fastify req/reply doubles for exercising the onSend/preHandler hooks.
const mockReq = (over: any = {}) => ({
  method: 'GET',
  url: '/x',
  roles: () => [],
  routeOptions: { config: {} },
  ...over
})
const mockReply = (statusCode = 200, headers: Record<string, any> = {}) => {
  const store: Record<string, any> = {}
  for (const k of Object.keys(headers)) store[k.toLowerCase()] = headers[k]
  return {
    statusCode,
    header(k: string, v: any) {
      store[k.toLowerCase()] = v
    },
    getHeader: (k: string) => store[k.toLowerCase()],
    getHeaders: () => store,
    code(c: number) {
      this.statusCode = c
      return this
    },
    send: (p: any) => p
  }
}

export default () => {
  describe('Cache (lib/util/cache)', () => {
    describe('store: get / set / miss', () => {
      it('returns undefined on miss and the stored value on hit', () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 100 })
        expect(cacheGet('g::s::GET /x')).toBeUndefined()
        cacheSet('g::s::GET /x', { v: 1 })
        expect(cacheGet('g::s::GET /x')).toEqual({ v: 1 })
      })
    })

    describe('TTL expiry', () => {
      it('drops an entry once its ttl elapses', async () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 100 })
        cacheSet('g::s::GET /ttl', 'x', 0.05) // 50ms
        expect(cacheGet('g::s::GET /ttl')).toBe('x')
        await delay(90)
        expect(cacheGet('g::s::GET /ttl')).toBeUndefined()
      })
    })

    describe('LRU eviction', () => {
      it('evicts the least-recently-used entry beyond maxEntries', () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 2 })
        cacheSet('g::s::a', 1)
        cacheSet('g::s::b', 2)
        // Touch `a` → most-recently used; `b` becomes the LRU.
        expect(cacheGet('g::s::a')).toBe(1)
        cacheSet('g::s::c', 3) // over cap → evict `b`
        expect(cacheGet('g::s::b')).toBeUndefined()
        expect(cacheGet('g::s::a')).toBe(1)
        expect(cacheGet('g::s::c')).toBe(3)
      })
    })

    describe('invalidate by key-group', () => {
      it('removes only the targeted group and returns the count', () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 100 })
        cacheSet('public::s::GET /a', 1)
        cacheSet('public::s::GET /b', 2)
        cacheSet('vehicles::s::GET /c', 3)
        expect(invalidateCache('public')).toBe(2)
        expect(cacheGet('public::s::GET /a')).toBeUndefined()
        expect(cacheGet('vehicles::s::GET /c')).toBe(3)
      })
      it('accepts an array of key-groups', () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 100 })
        cacheSet('a::s::1', 1)
        cacheSet('b::s::2', 2)
        cacheSet('c::s::3', 3)
        expect(invalidateCache(['a', 'c'])).toBe(2)
        expect(cacheStats().size).toBe(1)
      })
      it('flushAll (no arg) clears everything', () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 100 })
        cacheSet('a::s::1', 1)
        cacheSet('b::s::2', 2)
        expect(invalidateCache()).toBe(2)
        expect(cacheStats().size).toBe(0)
      })
    })

    describe('facade + stats', () => {
      it('exposes get/set/del/invalidate/flushAll/stats/enabled', () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 100 })
        cache.set('k::s::1', 42)
        expect(cache.get('k::s::1')).toBe(42)
        expect(cache.enabled()).toBe(true)
        cache.del('k::s::1')
        expect(cache.get('k::s::1')).toBeUndefined()
        const s = cache.stats()
        expect(typeof s.size).toBe('number')
        expect(s.maxEntries).toBe(100)
      })
      it('reports disabled when configured off', () => {
        configureCache({ enabled: false })
        expect(cache.enabled()).toBe(false)
        configureCache({ enabled: true, ttl: 3600, maxEntries: 1000 }) // restore default
      })
    })

    describe('normalizeRouteCache', () => {
      it('undefined / false → undefined', () => {
        expect(normalizeRouteCache(undefined, 'public')).toBeUndefined()
        expect(normalizeRouteCache(false, 'public')).toBeUndefined()
      })
      it('true → enabled, key-group defaults to the folder', () => {
        expect(normalizeRouteCache(true, 'public')).toEqual({
          enabled: true,
          ttl: undefined,
          keyGroup: 'public',
          invalidates: undefined
        })
      })
      it('number → ttl shortcut (seconds)', () => {
        expect(normalizeRouteCache(900, 'public')).toEqual({
          enabled: true,
          ttl: 900,
          keyGroup: 'public',
          invalidates: undefined
        })
      })
      it('object → normalized; key-group override; invalidates coerced to array', () => {
        expect(normalizeRouteCache({ ttl: 60, keyGroup: 'x', invalidates: 'public' }, 'vehicles')).toEqual({
          enabled: true,
          ttl: 60,
          keyGroup: 'x',
          invalidates: ['public']
        })
      })
      it('enabled:false with invalidates → kept (invalidation-only)', () => {
        expect(normalizeRouteCache({ enabled: false, invalidates: ['public'] }, 'vehicles')).toEqual({
          enabled: false,
          ttl: undefined,
          keyGroup: 'vehicles',
          invalidates: ['public']
        })
      })
      it('enabled:false and no invalidates → undefined', () => {
        expect(normalizeRouteCache({ enabled: false }, 'vehicles')).toBeUndefined()
      })
    })

    describe('buildCacheHooks (onSend behavior)', () => {
      it('stores a fresh GET 2xx response', async () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 100 })
        const { onSend } = buildCacheHooks({ enabled: true, keyGroup: 'g' } as any)
        const reply = mockReply(200, { 'content-type': 'application/json' })
        await onSend(mockReq({ method: 'GET', url: '/c' }) as any, reply as any, '{"x":1}')
        expect(cacheGet('g::|anon|::GET /c')).toBeDefined()
      })

      it('does not store a response carrying Set-Cookie', async () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 100 })
        const { onSend } = buildCacheHooks({ enabled: true, keyGroup: 'g' } as any)
        const reply = mockReply(200, { 'content-type': 'application/json', 'set-cookie': 'a=b' })
        await onSend(mockReq({ method: 'GET', url: '/ck' }) as any, reply as any, '{"x":1}')
        expect(cacheGet('g::|anon|::GET /ck')).toBeUndefined()
      })

      it('flushes declared key-groups on a successful mutation when cache is enabled', async () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 100 })
        cacheSet('grp::|anon|::GET /a', 1)
        const { onSend } = buildCacheHooks({ enabled: false, keyGroup: 'x', invalidates: ['grp'] } as any)
        await onSend(mockReq({ method: 'POST', url: '/mutate' }) as any, mockReply(200) as any, 'ok')
        expect(cacheGet('grp::|anon|::GET /a')).toBeUndefined() // flushed
      })

      it('skips invalidation entirely when the cache is globally disabled (no store scan)', async () => {
        // Master switch off: even an inherited `invalidates` must be a no-op, since a
        // volatile in-memory store is empty after (re)start. cacheSet ignores the switch,
        // so we can seed an entry and prove onSend leaves it untouched.
        configureCache({ enabled: false })
        cacheSet('grp::|anon|::GET /a', 1)
        const { onSend } = buildCacheHooks({ enabled: false, keyGroup: 'x', invalidates: ['grp'] } as any)
        await onSend(mockReq({ method: 'POST', url: '/mutate' }) as any, mockReply(200) as any, 'ok')
        expect(cacheGet('grp::|anon|::GET /a')).toBe(1) // untouched → invalidate was skipped
        configureCache({ enabled: true, ttl: 3600, maxEntries: 1000 }) // restore default
      })

      it('skips caching a tenant-scoped route when no tenant is resolved (multi-tenant)', async () => {
        configureCache({ enabled: true, ttl: 3600, maxEntries: 100 })
        const prev = (global as any).config
        ;(global as any).config = { options: { multi_tenant: { enabled: true } } }
        const { onSend } = buildCacheHooks({ enabled: true, keyGroup: 'g' } as any)
        const reply = mockReply(200, { 'content-type': 'application/json' })
        // tenantContext defaults to on and req.tenant is missing → skip to avoid cross-tenant leak.
        await onSend(mockReq({ method: 'GET', url: '/mt', routeOptions: { config: {} } }) as any, reply as any, '{"x":1}')
        expect(cacheGet('g::|anon|::GET /mt')).toBeUndefined()
        ;(global as any).config = prev
      })
    })
  })
}
