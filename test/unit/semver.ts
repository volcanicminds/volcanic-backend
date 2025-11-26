import { expect } from 'expect'

export default () => {
  describe('Semver', () => {
    it('should test semver library', () => {
      const semver = require('semver')

      const verx = 'v1.2.3'
      const valid = semver.valid(verx)
      const clean = semver.clean(verx)

      const res1 = semver.satisfies(clean, '>1.0.0 <=1.2.4')
      const res2 = semver.satisfies(clean, '>1.0')
      const res3 = semver.satisfies(clean, '>1.0 <8.0')

      global.log.debug(verx + ' ' + valid + ' ' + clean)
      global.log.debug(res1 + ' ' + res2 + ' ' + res3)

      expect(res1).toBeTruthy()
      expect(res2).toBeTruthy()
      expect(res3).toBeTruthy()
    })
  })
}
