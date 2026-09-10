'use strict'

/**
 * CORS: the allowlist comes from the environment, and one combination refuses the boot
 * (defect D-16).
 *
 * v4 shipped `origin: '*'` together with `credentials: true`. That pair is not a lax setting,
 * it is a broken one: browsers refuse to honour credentials against a wildcard origin, so
 * cookie mode never worked cross-origin at all, and in bearer mode the wildcard leaves the
 * API callable from any page the user happens to visit. Nobody chose it — it was the default.
 *
 * v5 reads `CORS_ORIGINS`, a comma-separated allowlist, and grants `credentials` only when
 * that allowlist is not a wildcard. A deployment that really wants a public API says so by
 * writing `CORS_ORIGINS=*`, which is a sentence someone typed rather than a default nobody
 * read; in production the variable is required, so the wildcard can no longer arrive by
 * omission.
 */

import logger from './logger.js'

export type CorsOrigin = boolean | string | string[]

export type CorsCheck = { ok: boolean; fatal: boolean; reason?: string }

/** True for every spelling of "any origin" that @fastify/cors accepts. */
export function isWildcardOrigin(origin: unknown): boolean {
  if (origin === true || origin === '*') return true
  if (Array.isArray(origin)) return origin.some((o) => o === '*' || o === true)
  return false
}

/**
 * The allowlist as @fastify/cors wants it.
 *
 * An unset variable yields the wildcard, so development keeps working out of the box; it is
 * `validateCorsOptions` that refuses that same wildcard in production, where the difference
 * between "not configured" and "configured as public" is the whole point.
 */
export function corsOriginFromEnv(raw?: string): CorsOrigin {
  const value = (raw ?? '').trim()
  if (!value || value === '*') return '*'

  const origins = value
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0)

  if (origins.length === 0) return '*'
  if (origins.includes('*')) return '*'
  return origins
}

/** Whether credentials may be granted for this allowlist. Never against a wildcard. */
export function corsCredentialsFor(origin: CorsOrigin): boolean {
  return !isWildcardOrigin(origin)
}

/**
 * The verdict on the **effective** options, whoever wrote them: the framework default here,
 * or a `config/plugins.ts` in the consuming project. Pure, so it is testable without a boot.
 *
 * @param options the options handed to @fastify/cors
 * @param opts.prod production deployment
 * @param opts.configured whether `CORS_ORIGINS` was set (an explicit wildcard is a decision,
 *        an absent variable is an omission)
 */
export function validateCorsOptions(options: any, opts: { prod: boolean; configured: boolean }): CorsCheck {
  const origin = options?.origin
  const credentials = options?.credentials === true
  const wildcard = isWildcardOrigin(origin)

  if (wildcard && credentials) {
    return {
      ok: false,
      fatal: opts.prod,
      reason:
        '`origin: "*"` with `credentials: true` is refused by every browser, so cookie mode cannot work, ' +
        'and in bearer mode it leaves the API callable from any origin'
    }
  }

  if (wildcard && !opts.configured) {
    return {
      ok: false,
      fatal: opts.prod,
      reason: 'CORS_ORIGINS is not set, so every origin is allowed by omission rather than by decision'
    }
  }

  return { ok: true, fatal: false }
}

/**
 * Enforce the verdict. Fatal in production, a warning elsewhere: a developer running against
 * localhost must not be stopped by a variable that only matters once the API is reachable
 * from a browser that is not theirs.
 */
export function assertCorsOptions(options: any, opts: { prod: boolean }): void {
  const configured = (process.env.CORS_ORIGINS ?? '').trim().length > 0
  const { ok, fatal, reason } = validateCorsOptions(options, { prod: opts.prod, configured })
  if (ok) return

  const hint = 'Set CORS_ORIGINS to the comma-separated list of origins allowed to call this API.'

  if (fatal) {
    if (logger.f) logger.fatal(`Startup Security: CORS is unsafe — ${reason}. ${hint}`)
    process.exit(1)
  } else if (logger.w) {
    logger.warn(`Startup Security: CORS is unsafe — ${reason}. Refused in production. ${hint}`)
  }
}
