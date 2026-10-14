/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Deep merge for configuration objects.
//
// A spread is one level deep: declaring a single key inside a nested block would silently
// erase its siblings and leave the framework running with undefined values it documents as
// defaults.
//
// The rules, chosen to be predictable rather than clever:
//
//   - plain objects are merged recursively;
//   - arrays are REPLACED, never concatenated: an allowlist the consumer writes is the
//     allowlist, not the framework's plus theirs;
//   - `null` clears a value explicitly, `undefined` leaves the default in place;
//   - anything else (dates, class instances, functions) replaces wholesale.
//
// Keys that could reach `Object.prototype` are dropped: configuration files are code, but
// this function is small enough to be reused on data that is not.
//
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)

export function deepMerge<T extends Record<string, any>>(base: T, override: Record<string, any> | undefined | null): T {
  if (!override) return base
  const out: Record<string, any> = { ...base }

  for (const key of Object.keys(override)) {
    if (FORBIDDEN.has(key)) continue

    const value = override[key]
    if (value === undefined) continue
    if (value === null) {
      out[key] = null
      continue
    }

    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value
  }

  return out as T
}
