/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'

// Verifies the general loader's default option surface survives the shallow merge
// at boot (guards the cache defaults added in 3.5.0 and the core options).
export default () => {
  describe('Config (global.config.options)', () => {
    const opts = (): any => (global as any).config?.options || {}

    it('exposes the cache defaults from the general loader', () => {
      const c = opts().cache
      expect(c).toBeDefined()
      expect(c.enabled).toBe(true)
      expect(c.ttl).toBe(3600)
      expect(c.maxEntries).toBe(1000)
    })

    it('carries the core option surface (embedded_auth, multi_tenant, manifest)', () => {
      const o = opts()
      expect(typeof o.embedded_auth).toBe('boolean')
      expect(o.multi_tenant).toBeDefined()
      expect(typeof o.multi_tenant.enabled).toBe('boolean')
      expect(o.manifest).toBeDefined()
    })

    it('the roles loader exposes the built-in public and admin roles', () => {
      const roles = (global as any).roles || {}
      expect(roles.public?.code).toBe('public')
      expect(roles.admin?.code).toBe('admin')
    })
  })
}
