import { Role, Roles } from '../../types/global'
import { normalizePatterns } from '../util/path'
const glob = require('glob')

export function load() {
  const roles: Roles = {}

  const patterns = normalizePatterns(['..', 'config', 'roles.{ts,js}'], ['src', 'config', 'roles.{ts,js}'])
  patterns.forEach((pattern) => {
    log.t && log.trace('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string) => {
      const configRoles = require(f)

      configRoles.forEach((role: Role) => {
        roles[role.code] = role
      })
    })
  })
  log.d && log.debug('Roles loaded: ' + Object.keys(roles).join(', '))
  return roles
}
