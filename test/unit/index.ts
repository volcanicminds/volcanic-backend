import semver from './semver.js'
import translation from './translation.js'
import secret from './secret.js'
import regexp from './regexp.js'
import plugins from './plugins.js'

export default function load() {
  describe('Unit', () => {
    semver()
    translation()
    secret()
    regexp()
    plugins()
  })
}
