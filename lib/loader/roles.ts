import type { FrameworkSystemCapability, Role, Roles, SystemCapability, SystemRole, SystemRoles } from '../../types/global.js'
import { normalizePatterns } from '../util/path.js'
import { globSync } from 'glob'
import builtinSystemRoles from '../config/systemRoles.js'

// `admin` and `public` are protected built-ins: a consumer's config/roles.ts may
// override only their labels (name/description); their `code` and `capabilities`
// are locked. Every other role code is added/overridden in full. Framework defaults
// are loaded first, so by the time a consumer's roles are applied the protected
// codes already exist. See docs/AUTHORIZATION_MODEL.md §2.3.
export const PROTECTED_ROLE_CODES = ['admin', 'public']

/** The namespace that separates the two catalogues. A code is in one or the other, never both. */
export const SYSTEM_PREFIX = 'system:'

/**
 * The framework's part of the control catalogue (docs/AUTHORIZATION_V5.md §4). A project or a
 * package adds its own in its `config/systemRoles.ts`; these stay the framework's.
 */
export const SYSTEM_CAPABILITIES: readonly FrameworkSystemCapability[] = [
  'tenants:read',
  'tenants',
  'tenants:impersonate',
  'tenants:destroy',
  'migrations',
  'manifest',
  'system-users',
  'access-log',
  'governance-log'
]

/**
 * The capability names both catalogues reserve, each for its own plane. `manifest`
 * reads the console manifest: `/admin/manifest` with the tenant catalogue, `/system/manifest`
 * with the control one. `governance-log` reads the governance log of the plane: `/governance-log`
 * a tenant's own, `/system/governance-log` the control plane's. Everything else in the
 * control catalogue stays refused on a tenant route.
 */
export const SHARED_CAPABILITIES: readonly FrameworkSystemCapability[] = ['manifest', 'governance-log']

export const isSystemRoleCode = (code: unknown): boolean => typeof code === 'string' && code.startsWith(SYSTEM_PREFIX)


/** Built-in control roles: labels are a consumer's to change, codes and capabilities are not. */
export const PROTECTED_SYSTEM_ROLE_CODES = builtinSystemRoles.map((r) => r.code)

/**
 * Merge one config file's roles into the accumulator with the protected-merge rule.
 * Pure (its only effect is on the passed `roles` map) so it is unit-tested directly.
 */
export function mergeRoles(roles: Roles, configRoles: Role[]): Roles {
  const protectedCodes = new Set(PROTECTED_ROLE_CODES)

  for (const role of configRoles || []) {
    if (!role?.code) continue

    // The tenant catalogue does not accept a control role, whatever it declares. TypeScript
    // cannot subtract the `system:` prefix from `string` (see types/global.d.ts), so the
    // separation is kept here, where the two lists are actually built.
    if (isSystemRoleCode(role.code)) {
      if (log?.e) log.error(`Roles: '${role.code}' is a control role and does not belong in config/roles.ts. Declare it in config/systemRoles.ts`)
      continue
    }

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

/**
 * The control catalogue, merged with the same protected rule and one more: a role that does
 * not carry the `system:` prefix is not a control role, and a capability outside `capabilities`
 * is refused rather than stored. A capability nobody honours is a permission that looks granted,
 * which is worse than one that is missing.
 */
export function mergeSystemRoles(roles: SystemRoles, configRoles: SystemRole[], capabilities: readonly SystemCapability[]): SystemRoles {
  const protectedCodes = new Set<string>(PROTECTED_SYSTEM_ROLE_CODES)

  for (const role of configRoles || []) {
    if (!role?.code) continue

    if (!isSystemRoleCode(role.code)) {
      if (log?.e) log.error(`Roles: control role '${role.code}' must be named '${SYSTEM_PREFIX}<something>'`)
      continue
    }

    const unknown = (role.capabilities || []).filter((c) => !capabilities.includes(c))
    if (unknown.length) {
      if (log?.e) log.error(`Roles: control role '${role.code}' names capabilities outside the catalogue: ${unknown.join(', ')}`)
      continue
    }

    const existing = roles[role.code]
    if (existing && protectedCodes.has(role.code)) {
      if (typeof role.name === 'string') existing.name = role.name
      if (typeof role.description === 'string') existing.description = role.description
      if (role.capabilities?.length && log?.w) {
        log.warn(`Roles: capabilities on protected control role '${role.code}' are ignored`)
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

/**
 * The capabilities a `config/systemRoles.ts` declares beside its roles, as the named export
 * `capabilities`. A name the framework reserves, or one that is not a plain word, is refused:
 * declaring `tenants:destroy` again would not make it a project's.
 */
export function declaredCapabilities(value: unknown, file: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    if (log?.e) log.error(`Roles: ${file} exports \`capabilities\` that is not a list of names`)
    return []
  }
  return value.filter((c) => {
    const valid = typeof c === 'string' && /^[a-z][a-z0-9:-]*$/.test(c) && !SYSTEM_CAPABILITIES.includes(c as never)
    if (!valid && log?.e) log.error(`Roles: ${file} declares the control capability '${String(c)}', reserved or not a name`)
    return valid
  })
}

/**
 * The control catalogue: the framework's roles and capabilities, plus whatever a project or a
 * package declares in its own file. Every capability is collected before any role is merged, so
 * a role may name one declared in another file, and a role naming one declared nowhere is dropped.
 */
export async function loadSystem(): Promise<{ roles: SystemRoles; capabilities: readonly SystemCapability[] }> {
  const patterns = normalizePatterns(
    ['..', 'config', 'systemRoles.{ts,js}'],
    ['src', 'config', 'systemRoles.{ts,js}']
  )

  const modules: { file: string; roles: SystemRole[] }[] = []
  const capabilities = new Set<SystemCapability>(SYSTEM_CAPABILITIES)
  for (const pattern of patterns) {
    const files = globSync(pattern, { windowsPathsNoEscape: true })
    for (const f of files) {
      const module = await import(f)
      // A file may declare capabilities alone, with no roles.
      const declared = module.default || module
      modules.push({ file: f, roles: Array.isArray(declared) ? (declared as SystemRole[]) : [] })
      for (const c of declaredCapabilities(module.capabilities, f)) capabilities.add(c)
    }
  }

  const catalogue = [...capabilities]
  const roles: SystemRoles = {}
  mergeSystemRoles(roles, builtinSystemRoles, catalogue)
  // The framework's own file is one of the matches: merging it twice is a no-op.
  for (const { roles: declared } of modules) mergeSystemRoles(roles, declared, catalogue)

  if (log.i) log.info('System roles loaded: ' + Object.keys(roles).join(', '))
  if (catalogue.length > SYSTEM_CAPABILITIES.length && log.i) {
    log.info('Control capabilities declared: ' + catalogue.slice(SYSTEM_CAPABILITIES.length).join(', '))
  }
  return { roles, capabilities: catalogue }
}
