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
import routes from './routes.js'
import cache from './cache.js'
import onError from './onError.js'
import tracker from './tracker.js'
import config from './config.js'

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
    routes()
    cache()
    onError()
    tracker()
    config()
  })
}
