import { GeneralConfig } from '../../types/global'
import { normalizePatterns } from '../util/path'
const glob = require('glob')

export function load() {
  const generalConfig: GeneralConfig = {
    name: 'general',
    enable: true,
    options: {
      reset_external_id_on_login: false,
      scheduler: false
    }
  }

  const patterns = normalizePatterns(['..', 'config', 'general.{ts,js}'], ['src', 'config', 'general.{ts,js}'])
  patterns.forEach((pattern) => {
    log.t && log.trace('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string) => {
      const config: GeneralConfig = require(f)

      if (config.name === generalConfig.name) {
        generalConfig.enable = config.enable
        generalConfig.options = {
          ...generalConfig.options,
          ...(config.options || {})
        }
      }
    })
  })

  log.d && log.debug('General configuration loaded')
  return generalConfig
}
