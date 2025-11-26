import { normalizePatterns } from '../util/path.js'
import { globSync } from 'glob'

export async function load() {
  const plugins: any = {}

  const patterns = normalizePatterns(['..', 'config', 'plugins.{ts,js}'], ['src', 'config', 'plugins.{ts,js}'])

  for (const pattern of patterns) {
    log.t && log.trace('Looking for ' + pattern)
    const files = globSync(pattern, { windowsPathsNoEscape: true })

    for (const f of files) {
      const module = await import(f)
      const configPlugins = module.default || module

      configPlugins.forEach((plugin) => {
        plugins[plugin.name] = plugin.enable ? plugin.options : false
        log.t && log.trace(`* Plugin ${plugin.name} ${plugin.enable ? 'enabled' : 'disabled'}`)
      })
    }
  }

  const enabledPulgins = Object.keys(plugins).filter((p) => !!plugins[p])
  log.d && log.debug(`Plugins loaded: ${enabledPulgins.length > 0 ? enabledPulgins.join(', ') : 0}`)
  return plugins
}
