import { expect } from 'expect'
import { normalizePatterns } from '../../lib/util/path.js'

// Glob pattern builder used by the autodiscovery loaders (framework + consumer).
export default () => {
  describe('normalizePatterns (path)', () => {
    it('returns two POSIX-style absolute patterns', () => {
      const [framework, consumer] = normalizePatterns(['a', 'b'], ['c', 'd'])
      expect(typeof framework).toBe('string')
      expect(typeof consumer).toBe('string')
      // Windows backslashes are always normalized away.
      expect(framework).not.toContain('\\')
      expect(consumer).not.toContain('\\')
    })

    it('anchors the second pattern to the current working directory', () => {
      const cwd = process.cwd().replaceAll('\\', '/')
      const [, consumer] = normalizePatterns([], ['api', 'routes.ts'])
      expect(consumer.startsWith(cwd)).toBe(true)
      expect(consumer.endsWith('api/routes.ts')).toBe(true)
    })
  })
}
