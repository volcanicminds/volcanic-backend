import type { Role, Roles } from '../../types/global.js'
import { normalizePatterns } from '../util/path.js'
import { globSync } from 'glob'

// `admin` and `public` are protected built-ins: a consumer's config/roles.ts may
// override only their labels (name/description); their `code` and `capabilities`
// are locked. Every other role code is added/overridden in full. Framework defaults
// are loaded first, so by the time a consumer's roles are applied the protected
// codes already exist. See docs/AUTHORIZATION_MODEL.md §2.3.
export const PROTECTED_ROLE_CODES = ['admin', 'public']

/**
 * Merge one config file's roles into the accumulator with the protected-merge rule.
 * Pure (its only effect is on the passed `roles` map) so it is unit-tested directly.
 */
export function mergeRoles(roles: Roles, configRoles: Role[]): Roles {
  const protectedCodes = new Set(PROTECTED_ROLE_CODES)

  for (const role of configRoles || []) {
    if (!role?.code) continue

    const existing = roles[role.code]
    if (existing && protectedCodes.has(role.code)) {
      // Protected built-in: only labels are overridable; code + capabilities locked.
      if (typeof role.name === 'string') existing.name = role.name
      if (typeof role.description === 'string') existing.description = role.description
      if (role.capabilities?.length && log?.w) {
        log.warn(`Roles: capabilities on protected role '${role.code}' are ignored`)
      }
    } else {
      roles[role.code] = role
    }
  }

  return roles
}

export async function load() {
  const roles: Roles = {}

  const patterns = normalizePatterns(['..', 'config', 'roles.{ts,js}'], ['src', 'config', 'roles.{ts,js}'])

  for (const pattern of patterns) {
    if (log.t) log.trace('Looking for ' + pattern)
    const files = globSync(pattern, { windowsPathsNoEscape: true })

    for (const f of files) {
      const module = await import(f)
      mergeRoles(roles, (module.default || module) as Role[])
    }
  }

  if (log.i) log.info('Roles loaded: ' + Object.keys(roles).join(', '))
  return roles
}
