/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { generateManifest } from '@volcanicminds/backend'

export default () => {
  describe('Admin manifest (BE-5)', () => {
    it('GET /admin/manifest requires auth (401 without a token)', async () => {
      const res = await (global as any).server.inject({ method: 'GET', url: '/admin/manifest' })
      expect(res.statusCode).toBe(401)
    })

    it('generateManifest(server) builds a valid v2 manifest from the live routes', () => {
      const m: any = generateManifest((global as any).server)
      expect(m.version).toBe(2)
      expect(Array.isArray(m.resources)).toBe(true)
      expect(m.resources.length).toBeGreaterThan(0)

      const allowed = new Set(['list', 'read', 'create', 'update', 'delete', 'action'])
      const allCaps = [...m.resources.flatMap((r: any) => r.capabilities), ...(m.capabilities || [])]
      for (const c of allCaps) {
        expect(allowed.has(c.kind)).toBe(true)
        expect(typeof c.path).toBe('string')
        expect(Array.isArray(c.roles)).toBe(true)
      }
      // the enabled admin route surfaces as an operation capability
      expect(allCaps.map((c: any) => c.path)).toContain('/admin/manifest')
    })
  })
}
