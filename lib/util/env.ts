'use strict'

//
// Reading a number out of the environment, once and in one place.
//
// The rule this file serves is an invariant, not a preference: **the declared default is what
// the code does**, and no field is typed, documented and never read.
//
// So a helper, and its whole job is refusing to be clever: a value that does not parse falls
// back to the default and **says so**, because the failure mode of silence here is a limit
// nobody set behaving like a limit somebody chose.
//
// `lib/database/env.ts` is the data layer's copy of this file. See the note there.
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
