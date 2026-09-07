import type { Engine, TenantStrategy, GeneralConfig } from '../../types/global.js'

//
// The capability matrix: which strategies each adapter actually supports.
//
// It is a property of the code, not a setting: a cell turns to `yes` only when the code and
// the test that hold it exist. A consumer cannot widen it, because the point of it is to
// refuse a combination the framework cannot honour — in v4 declaring multi-tenant on Mongo
// logged a warning and then served every request against the whole database, with no
// isolation whatsoever (D-04). Fail-closed at boot is invariant 2.
//
type Support = Record<TenantStrategy | 'none', boolean>

const MATRIX: Record<Engine, Support> = {
  // strategy →           none   schema  container
  postgres: { none: true, schema: true, container: true },
  // No schemas exist here. Emulating them with table prefixes would be the `row` strategy
  // under another name, and the framework does not promise an isolation it cannot impose.
  sqlite: { none: true, schema: false, container: true },
  libsql: { none: true, schema: false, container: true },
  // One connection, shared by every request: usable for development and unit tests, never
  // for isolation. Refused with tenants declared in production.
  pglite: { none: true, schema: false, container: false }
}

export type ResolvedTenancy = { engine: Engine; strategy: TenantStrategy | 'none' }

export function supports(engine: Engine, strategy: TenantStrategy | 'none'): boolean {
  return MATRIX[engine]?.[strategy] === true
}

/** Every combination the matrix does support, for error messages that suggest a way out. */
export function supportedCombinations(): string[] {
  const out: string[] = []
  for (const engine of Object.keys(MATRIX) as Engine[]) {
    for (const strategy of ['none', 'schema', 'container'] as (TenantStrategy | 'none')[]) {
      if (MATRIX[engine][strategy]) out.push(`${engine} + ${strategy}`)
    }
  }
  return out
}

export function resolveTenancy(options: GeneralConfig['options']): ResolvedTenancy {
  const control = options?.control
  const tenants = options?.tenants
  return {
    engine: (tenants?.engine || control?.engine || 'postgres') as Engine,
    strategy: (tenants?.strategy || 'none') as TenantStrategy | 'none'
  }
}

export interface AssertOptions {
  prod?: boolean
  /** Injected by the tests so a refusal does not kill the test process; defaults to exit(1). */
  onFatal?: (message: string) => void
}

/**
 * Refuses to start on a combination the framework cannot isolate. Called by the data layer
 * as soon as the options are resolved, before a single connection is opened.
 */
export function assertSupported(options: GeneralConfig['options'], opts: AssertOptions = {}): void {
  const prod = opts.prod ?? process.env.NODE_ENV === 'production'
  const onFatal =
    opts.onFatal ||
    ((message: string) => {
      if (log?.f) log.fatal(message)
      process.exit(1)
    })

  const { engine, strategy } = resolveTenancy(options)
  const control = options?.control?.engine as Engine | undefined

  if (!MATRIX[engine]) {
    return onFatal(
      `Tenancy: unknown engine '${engine}'. Supported engines: ${Object.keys(MATRIX).join(', ')}.`
    )
  }

  if (control && !MATRIX[control]) {
    return onFatal(`Tenancy: unknown control engine '${control}'. Supported: ${Object.keys(MATRIX).join(', ')}.`)
  }

  if (!supports(engine, strategy)) {
    return onFatal(
      `Tenancy: '${engine}' does not support strategy '${strategy}'. ` +
        `Supported combinations: ${supportedCombinations().join(', ')}. ` +
        `Change options.tenants in your configuration (docs/CONFIGURATION_V5.md §2).`
    )
  }

  if (prod && strategy !== 'none' && (engine === 'pglite' || control === 'pglite')) {
    return onFatal(
      'Tenancy: pglite hands out a single shared connection, so tenants cannot be isolated. ' +
        'It is for development and unit tests only: use postgres in production.'
    )
  }
}
