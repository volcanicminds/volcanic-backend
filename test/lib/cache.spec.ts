/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-3.6: a cache entry belongs to one container, and says so.
//
// Defect D-15 was not "the cache leaked": it was a key that happened to be unique. In v4 the
// data layer keyed on the SQL, and with a schema-per-tenant strategy the SQL of two tenants
// is the same string. The response cache was already scoped correctly, which is exactly why
// the container is now written into the key explicitly rather than inferred: isolation that
// holds by accident holds until something else changes.
//
import { expect } from 'expect'
import {
  configureCache,
  cacheGet,
  cacheSet,
  invalidateCache,
  keyFor,
  containerOf,
  defaultTtlFor,
  cacheStats
} from '../../lib/util/cache.js'

;(global as any).log = {}

const req = (over: any = {}): any => ({
  method: 'GET',
  url: '/orders',
  roles: () => ['admin'],
  ...over
})

const withTenancy = (on: boolean) => {
  ;(global as any).config = { options: { tenants: on ? { strategy: 'schema', engine: 'postgres' } : null } }
}

describe('util/cache · the container is part of the key (T-3.6)', () => {
  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('names the container, and names it differently for the control plane', () => {
    expect(containerOf(req())).toBe('control')
    expect(containerOf(req({ tenantInfo: { id: 'id-acme' } }))).toBe('tenant:id-acme')
  })

  it('keeps two tenants apart even when everything else about the request matches', () => {
    withTenancy(true)
    configureCache({ enabled: true, ttl: 60 })

    const acme = req({ tenantInfo: { id: 'id-acme' }, user: { externalId: 'u1' } })
    const globex = req({ tenantInfo: { id: 'id-globex' }, user: { externalId: 'u1' } })

    cacheSet(keyFor(acme, 'orders'), 'ACME ROWS')
    // Same user, same roles, same method, same url: in v4's data-layer cache this was the
    // same key, and the second tenant read the first one's rows.
    expect(cacheGet(keyFor(globex, 'orders'))).toBe(undefined)
    expect(cacheGet(keyFor(acme, 'orders'))).toBe('ACME ROWS')
  })

  it('keeps a control-scope response out of a tenant, and the other way round', () => {
    withTenancy(true)
    configureCache({ enabled: true, ttl: 60 })

    const platform = req({ url: '/tenants' })
    const inside = req({ url: '/tenants', tenantInfo: { id: 'id-acme' } })

    cacheSet(keyFor(platform, 'tenants'), 'REGISTRY')
    expect(cacheGet(keyFor(inside, 'tenants'))).toBe(undefined)
  })

  it('invalidates inside one container without touching the others', () => {
    withTenancy(true)
    configureCache({ enabled: true, ttl: 60 })

    const acme = req({ tenantInfo: { id: 'id-acme' } })
    const globex = req({ tenantInfo: { id: 'id-globex' } })
    cacheSet(keyFor(acme, 'orders'), 'ACME')
    cacheSet(keyFor(globex, 'orders'), 'GLOBEX')

    // A write inside one customer's container cannot have staled another customer's data.
    const removed = invalidateCache('orders', containerOf(acme))
    expect(removed).toBe(1)
    expect(cacheGet(keyFor(acme, 'orders'))).toBe(undefined)
    expect(cacheGet(keyFor(globex, 'orders'))).toBe('GLOBEX')

    // Called by hand without a container it still sweeps everything: that is a deliberate
    // administrative act, not a request's side effect.
    expect(invalidateCache('orders')).toBe(1)
  })
})

describe('util/cache · the default TTL follows the deployment (D-26)', () => {
  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('is an hour for a single application and a minute where there are tenants', () => {
    expect(defaultTtlFor(false)).toBe(3600)
    expect(defaultTtlFor(true)).toBe(60)
  })

  it('applies the shape it finds at boot', () => {
    withTenancy(false)
    expect(configureCache({ enabled: true }).ttl).toBe(3600)

    withTenancy(true)
    // The store is per process: an invalidation reaches one instance, and the TTL is what
    // bounds how long the others stay behind.
    expect(configureCache({ enabled: true }).ttl).toBe(60)
  })

  it('never overrides a number the consumer wrote', () => {
    withTenancy(true)
    expect(configureCache({ enabled: true, ttl: 900 }).ttl).toBe(900)
    expect(cacheStats().ttl).toBe(900)
  })
})
