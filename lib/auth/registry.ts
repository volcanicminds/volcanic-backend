import type { AuthPlane, Authenticator, AuthenticatorRegistry } from '../../types/global.js'
import { BUILTIN_AUTHENTICATORS } from './builtins.js'

const PLANES: readonly AuthPlane[] = ['tenant', 'control']
const KINDS: readonly string[] = ['identifier', 'verifier']

/** Refused when registered, so a malformed entry stops the boot instead of answering 500 at a login. */
function assertShape(candidate: Authenticator): void {
  const id = typeof candidate?.id === 'string' ? candidate.id.trim() : ''
  if (!id) throw new Error('Authenticators: every authenticator needs a non-empty `id`')
  if (!KINDS.includes(candidate.kind)) {
    throw new Error(`Authenticator '${id}': kind must be 'identifier' or 'verifier', got '${String(candidate.kind)}'`)
  }
  const planes: unknown = candidate.planes
  if (!Array.isArray(planes) || !planes.length || planes.some((p) => !PLANES.includes(p))) {
    throw new Error(`Authenticator '${id}': planes must list 'tenant', 'control' or both`)
  }
  if (typeof candidate.verify !== 'function') throw new Error(`Authenticator '${id}': verify must be a function`)
}

/**
 * One map per plane: an authenticator declared for the tenant plane only replaces nothing, and is
 * found by nothing, on the control plane. A second registration of an `id` replaces the first on
 * the planes it declares, and says so, because replacing a built-in changes how people log in.
 */
export function createAuthenticatorRegistry(): AuthenticatorRegistry {
  const byPlane: Record<AuthPlane, Map<string, Authenticator>> = { tenant: new Map(), control: new Map() }

  return {
    register(authenticator) {
      assertShape(authenticator)
      for (const plane of authenticator.planes) {
        const map = byPlane[plane]
        if (map.has(authenticator.id) && log?.w) {
          log.warn(`Authenticators: '${authenticator.id}' replaced on the ${plane} plane`)
        }
        map.set(authenticator.id, authenticator)
      }
    },
    get: (plane, id) => byPlane[plane]?.get(id),
    list: (plane) => [...(byPlane[plane]?.values() ?? [])]
  }
}

/** The built-ins, then what `start({ authenticators })` brought. */
export function buildAuthenticatorRegistry(injected: unknown = []): AuthenticatorRegistry {
  if (!Array.isArray(injected)) throw new Error('start({ authenticators }): expected an array of authenticators')

  const registry = createAuthenticatorRegistry()
  for (const authenticator of BUILTIN_AUTHENTICATORS) registry.register(authenticator)
  for (const authenticator of injected as Authenticator[]) registry.register(authenticator)
  return registry
}
