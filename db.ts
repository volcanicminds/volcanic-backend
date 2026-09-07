//
// `@volcanicminds/backend/db` — the data layer entry point.
//
// The subpath carries no engine name: in v4 it was `/typeorm`, so the ORM was part of the
// public API and changing it became a breaking change for every consumer (invariant 10).
// What lives behind it is Drizzle today and is nobody's business tomorrow.
//
// The implementation arrives in phase 2, task by task: schema (T-2.1), Postgres adapter
// (T-2.2), SQLite and libSQL (T-2.3), Magic Query (T-2.4), managers (T-2.5), async key
// derivation (T-2.6). What is real here already is the contract — the ports every adapter
// implements — and the capability matrix, which refuses a combination the framework cannot
// isolate before a single connection is opened.
//
import { assertSupported } from './lib/database/capabilities.js'
import type { DataLayerOptions } from './lib/database/ports.js'

export * from './lib/database/ports.js'
export {
  assertSupported,
  supports,
  supportedCombinations,
  resolveTenancy
} from './lib/database/capabilities.js'

/**
 * Starts the data layer and returns the managers to inject into `start(decorators)`.
 *
 * The capability check runs first and on purpose: a configuration the framework cannot
 * honour must stop the boot, not surface later as a request that silently reads the wrong
 * container. That is invariant 2, and D-04 is what happens without it.
 */
export async function start(options?: DataLayerOptions) {
  const resolved = options ?? (global as any).config?.options
  assertSupported(resolved)

  throw new Error(
    'The Drizzle data layer is not implemented yet: phase 2 of EVO_FRAMEWORK.md builds it, ' +
      'against docs/SCHEMA_V5.md and docs/MANAGERS_V5.md. Until then a consumer must inject its own managers.'
  )
}
