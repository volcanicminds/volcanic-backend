import type { GeneralConfig } from '../../types/global.js'
import { normalizePatterns } from '../util/path.js'
import { globSync } from 'glob'

export async function load() {
  const generalConfig: GeneralConfig = {
    name: 'general',
    options: {
      allow_multiple_admin: false,
      admin_can_change_passwords: false,
      reset_external_id_on_login: false,
      scheduler: false,
      embedded_auth: true,
      mfa_admin_forced_reset_email: undefined,
      mfa_admin_forced_reset_until: undefined
    }
  }

  const patterns = normalizePatterns(['..', 'config', 'general.{ts,js}'], ['src', 'config', 'general.{ts,js}'])

  for (const pattern of patterns) {
    if (log.t) log.trace('Looking for ' + pattern)
    const files = globSync(pattern, { windowsPathsNoEscape: true })

    for (const f of files) {
      const module = await import(f)
      const config: GeneralConfig = module.default || module

      if (config.name === generalConfig.name) {
        generalConfig.options = {
          ...generalConfig.options,
          ...(config.options || {})
        }
      }
    }
  }

  if (log.d) log.debug('General configuration loaded')
  return generalConfig
}
