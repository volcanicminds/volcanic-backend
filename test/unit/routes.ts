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
  })
}
