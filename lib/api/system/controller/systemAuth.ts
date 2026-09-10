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

  // The second factor, when this operator has one (T-6.3). The first factor alone buys a
  // five-minute pre-auth token and nothing else: it names the subject and opens no route.
  if (user.mfaEnabled) {
    const tempToken = await reply.jwtSign({ sub: user.externalId, scp: 'control', role: 'pre-auth-mfa' }, { expiresIn: '5m' })
    return reply.status(202).send({ mfaRequired: true, tempToken })
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

  const appName = process.env.MFA_APP_NAME || 'VolcanicApp'
  return await req.server['mfaManager'].generateSetup(appName, actor.email)
}

export async function mfaEnable(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const actor = req.systemUser
  const { secret, token } = req.data()
  if (!actor) return reply.status(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED'))
  if (!secret || !token) return reply.status(400).send(httpError(400, 'secret and token are both required'))

  // Confirmed before it is trusted: enabling MFA on a secret the operator never proved they
  // hold would lock them out of the account and out of the destruction path with it.
  const counter = await req.server['mfaManager'].verify(String(token), String(secret))
  if (counter == null) return reply.status(400).send(httpError(400, 'The code is not valid'))

  await manager(req).saveMfaSecret(control(req), actor.id, String(secret))
  await manager(req).enableMfa(control(req), actor.id)
  await manager(req).recordMfaCounter(control(req), actor.id, Number(counter))

  if (log.i) log.info(`System MFA enabled for ${actor.email}`)
  return { ok: true }
}

export async function mfaVerify(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { tempToken, token } = req.data()
  if (!tempToken || !token) return reply.status(400).send(httpError(400, 'tempToken and token are both required'))

  let claims: any
  try {
    claims = req.server.jwt.verify(String(tempToken))
  } catch {
    return reply.status(401).send(httpError(401, 'Invalid or expired token', 'UNAUTHORIZED'))
  }
  // Only a pre-auth token buys a session here, and only a control one: this route must not
  // become a way to upgrade any token that happens to verify.
  if (claims?.role !== 'pre-auth-mfa' || claims?.scp !== 'control') {
    return reply.status(403).send(httpError(403, 'Invalid token scope', 'SCOPE_MISMATCH'))
  }

  const user = await manager(req).retrieveSystemUserByExternalId(control(req), claims.sub)
  if (!user || user.blocked) return reply.status(403).send(httpError(403, 'Wrong credentials'))

  const secret = await manager(req).retrieveMfaSecret(control(req), user.id)
  if (!secret) return reply.status(403).send(httpError(403, 'Wrong credentials'))

  const counter = await req.server['mfaManager'].verify(String(token), secret)
  if (counter == null) return reply.status(403).send(httpError(403, 'The code is not valid'))
  if (user.mfaLastUsedCounter != null && Number(counter) <= Number(user.mfaLastUsedCounter)) {
    // A replayed step is a stolen code being used a second time.
    return reply.status(403).send(httpError(403, 'That code has already been used'))
  }
  await manager(req).recordMfaCounter(control(req), user.id, Number(counter))

  return { ...present(user), token: await reply.jwtSign({ sub: user.externalId, scp: 'control' }) }
}
