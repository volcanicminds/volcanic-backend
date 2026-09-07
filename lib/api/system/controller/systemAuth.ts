import { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, SystemUserManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'
import * as regExp from '../../../util/regexp.js'

//
// Authentication of the control scope (T-4.1, docs/API_V5.md §5).
//
// The token minted here carries `scp: 'control'` and **no** `tid`. That is not a label: the
// tenant resolution of T-3.2 refuses a token with `scp: 'control'` inside a container, and
// the authentication hook refuses a token without it on a platform route. A system user
// therefore has no silent way into a customer's data; the only way in is impersonation,
// which leaves a record (T-4.2).
//
const MAX_PASSWORD_LENGTH = 128

const manager = (req: FastifyRequest): SystemUserManagement => req.server['systemUserManager']
const control = (req: FastifyRequest): ControlHandle => req.control as ControlHandle

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (manager(req)?.isImplemented?.() && req.control) return false
  reply.status(503).send(httpError(503, 'Platform identities are not available in this build', 'SYSTEM_USERS_NOT_AVAILABLE'))
  return true
}

/** The public shape of a system user: the credential columns never leave the process. */
export function present(user: any) {
  if (!user) return null
  const { password, mfaSecret, mfaRecoveryCodes, ...rest } = user
  void password
  void mfaSecret
  void mfaRecoveryCodes
  return rest
}

export async function login(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { email, password } = req.data()

  if (!email || !regExp.email.test(String(email))) {
    return reply.status(400).send(httpError(400, 'Email not valid'))
  }
  if (!password || String(password).length > MAX_PASSWORD_LENGTH) {
    return reply.status(400).send(httpError(400, 'Password not valid'))
  }

  const user = await manager(req).retrieveSystemUserByPassword(control(req), String(email), String(password))

  // One message for every cause, as in the tenant scope (docs/API_V5.md §2.1). On the
  // platform's own door the reason matters even less: the set of valid addresses is small
  // and enumerating it is half the work of attacking it.
  if (!user || user.blocked) {
    if (log.w) log.warn(`System login refused for ${String(email)}`)
    return reply.status(403).send(httpError(403, 'Wrong credentials'))
  }

  // Fail-closed. The columns for a second factor exist and the flow that verifies one does
  // not, so a system user with MFA enabled is refused rather than let through on the first
  // factor alone. Skipping a declared factor silently is the shape of defect this rewrite
  // exists to remove; the flow arrives with T-6.3, which is what actually needs it.
  if (user.mfaEnabled) {
    if (log.e) log.error(`System login: ${user.email} has MFA enabled, and the control MFA flow is not implemented yet`)
    return reply.status(503).send(httpError(503, 'Multi-factor authentication is not available for platform identities yet', 'MFA_NOT_AVAILABLE'))
  }

  const token = await reply.jwtSign({ sub: user.externalId, scp: 'control' })
  const refreshToken = reply.server.jwt['refreshToken']
    ? await reply.server.jwt['refreshToken'].sign({ sub: user.externalId, scp: 'control' })
    : undefined

  if ((process.env.AUTH_MODE || 'BEARER') === 'COOKIE') {
    reply.setCookie('auth_token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      signed: true,
      maxAge: 86400
    })
    return { ...present(user), token: null, refreshToken }
  }

  return { ...present(user), token, refreshToken }
}

export async function logout(_req: FastifyRequest, reply: FastifyReply) {
  if ((process.env.AUTH_MODE || 'BEARER') === 'COOKIE') {
    reply.clearCookie('auth_token', { path: '/' })
  }
  return { ok: true }
}

export async function renew(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { token, refreshToken } = req.data()

  if (!reply.server.jwt['refreshToken']) {
    return reply.status(404).send(httpError(404, 'Refresh tokens are disabled', 'NOT_FOUND'))
  }
  if (!token || !refreshToken) {
    return reply.status(400).send(httpError(400, 'Missing token or refreshToken'))
  }

  let tokenData: { sub: string; iat?: number; scp?: string }
  try {
    tokenData = (await reply.server.jwt.verify(token, { ignoreExpiration: true })) as never
  } catch {
    return reply.status(403).send(httpError(403, 'Invalid token'))
  }

  // The renewal verifies the SCOPE, for the same reason the tenant renewal verifies the
  // tenant (defect D-19): renewal is the one route where the token arrives in the body, so
  // nothing upstream has checked it. Without this it would be the single door through which
  // a tenant token is exchanged for a platform one.
  const refreshData = (await reply.server.jwt['refreshToken'].verify(refreshToken)) as { sub?: string; scp?: string }
  if (tokenData.scp !== 'control' || refreshData?.scp !== 'control') {
    return reply.status(403).send(httpError(403, 'A tenant token cannot act on the platform', 'SCOPE_MISMATCH'))
  }
  if (tokenData.sub && tokenData.sub !== refreshData?.sub) {
    return reply.status(403).send(httpError(403, 'Mismatched tokens'))
  }

  const minAcceptable = Math.floor(Date.now() / 1000) - 2592000 // 30 days
  if (!tokenData?.iat || tokenData.iat < minAcceptable) {
    return reply.status(403).send(httpError(403, 'Token too old'))
  }

  const user = await manager(req).retrieveSystemUserByExternalId(control(req), tokenData.sub)
  if (!user || user.blocked) {
    return reply.status(403).send(httpError(403, 'Wrong refresh token'))
  }

  return { token: await reply.jwtSign({ sub: user.externalId, scp: 'control' }) }
}
