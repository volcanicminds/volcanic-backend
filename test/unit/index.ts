import semver from './semver.js'
import translation from './translation.js'
import secret from './secret.js'
import regexp from './regexp.js'
import plugins from './plugins.js'
import tenants from './tenants.js'
import yn from './yn.js'
import common from './common.js'
import generate from './generate.js'
import path from './path.js'
import managers from './managers.js'
import manifest from './manifest.js'

export default function load() {
  describe('Unit', () => {
    semver()
    translation()
    secret()
    regexp()
    plugins()
    tenants()
    yn()
    common()
    generate()
    path()
    managers()
    manifest()
  })
}
