/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { processRoute } from '../../lib/loader/router.js'

export default () => {
  describe('Routes introspection', () => {
    // BE-1 — apply() exposes the mounted routes on global.routes
    describe('global.routes (BE-1)', () => {
      it('is populated with the mounted routes after boot', () => {
        const routes = (global as any).routes
        expect(Array.isArray(routes)).toBe(true)
        expect(routes.length).toBeGreaterThan(0)
      })

      it('every route carries method, path (leading slash) and roles', () => {
        for (const r of (global as any).routes) {
          expect(typeof r.method).toBe('string')
          expect(r.path.startsWith('/')).toBe(true)
          expect(Array.isArray(r.roles)).toBe(true)
        }
      })

      it('includes the admin manifest route (enabled in the test boot)', () => {
        const found = (global as any).routes.find((r: any) => r.path === '/admin/manifest')
        expect(found).toBeDefined()
        expect(found.method).toBe('GET')
      })
    })

    // BE-2 — structural hints (group/resource) are threaded onto the route
    describe('structural hints (BE-2)', () => {
      const authMw = ['global.isAuthenticated', 'global.isAdmin']
      const base = '/abs/api/vehicles'
      const route = { method: 'GET', path: '/', handler: 'vehicle.list', roles: [], middlewares: [], config: {} }

      it('inherits file-level config.manifest hints (group, resource)', () => {
        const defaultConfig = {
          manifest: {
            group: 'catalog',
            resource: { name: 'vehicle', titleField: 'name', globalSearch: ['name', 'trimLevel'] }
          }
        }
        const cr: any = processRoute(route as any, 0, 'vehicles/routes.ts', 'vehicles', base, defaultConfig, authMw, [])
        expect(cr).not.toBeNull()
        expect(cr.group).toBe('catalog')
        expect(cr.resource.name).toBe('vehicle')
        expect(cr.resource.titleField).toBe('name')
        expect(cr.resource.globalSearch).toEqual(['name', 'trimLevel'])
      })

      it('lets a per-route config.manifest override the file-level hints', () => {
        const defaultConfig = { manifest: { group: 'catalog', resource: { name: 'vehicle' } } }
        const overriding = { ...route, config: { manifest: { group: 'crm', resource: { name: 'lead' } } } }
        const cr: any = processRoute(overriding as any, 1, 'vehicles/routes.ts', 'vehicles', base, defaultConfig, authMw, [])
        expect(cr.group).toBe('crm')
        expect(cr.resource.name).toBe('lead')
      })
    })

    describe('per-route cache config (processRoute)', () => {
      const authMw2 = ['global.isAuthenticated', 'global.isAdmin']
      const mk = (cache: any, dir = 'public') =>
        processRoute(
          { method: 'GET', path: '/', handler: 'public.list', cache } as any,
          0,
          `${dir}/routes.ts`,
          dir,
          `/base/${dir}`,
          {},
          authMw2,
          []
        ) as any

      it('cache:true → enabled, key-group defaults to the api folder', () => {
        expect(mk(true).cache).toEqual({ enabled: true, ttl: undefined, keyGroup: 'public', invalidates: undefined })
      })
      it('cache:<number> → TTL shortcut in seconds', () => {
        expect(mk(3600).cache.ttl).toBe(3600)
      })
      it('cache object: key-group override + invalidates coerced to array', () => {
        const cr = mk({ invalidates: 'public' }, 'vehicles')
        expect(cr.cache.keyGroup).toBe('vehicles')
        expect(cr.cache.invalidates).toEqual(['public'])
      })
      it('no cache prop → route.cache is undefined', () => {
        expect(mk(undefined).cache).toBeUndefined()
      })
      it('enabled:false with invalidates is kept (invalidation-only route)', () => {
        expect(mk({ enabled: false, invalidates: ['public'] }, 'vehicles').cache).toEqual({
          enabled: false,
          ttl: undefined,
          keyGroup: 'vehicles',
          invalidates: ['public']
        })
      })
      it('inherits the file-level config.cache when the route omits it', () => {
        const cr: any = processRoute(
          { method: 'GET', path: '/', handler: 'public.list' } as any,
          0,
          'public/routes.ts',
          'public',
          '/base/public',
          { cache: { ttl: 3600 } },
          authMw2,
          []
        )
        expect(cr.cache).toEqual({ enabled: true, ttl: 3600, keyGroup: 'public', invalidates: undefined })
      })
      it('a per-route cache overrides the file-level default', () => {
        const cr: any = processRoute(
          { method: 'GET', path: '/', handler: 'public.list', cache: false } as any,
          0,
          'public/routes.ts',
          'public',
          '/base/public',
          { cache: { ttl: 3600 } },
          authMw2,
          []
        )
        expect(cr.cache).toBeUndefined()
      })
    })

    describe('route config handling', () => {
      const authMw2 = ['global.isAuthenticated', 'global.isAdmin']
      const cfg = (config: any, extra: any = {}, defaultConfig: any = {}) =>
        processRoute(
          { method: 'GET', path: '/', handler: 'x.y', config, ...extra } as any,
          0,
          'x/routes.ts',
          'x',
          '/base',
          defaultConfig,
          authMw2,
          []
        ) as any

      it('tenantContext defaults to true and honors an explicit false', () => {
        expect(cfg({}).tenantContext).toBe(true)
        expect(cfg({ tenantContext: false }).tenantContext).toBe(false)
      })
      it('rawBody defaults to false and passes through when true', () => {
        expect(cfg({}).rawBody).toBe(false)
        expect(cfg({ rawBody: true }).rawBody).toBe(true)
      })
      it('forwards the route rateLimit', () => {
        expect(cfg({}, { rateLimit: { max: 5 } }).rateLimit).toEqual({ max: 5 })
      })
      it('flows the deprecated flag into the OpenAPI doc', () => {
        expect(cfg({ deprecated: true }).doc.deprecated).toBe(true)
      })
      it('inherits tags and version from the file-level defaultConfig', () => {
        const cr = cfg({}, {}, { tags: ['X'], version: 'v2' })
        expect(cr.doc.tags).toEqual(['X'])
        expect(cr.doc.version).toBe('v2')
      })
      it('honors an explicit config.security over the derived bearer', () => {
        expect(cfg({ security: 'apiKey' }).doc.security).toBe('apiKey')
      })
      it('trims a trailing slash from the mounted path', () => {
        const cr = processRoute(
          { method: 'GET', path: '/list/', handler: 'x.y' } as any,
          0,
          'x/routes.ts',
          'x',
          '/base',
          {},
          authMw2,
          []
        ) as any
        expect(cr.path).toBe('/x/list')
      })
    })

    describe('security derivation & route validation', () => {
      const authMw2 = ['global.isAuthenticated', 'global.isAdmin']
      const run = (route: any, valid: any[] = []) =>
        processRoute(route, 0, 'x/routes.ts', 'x', '/base', {}, authMw2, valid) as any

      it('derives bearer security for a role-protected (non-public) route', () => {
        const r = run({ method: 'GET', path: '/', handler: 'x.y', roles: [{ code: 'backoffice' }] })
        expect(r.doc.security).toEqual([{ Bearer: [] }])
      })
      it('does not force security for a purely public route', () => {
        expect(run({ method: 'GET', path: '/', handler: 'x.y' }).doc.security).toBeFalsy()
      })
      it('forces bearer when an auth middleware is attached, even if public', () => {
        const r = run({ method: 'GET', path: '/', handler: 'x.y', middlewares: ['global.isAuthenticated'] })
        expect(r.doc.security).toEqual([{ Bearer: [] }])
      })
      it('returns null for a disabled route', () => {
        expect(run({ method: 'GET', path: '/', handler: 'x.y', config: { enable: false } })).toBeNull()
      })
      it('returns null for a malformed handler', () => {
        expect(run({ method: 'GET', path: '/', handler: 'bogus' })).toBeNull()
      })
      it('returns null on a duplicated method+path', () => {
        const first = run({ method: 'GET', path: '/', handler: 'x.y' })
        expect(run({ method: 'GET', path: '/', handler: 'x.y' }, [first])).toBeNull()
      })
    })
  })
}
