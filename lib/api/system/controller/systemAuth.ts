import { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, SystemUserManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'
import { allowsEnrolment, controlPolicy, mfaAvailable } from '../../../util/mfaPolicy.js'
import { clearSessionCookies, sessionTokenOf } from '../../../util/credential.js'
import { renew as renewSession } from '../../../util/renewal.js'
import { CONTROL_ROUTING, sessionRegistryEnabled } from '../../../util/session.js'
import { absoluteStep } from '../../../util/mfaCounter.js'
import { recordControlAccess } from '../../../util/accessLog.js'

//
// The account side of the control scope (T-4.1, docs/API_V5.md §5): sessions, renewal and the
// second factor of an operator already logged in. The login itself is `/system/auth/flow/*`.
//
// A platform token carries `scp: 'control'` and **no** `tid`. That is not a label: the tenant
// resolution of T-3.2 refuses a token with `scp: 'control'` inside a container, and the
// authentication hook refuses a token without it on a platform route. A system user therefore
// has no silent way into a customer's data; the only way in is impersonation, which leaves a
// record (T-4.2).
//
const manager = (req: FastifyRequest): SystemUserManagement => req.server['systemUserManager']
const control = (req: FastifyRequest): ControlHandle => req.control as ControlHandle

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (manager(req)?.isImplemented?.() && req.control) return false
  reply.status(503).send(httpError(503, 'Platform identities are not available in this build', 'SYSTEM_USERS_NOT_AVAILABLE'))
  return true
}

/** The public shape of a system user: the credential columns never leave the process. */
export function present<T extends { password?: unknown; mfaSecret?: unknown; mfaRecoveryCodes?: unknown }>(
  user: T | null | undefined
): Omit<T, 'password' | 'mfaSecret' | 'mfaRecoveryCodes'> | null {
  if (!user) return null
  const { password, mfaSecret, mfaRecoveryCodes, ...rest } = user
  void password
  void mfaSecret
  void mfaRecoveryCodes
  return rest
}

/** The platform session this request's token belongs to, when it carries one. */
function currentSid(req: FastifyRequest): string | undefined {
  const raw = sessionTokenOf(req, 'control')
  if (!raw) return undefined
  const claims = req.server.jwt.decode(raw) as { sid?: string } | null
  return typeof claims?.sid === 'string' ? claims.sid : undefined
}

/** The operator's own platform sessions (T-11.14), the twin of the tenant listing. */
export async function listSessions(req: FastifyRequest, reply: FastifyReply) {
  const sessions = req.server['sessionManager']
  if (!sessionRegistryEnabled(sessions) || !req.control) {
    return reply.status(404).send(httpError(404, 'This build keeps no session registry', 'NOT_FOUND'))
  }
  const actor = req.systemUser
  if (!actor?.externalId) return reply.status(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED'))

  const sid = currentSid(req)
  const rows = await sessions.listOfSubject(control(req), actor.externalId)
  return rows.map((row) => ({
    sid: row.sid,
    current: row.sid === sid,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null
  }))
}

/** Closes one platform session of the caller. Somebody else's answers 404, as on the tenant side. */
export async function revokeSession(req: FastifyRequest, reply: FastifyReply) {
  const sessions = req.server['sessionManager']
  if (!sessionRegistryEnabled(sessions) || !req.control) {
    return reply.status(404).send(httpError(404, 'This build keeps no session registry', 'NOT_FOUND'))
  }
  const actor = req.systemUser
  if (!actor?.externalId) return reply.status(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED'))

  const { id: sid } = req.params as { id?: string }
  const mine = await sessions.listOfSubject(control(req), actor.externalId)
  if (!sid || !mine.some((row) => row.sid === sid)) {
    return reply.status(404).send(httpError(404, 'Not found', 'NOT_FOUND'))
  }

  await sessions.revokeSession(control(req), sid, 'closed by the operator')
  await recordControlAccess(req, { event: 'session.revoked', outcome: 'success', subjectId: actor.externalId, sid })
  if (sid === currentSid(req)) clearSessionCookies(reply, 'control')
  return { ok: true }
}

/** Ends the platform session, and not only the browser's memory of it (T-11.10). */
export async function logout(req: FastifyRequest, reply: FastifyReply) {
  const sessions = req.server['sessionManager']
  const sid = currentSid(req)
  if (sid && req.control && sessionRegistryEnabled(sessions)) {
    await sessions.revokeSession(control(req), sid, 'logout')
  }
  // As on the tenant plane: only a logout that names a session gets a row.
  if (sid) await recordControlAccess(req, { event: 'logout', outcome: 'success', subjectId: req.systemUser?.externalId ?? null, sid })
  clearSessionCookies(reply, 'control')
  return { ok: true }
}

/**
 * The platform identity behind the session, with its roles (T-10.14).
 *
 * A console asks this to decide what to draw. `/users/me` is a tenant route: a control token
 * there is refused, so without this a platform console could log in and never learn who it is.
 */
export async function me(req: FastifyRequest, reply: FastifyReply) {
  const actor = req.systemUser
  if (!actor) return reply.status(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED'))
  // The policy that is actually enforced here, so a console never offers what the server refuses.
  return { ...present(actor), roles: req.roles(), securityPolicy: { mfaPolicy: controlPolicy() } }
}

/**
 * Renewal of a platform session (T-11.8), the twin of the tenant one and now literally the same
 * code (lib/util/renewal.ts).
 *
 * The scope check that had to be written here by hand, and then again on the cookie path, is a
 * column of the row: a session opened on the control plane carries `scope: 'control'`, so a
 * tenant session cannot be renewed into a platform one even in a single-tenant deployment where
 * both kinds of row sit in the same container.
 */
export async function renew(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  return renewSession({
    req,
    reply,
    plane: 'control',
    scope: 'control',
    ctx: control(req),
    manager: req.server['sessionManager'],
    routing: CONTROL_ROUTING,
    claims: (user) => ({ sub: user.externalId, scp: 'control' }),
    loadSubject: async (subjectId: string) => {
      const user = await manager(req).retrieveSystemUserByExternalId(control(req), subjectId)
      return { subject: user, valid: Boolean(user) && !user?.blocked }
    }
  })
}

//
// MFA for platform identities (T-6.3, deferred here by T-4.1).
//
// It exists because destroying a customer's data asks for a second factor, and a factor that
// does not exist cannot be asked for. The shape is the tenant one: a secret shown once at
// setup, confirmed with a code before it is trusted, and a step counter that makes a code
// good exactly once.
//
export async function mfaSetup(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const actor = req.systemUser
  if (!actor) return reply.status(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED'))
  // Same reason as the tenant plane: enrolling over an existing factor would let the session
  // alone replace the second factor it was supposed to stand behind.
  if (actor.mfaEnabled) return reply.status(409).send(httpError(409, 'A second factor is already enabled', 'MFA_ALREADY_ENABLED'))
  if (!allowsEnrolment(controlPolicy())) {
    return reply.status(403).send(httpError(403, 'The platform policy accepts no new second factors', 'MFA_DISABLED'))
  }
  if (!mfaAvailable(req.server['mfaManager'])) {
    // Said as itself, not as the 500 the Null Object would raise from three layers down.
    return reply.status(503).send(httpError(503, 'This build has no MFA manager', 'MFA_NOT_AVAILABLE'))
  }

  const appName = process.env.MFA_APP_NAME || 'VolcanicApp'
  return await req.server['mfaManager'].generateSetup(appName, actor.email)
}

export async function mfaEnable(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const actor = req.systemUser
  const { secret, token } = req.data()
  if (!actor) return reply.status(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED'))
  // Same reason as the tenant plane: enrolling over an existing factor would let the session
  // alone replace the second factor it was supposed to stand behind.
  if (actor.mfaEnabled) return reply.status(409).send(httpError(409, 'A second factor is already enabled', 'MFA_ALREADY_ENABLED'))
  if (!allowsEnrolment(controlPolicy())) {
    return reply.status(403).send(httpError(403, 'The platform policy accepts no new second factors', 'MFA_DISABLED'))
  }
  if (!mfaAvailable(req.server['mfaManager'])) {
    return reply.status(503).send(httpError(503, 'This build has no MFA manager', 'MFA_NOT_AVAILABLE'))
  }
  if (!secret || !token) return reply.status(400).send(httpError(400, 'secret and token are both required'))

  // Confirmed before it is trusted: enabling MFA on a secret the operator never proved they
  // hold would lock them out of the account and out of the destruction path with it.
  // What the verifier answers is a DELTA, not a position in time. Writing it down as if it were
  // is what locked an operator out after the first enrolment (T-10.20): the delta of a code typed
  // in its own window is zero, and every later code, also zero, then read as already spent.
  const { valid, counter } = absoluteStep(await req.server['mfaManager'].verify(String(token), String(secret)))
  if (!valid) return reply.status(400).send(httpError(400, 'The code is not valid'))

  await manager(req).saveMfaSecret(control(req), actor.id, String(secret))
  await manager(req).enableMfa(control(req), actor.id)
  if (counter !== null) await manager(req).recordMfaCounter(control(req), actor.id, counter)
  await recordControlAccess(req, { event: 'mfa.enrolled', outcome: 'success', subjectId: actor.externalId ?? null, methods: ['totp'] })

  if (log.i) log.info(`System MFA enabled for ${actor.email}`)
  return { ok: true }
}
