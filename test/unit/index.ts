import semver from './semver.js'
import translation from './translation.js'

export default function load() {
  describe('Unit', () => {
    semver()
    translation()
  })
}
