import { expect } from 'expect'
import { createRequire } from 'module'
import plugins from '../../lib/config/plugins.js'

const require = createRequire(import.meta.url)
const pkg = require('../../package.json')

// S4 — secure-by-default plugin configuration + GraphQL removal.
export default () => {
  describe('Plugin defaults (S4)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byName = (n: string) => (plugins as any[]).find((p) => p.name === n)

    it('enables helmet (security headers) by default', () => {
      expect(byName('helmet')?.enable).toBe(true)
    })

    it('registers cors', () => {
      expect(byName('cors')).toBeDefined()
    })

    it('no longer ships the GraphQL/Apollo dependencies', () => {
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
      expect(deps['@apollo/server']).toBeUndefined()
      expect(deps['@as-integrations/fastify']).toBeUndefined()
      expect(deps['graphql']).toBeUndefined()
    })
  })
}
