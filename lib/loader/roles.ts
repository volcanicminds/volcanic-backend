import type { Role, Roles } from '../../types/global.js'
import { normalizePatterns } from '../util/path.js'
import { globSync } from 'glob'

export async function load() {
  const roles: Roles = {}

  const patterns = normalizePatterns(['..', 'config', 'roles.{ts,js}'], ['src', 'config', 'roles.{ts,js}'])

  for (const pattern of patterns) {
    log.t && log.trace('Looking for ' + pattern)
    const files = globSync(pattern, { windowsPathsNoEscape: true })

    for (const f of files) {
      const module = await import(f)
      const configRoles = module.default || module

      configRoles.forEach((role: Role) => {
        roles[role.code] = role
      })
    }
  }

  log.d && log.debug('Roles loaded: ' + Object.keys(roles).join(', '))
  return roles
}
