import type { FastifyReply, FastifyRequest } from 'fastify'
import { httpError } from './httpError.js'

//
// Step-up (EVO_FASE_13.md, F50 to F56): a route marked `freshAuth: true` answers only to a
// session whose person proved to be there within the last `STEP_UP_MAX_AGE` seconds.
//
// The moment of that proof is `auth_time` in the access token, in seconds, copied from
// `session.authenticated_at`: the login writes it, a step-up moves it, a renewal copies it and
// never moves it. Reading a signed claim costs this check no query.
//

export const STEP_UP_DEFAULT_MAX_AGE = 300
const MIN_MAX_AGE = 60
const MAX_MAX_AGE = 3600

/** The window, in seconds. A value that is not an integer between 60 and 3600 stops the boot. */
export function stepUpMaxAge(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STEP_UP_MAX_AGE
  if (raw === undefined || raw === '') return STEP_UP_DEFAULT_MAX_AGE
  const value = Number(raw)
  if (!Number.isInteger(value) || value < MIN_MAX_AGE || value > MAX_MAX_AGE) {
    throw new Error(`STEP_UP_MAX_AGE must be an integer between ${MIN_MAX_AGE} and ${MAX_MAX_AGE} seconds, not '${raw}'`)
  }
  return value
}

/** The claim a session token carries: the proof, in whole seconds, as OIDC spells it. */
export const authTimeClaim = (at: Date | string | null | undefined): { auth_time?: number } => {
  if (!at) return {}
  const ms = (at instanceof Date ? at : new Date(at)).getTime()
  return Number.isFinite(ms) ? { auth_time: Math.floor(ms / 1000) } : {}
}

/** What the verified token says about the proof: who can be asked for one, and when it was last given. */
export interface FreshnessClaims {
  sid?: string
  imp?: string
  auth_time?: number
}

/**
 * The gate of a `freshAuth` route, after the roles. `STEP_UP_REQUIRED` when a step-up can fix it,
 * `STEP_UP_NOT_AVAILABLE` when none can (F55): an impersonation or an integration token is never
 * fresh, and a stale token with no session behind it (a build without the registry) has nothing
 * a step-up could confirm, only a new login.
 */
export function finishFreshness(req: FastifyRequest, reply: FastifyReply, claims: FreshnessClaims | null) {
  // Nobody authenticated: the route's own authentication answers 401 after this hook, and a 403
  // here would tell an anonymous caller to confirm an identity it never presented.
  if (!req.user && !req.systemUser && !req.token) return
  const notAvailable = () =>
    reply.status(403).send(httpError(403, 'This credential cannot confirm its holder: log in again', 'STEP_UP_NOT_AVAILABLE'))
  if (!claims || claims.imp || req.token) return notAvailable()

  const maxAge = stepUpMaxAge()
  const authTime = claims.auth_time
  if (typeof authTime === 'number' && Date.now() - authTime * 1000 <= maxAge * 1000) return
  if (!claims.sid) return notAvailable()
  if (log.i) log.info(`Step-up required for ${req.method} ${req.url}`)
  return reply.status(403).send({ ...httpError(403, 'Confirm your identity to continue', 'STEP_UP_REQUIRED'), maxAge })
}
