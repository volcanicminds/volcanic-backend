'use strict'

/**
 * Startup hardening for cryptographic secrets (JWT, refresh, cookie).
 *
 * Rationale: @fastify/jwt already refuses to register with a falsy secret
 * (`assert(options.secret, 'missing secret')`), but it happily accepts a WEAK
 * one (short, default or low-entropy), which makes signed tokens forgeable.
 * For B2B/enterprise usage we fail fast with an actionable message instead.
 *
 * Policy:
 *  - missing/empty     -> always fatal (process.exit(1))
 *  - weak (short/known/low-entropy):
 *      - production     -> fatal (process.exit(1))
 *      - non-production -> warning (tolerated, must be fixed before deploy)
 */

import logger from './logger.js'

export const MIN_SECRET_LENGTH = 32
const MIN_DISTINCT_CHARS = 8

// Well-known / placeholder values that must never reach production.
const COMMON_WEAK_SECRETS = new Set([
  'secret',
  'secretkey',
  'secret-key',
  'jwtsecret',
  'jwt_secret',
  'jwt-secret',
  'your-secret',
  'your-secret-key',
  'your_jwt_secret',
  'changeme',
  'change-me',
  'please-change-me',
  'password',
  'passw0rd',
  'admin',
  'default',
  'test',
  'testing',
  'example',
  'mysecret',
  'supersecret',
  'topsecret',
  'token',
  'volcanic',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'letmein'
])

export type SecretCheck = { ok: boolean; missing: boolean; reason?: string }

/**
 * Pure validator: returns the verdict without side effects (testable).
 */
export function validateSecretStrength(value: string | undefined): SecretCheck {
  if (!value || value.trim().length === 0) {
    return { ok: false, missing: true, reason: 'missing or empty' }
  }

  const v = value.trim()

  if (v.length < MIN_SECRET_LENGTH) {
    return { ok: false, missing: false, reason: `too short (${v.length} chars, minimum ${MIN_SECRET_LENGTH})` }
  }

  if (COMMON_WEAK_SECRETS.has(v.toLowerCase())) {
    return { ok: false, missing: false, reason: 'matches a well-known/default value' }
  }

  const distinct = new Set(v).size
  if (distinct < MIN_DISTINCT_CHARS) {
    return { ok: false, missing: false, reason: `low entropy (only ${distinct} distinct characters)` }
  }

  return { ok: true, missing: false }
}

/**
 * Enforce the policy. Exits the process on a fatal condition.
 *
 * @param name human-readable env var name (for the message)
 * @param value the secret value
 * @param opts.prod whether we are running in production
 */
export function assertSecretStrength(name: string, value: string | undefined, opts: { prod: boolean }): void {
  const { ok, missing, reason } = validateSecretStrength(value)
  if (ok) return

  const hint = `Set a strong random value (>= ${MIN_SECRET_LENGTH} chars), e.g. \`openssl rand -base64 48\`.`

  // Missing is always fatal; weak is fatal only in production.
  if (missing || opts.prod) {
    if (logger.f) logger.fatal(`Startup Security: ${name} is ${reason}. ${hint}`)
    process.exit(1)
  } else {
    if (logger.w)
      logger.warn(
        `Startup Security: ${name} is ${reason}. Tolerated in non-production but MUST be fixed before deploying. ${hint}`
      )
  }
}
