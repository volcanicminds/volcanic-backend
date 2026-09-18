import type { FastifyReply, FastifyRequest } from 'fastify'
import type { DataHandle, SessionManagement, SessionScope, Session } from '../../types/global.js'
import { httpError } from './httpError.js'
import {
  clearSessionCookies,
  isCookieMode,
  refreshCookieOf,
  setAccessCookie,
  setRefreshCookie,
  type Plane
} from './credential.js'
import {
  composeRefreshCredential,
  newSessionSecret,
  nextIdleExpiry,
  parseRefreshCredential,
  sessionLifetimes,
  sessionRegistryEnabled
} from './session.js'

//
// Renewal against the session registry (T-11.8, T-11.9).
//
// One implementation for both planes, on purpose. The two renewals were written twice and drifted
// twice: the scope check of the control plane had to be added later (D-19's twin), and the tenant
// one grew a 30-day rule the cookie path never had. The parts that genuinely differ between a
// tenant session and a platform one are three — which container holds the row, what the routing
// segment must match, and how the subject is loaded — so they are parameters, and everything else
// is the same code.
//
// What this function refuses, and why it does not explain itself to the caller: an unknown
// secret, an expired session and a revoked one all answer the same 401. They are the same
// actionable fact ("log in again"), and telling them apart tells whoever is holding a stolen
// token which of the three it is.
//

export interface RenewalContext {
  req: FastifyRequest
  reply: FastifyReply
  plane: Plane
  scope: SessionScope
  /** The container the session row lives in. */
  ctx: DataHandle
  manager: SessionManagement
  /** The routing segment the credential must carry, or null to accept any. */
  routing: string | null
  /** The claims of the renewed access token, given the subject that was loaded. */
  claims: (subject: any) => Record<string, unknown>
  /** Loads the subject and says whether it may still renew. */
  loadSubject: (subjectId: string) => Promise<{ subject: any; valid: boolean }>
}

/** The credential presented on this request: the cookie in cookie mode, the body in bearer mode. */
function presented(req: FastifyRequest, plane: Plane): string | undefined {
  if (isCookieMode()) return refreshCookieOf(req, plane)
  const body = req.data() as { refreshToken?: unknown } | undefined
  return typeof body?.refreshToken === 'string' ? body.refreshToken : undefined
}

function secondsUntil(session: Session, idleExpiresAt: Date): number {
  const absolute = new Date(session.absoluteExpiresAt as never).getTime()
  const deadline = Math.min(idleExpiresAt.getTime(), Number.isNaN(absolute) ? Infinity : absolute)
  return Math.max(0, Math.floor((deadline - Date.now()) / 1000))
}

export async function renew(context: RenewalContext) {
  const { req, reply, plane, scope, ctx, manager, routing } = context

  // F28: without a registry there is no renewal. A refresh credential nobody can consume is a
  // credential that never expires, so the honest answer is that the route does not exist here.
  if (!sessionRegistryEnabled(manager)) {
    return reply.status(404).send(httpError(404, 'Refresh tokens are disabled', 'NOT_FOUND'))
  }

  const raw = presented(req, plane)
  if (!raw) {
    return reply.status(401).send(httpError(401, 'No refresh credential on this request', 'REFRESH_REQUIRED'))
  }

  const credential = parseRefreshCredential(raw)
  if (!credential) {
    clearSessionCookies(reply, plane)
    return reply.status(401).send(httpError(401, 'The session has expired', 'REFRESH_REQUIRED'))
  }

  // The renewal is the one route where the credential arrives in the body or in a cookie scoped
  // to this path, so nothing upstream has checked which container it belongs to (defect D-19).
  // The routing segment is addressing, not proof: it says where to look, and the row found there
  // is what decides anything.
  if (routing !== null && credential.routing !== routing) {
    return reply.status(403).send(httpError(403, 'The token does not belong to this tenant', 'TENANT_MISMATCH'))
  }

  const { graceSeconds } = sessionLifetimes()
  const lookup = await manager.findBySecret(ctx, credential.secret, graceSeconds)

  if (lookup.outcome === 'reused') {
    // Two holders of one secret, and the server cannot tell which is the owner. Closing the
    // session is the only honest move: the legitimate user logs in again, the thief gets
    // nothing, and the event is written down where it can be counted.
    await manager.revokeSession(ctx, lookup.session.sid, 'reuse detected')
    clearSessionCookies(reply, plane)
    if (log.w) log.warn(`Session ${lookup.session.sid} closed: a spent refresh credential came back`)
    return reply
      .status(401)
      .send(httpError(401, 'This session was closed because a spent credential was presented', 'SESSION_REUSE_DETECTED'))
  }

  if (lookup.outcome !== 'current' && lookup.outcome !== 'grace') {
    clearSessionCookies(reply, plane)
    return reply.status(401).send(httpError(401, 'The session has expired', 'REFRESH_REQUIRED'))
  }

  const session = lookup.session
  // A session opened on one plane must not be renewable on the other: in a single-tenant
  // deployment both kinds of row live in the same container, and the scope column is what keeps
  // a platform session from being renewed as a tenant one.
  if (session.scope !== scope) {
    clearSessionCookies(reply, plane)
    return reply.status(403).send(httpError(403, 'A tenant token cannot act on the platform', 'SCOPE_MISMATCH'))
  }

  const { subject, valid } = await context.loadSubject(session.subjectId)
  if (!valid) {
    await manager.revokeSession(ctx, session.sid, 'subject is no longer valid')
    clearSessionCookies(reply, plane)
    return reply.status(403).send(httpError(403, 'Wrong refresh token'))
  }

  const secret = newSessionSecret()
  const idleExpiresAt = nextIdleExpiry(session.absoluteExpiresAt)
  const rotated = await manager.rotate(ctx, session.sid, session.generation, { secret, idleExpiresAt })

  const token = await reply.jwtSign({ ...context.claims(subject), sid: session.sid })

  // A lost race is not a failure. Another request of the same session rotated first, so this one
  // hands back a fresh access token and leaves the credential alone: the caller's copy is now the
  // previous generation, which the grace window still accepts. Minting a second live secret here
  // is what would be wrong.
  if (!rotated) {
    if (isCookieMode()) {
      setAccessCookie(reply, plane, token)
      return { token: null, refreshToken: null }
    }
    return { token, refreshToken: null }
  }

  // Housekeeping, on one renewal in fifty (T-11.12). Rows nobody can use any more pile up
  // otherwise, and a deployment that never runs the CLI command would grow the table for ever.
  // Awaited rather than fired and forgotten: the container is released when the response ends,
  // and a query that outlives it would be a query on a handle somebody else already has.
  if (Math.random() < 0.02) {
    try {
      const removed = await manager.purgeExpired(ctx)
      if (removed && log.d) log.debug(`Sessions: ${removed} expired rows purged`)
    } catch (error) {
      // Never at the expense of the renewal: the operator's CLI command is the one that must
      // report a failure, this one is opportunistic.
      if (log.w) log.warn(`Sessions: the opportunistic purge failed (${(error as Error)?.message})`)
    }
  }

  const refreshToken = composeRefreshCredential(credential.routing, session.sid, secret).raw
  if (!isCookieMode()) return { token, refreshToken }

  setAccessCookie(reply, plane, token)
  setRefreshCookie(reply, plane, refreshToken, secondsUntil(session, idleExpiresAt))
  return { token: null, refreshToken: null }
}
