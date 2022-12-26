import { config } from 'dotenv'

const glob = require('glob')

export function load() {
  const plugins: any = {}

  const patterns = [`${__dirname}/../config/plugins.{ts,js}`, `${process.cwd()}/src/config/plugins.{ts,js}`]
  patterns.forEach((pattern) => {
    log.t && log.trace('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string) => {
      const configPlugins = require(f)
      configPlugins.forEach((plugin) => {
        plugins[plugin.name] = plugin.enable ? plugin.options : false
        log.t && log.trace(`* Plugin ${plugin.name} ${plugin.enable ? 'enabled' : 'disabled'}`)
      })
    })
  })
  const enabledPulgins = Object.keys(plugins).filter((p) => !!plugins[p])
  log.d && log.debug(`Plugins loaded: ${enabledPulgins.length > 0 ? enabledPulgins.join(', ') : 0}`)
  return plugins
}
