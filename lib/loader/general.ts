import type { GeneralConfig } from '../../types/global.js'
import { normalizePatterns } from '../util/path.js'
import { deepMerge } from '../util/merge.js'
import { globSync } from 'glob'


// Defaults of the `tenants` block. They are applied only when the block is declared: the
// block being absent is what "single tenant" means, and filling it with defaults would turn
// every deployment into a multi-tenant one by accident.
//
// They live here, not in the block itself: a consumer declaring one key must not lose the
// others, and a default nobody applies is a lie in a document.
const TENANTS_DEFAULTS = {
  resolver: 'header',
  headerKey: 'x-tenant-id',
  subdomainLevel: 1,
  // `maxOpen` is deliberately absent. It has an environment variable,
  // `TENANT_CONTAINERS_MAX_OPEN`, and the adapter reads `configured ?? environment ?? default`.
  // Filling it here would make "configured" true for everyone, so the `??` would never reach
  // the environment. Its default (20) lives once, next to the environment read, in
  // `lib/database/adapters/postgres/index.ts`.
  containers: {
    idleTimeoutMs: 300000,
    poolMax: 2
  },
  migrations: {
    checkOnResolve: true,
    refuseStartIfControlBehind: true
  }
}

/** Applies the conditional defaults after the merge. Exported so it can be tested directly. */
export function normalizeOptions<T extends object>(options: T): T {
  const tenants = (options as { tenants?: unknown }).tenants
  if (!tenants || typeof tenants !== 'object') return options
  return { ...options, tenants: deepMerge(TENANTS_DEFAULTS, tenants) }
}

export async function load() {
  // The framework's defaults are ONE file, `lib/config/general.ts`, found by the first pattern
  // below and merged before the project's own. A default written twice is a default that will
  // disagree with itself, so the base is empty and the framework file is required to be found.
  let options: Record<string, unknown> = {}
  let frameworkDefaults = false

  const [frameworkPattern, projectPattern] = normalizePatterns(
    ['..', 'config', 'general.{ts,js}'],
    ['src', 'config', 'general.{ts,js}']
  )

  for (const pattern of [frameworkPattern, projectPattern]) {
    if (log.t) log.trace('Looking for ' + pattern)
    const files = globSync(pattern, { windowsPathsNoEscape: true })

    for (const f of files) {
      const module = await import(f)
      const config: GeneralConfig = module.default || module

      if (config.name === 'general') {
        // Deep merge, not a spread: a spread is one level deep, so a single key declared
        // inside a nested block would erase its siblings; `tenants: { strategy }` would drop
        // `resolver` and `headerKey` and leave the framework running on undefined values it
        // documents as defaults. See lib/util/merge.ts.
        options = deepMerge(options, config.options)
        if (pattern === frameworkPattern) frameworkDefaults = true
      }
    }
  }

  if (!frameworkDefaults) {
    // Not a warning: without this file every default is `undefined`, and the framework would
    // run on values it documents as something else.
    throw new Error(`General configuration: the framework defaults were not found at ${frameworkPattern}`)
  }

  const generalConfig: GeneralConfig = {
    name: 'general',
    options: normalizeOptions(options) as GeneralConfig['options']
  }

  if (log.d) log.debug('General configuration loaded')
  return generalConfig
}
