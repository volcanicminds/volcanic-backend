import { expect } from 'expect'
import { createRequire } from 'module'
import semver from 'semver'

const require = createRequire(import.meta.url)
const pkg = require('../../package.json')

export default () => {
  describe('Semver', () => {
    it('should be semantic versioning', async () => {
      expect(semver.valid(pkg.version)).not.toBeNull()
    })
  })
}
