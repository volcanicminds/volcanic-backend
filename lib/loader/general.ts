import type { GeneralConfig } from '../../types/global.js'
import { normalizePatterns } from '../util/path.js'
import { deepMerge } from '../util/merge.js'
import { globSync } from 'glob'


// Defaults of the `tenants` block. They are applied only when the block is declared: the
// block being absent is what "single tenant" means, and filling it with defaults would turn
// every deployment into a multi-tenant one by accident.
//
// They live here, not in the block itself, for the reason D-21 taught: a consumer declaring
// one key must not lose the others, and a default nobody applies is a lie in a document
// (that was D-11, the `resolver` that was documented, typed, and never read).
const TENANTS_DEFAULTS = {
  resolver: 'header',
  headerKey: 'x-tenant-id',
  subdomainLevel: 1,
  containers: {
    maxOpen: 20,
    idleTimeoutMs: 300000,
    poolMax: 2,
    directory: './data/tenants'
  },
  migrations: {
    checkOnResolve: true,
    refuseStartIfControlBehind: true
  }
}

/** Applies the conditional defaults after the merge. Exported so it can be tested directly. */
export function normalizeOptions<T extends Record<string, any>>(options: T): T {
  const tenants = (options as any).tenants
  if (!tenants || typeof tenants !== 'object') return options
  return { ...options, tenants: deepMerge(TENANTS_DEFAULTS, tenants) }
}

export async function load() {
  const generalConfig: GeneralConfig = {
    name: 'general',
    options: {
      allow_multiple_admin: false,
      allow_admin_change_password_users: false,
      reset_external_id_on_login: false,
      scheduler: false,
      embedded_auth: true,
      mfa_admin_forced_reset_email: undefined,
      mfa_admin_forced_reset_until: undefined,
      control: {
        engine: 'postgres'
      },
      tenants: null,
      manifest: {
        enabled: false
      },
      cache: {
        enabled: false
      }
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
        // Deep merge, not a spread: a spread is one level deep, so declaring a single key
        // inside a nested block erased its siblings — writing `tenants: { strategy }` would
        // drop `resolver` and `headerKey` and leave the framework running on undefined
        // values it documents as defaults. That was defect D-21. See lib/util/merge.ts.
        generalConfig.options = deepMerge(generalConfig.options, config.options)
      }
    }
  }

  generalConfig.options = normalizeOptions(generalConfig.options)

  if (log.d) log.debug('General configuration loaded')
  return generalConfig
}
