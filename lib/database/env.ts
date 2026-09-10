'use strict'

//
// Reading a number out of the environment, once and in one place.
//
// The rule this file serves is an invariant, not a preference: **the declared default is what
// the code does**, and no field is typed, documented and never read. That was defect D-11 —
// `resolver: 'subdomain'` documented as the default of a resolver nothing consulted — and it
// came back anyway, in another shape: `VOLCANIC_MAX_PAGE_SIZE`, `TENANT_CONTAINERS_MAX_OPEN`,
// `TENANT_CONTAINERS_DIR` and `DESTRUCTION_TOKEN_TTL` were all in the documented environment
// table and read by nobody. Found by T-9.4, which set out to MEASURE the values these
// variables carry and discovered there was nowhere to put the answer.
//
// So a helper, and its whole job is refusing to be clever: a value that does not parse falls
// back to the default and **says so**, because the failure mode of silence here is a limit
// nobody set behaving like a limit somebody chose.
//
// This is the DATA LAYER's copy of `lib/util/env.ts`, and the duplication is deliberate for
// the same reason `lib/database/uuid.ts` duplicates the core's generator: the boundary checked
// in CI forbids the data layer from importing a runtime value out of the core, and forbids the
// core from importing one out of the data layer, so a shared module has nowhere to live that
// both sides may reach. Forty lines of a rule with no state is the cheaper of the two prices.
//

/** A positive integer from the environment, or the default. Never zero, never NaN. */
export function envInt(name: string, fallback: number, opts: { min?: number; max?: number } = {}): number {
  const raw = process.env[name]
  if (raw === undefined || String(raw).trim() === '') return fallback

  const value = Number(raw)
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    if (globalThis.log?.w) globalThis.log.warn(`${name}='${raw}' is not a positive integer: using ${fallback}`)
    return fallback
  }

  // Clamped rather than refused, and reported: a limit typed one digit too long should not
  // stop an instance from starting, and should not silently become what was typed either.
  const { min, max } = opts
  if (min !== undefined && value < min) {
    if (globalThis.log?.w) globalThis.log.warn(`${name}=${value} is below the minimum ${min}: using ${min}`)
    return min
  }
  if (max !== undefined && value > max) {
    if (globalThis.log?.w) globalThis.log.warn(`${name}=${value} is above the maximum ${max}: using ${max}`)
    return max
  }
  return value
}

/** A non-empty string from the environment, or the default. */
export function envString(name: string, fallback: string): string {
  const raw = process.env[name]
  return raw === undefined || String(raw).trim() === '' ? fallback : String(raw).trim()
}
