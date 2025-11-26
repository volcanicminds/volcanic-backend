import type { GeneralConfig } from '../../types/global.js'
import { normalizePatterns } from '../util/path.js'
import { globSync } from 'glob'

export async function load() {
  const generalConfig: GeneralConfig = {
    name: 'general',
    enable: true,
    options: {
      allow_multiple_admin: false,
      reset_external_id_on_login: false,
      scheduler: false,
      embedded_auth: true
    }
  }

  const patterns = normalizePatterns(['..', 'config', 'general.{ts,js}'], ['src', 'config', 'general.{ts,js}'])

  for (const pattern of patterns) {
    log.t && log.trace('Looking for ' + pattern)
    const files = globSync(pattern, { windowsPathsNoEscape: true })

    for (const f of files) {
      const module = await import(f)
      const config: GeneralConfig = module.default || module

      if (config.name === generalConfig.name) {
        generalConfig.enable = config.enable
        generalConfig.options = {
          ...generalConfig.options,
          ...(config.options || {})
        }
      }
    }
  }

  log.d && log.debug('General configuration loaded')
  return generalConfig
}
