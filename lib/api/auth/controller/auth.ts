/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyReply, FastifyRequest } from 'fastify'
import * as regExp from '../../../util/regexp.js'
import { MfaPolicy } from '../../../config/constants.js'
import { httpError } from '../../../util/httpError.js'

// Upper bound for the password accepted at login: a cheap guard against oversized
// payloads. Complexity is enforced only when a password is set, not at login.
const MAX_PASSWORD_LENGTH = 256

// TOTP period in seconds — must match the period used by the MFA manager (tools default: 30).
const TOTP_PERIOD_SECONDS = 30

/**
 * Normalizes the MFA manager `verify` result and turns the relative time-step delta into the
 * absolute step consumed, so it can be persisted for anti-replay.
 *
 * - New managers return `number | null` (delta or invalid).
 * - Legacy managers returning a boolean are tolerated: valid/invalid without a usable counter.
 *
 * @returns `{ valid, counter }` — `counter` is the absolute TOTP step, or `null` when unknown.
 */
function evaluateMfaResult(result: number | boolean | null): { valid: boolean; counter: number | null } {
  if (result === null || result === false) return { valid: false, counter: null }
  if (typeof result === 'number') {
    const currentStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS)
    return { valid: true, counter: currentStep + result }
  }
  // Legacy boolean `true`: valid, but no delta to track replays with.
  return { valid: true, counter: null }
}

export async function register(req: FastifyRequest, reply: FastifyReply) {
  const { password1: password, password2, ...data } = req.data()

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!data.username) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Username not valid' })
  }
  if (!regExp.isEmail(data.email)) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Email not valid' })
  }
  if (!password || !regExp.password.test(password)) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Password not valid' })
  }
  if (!password2 || password2 !== password) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Repeated password not match' })
  }

  let existings = await req.server['userManager'].retrieveUserByEmail(data.email, req.runner)
  if (existings) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Email already registered' })
  }

  if ((data.requiredRoles || []).includes('admin')) {
    existings = await req.server['userManager'].findQuery({ 'roles:in': 'admin' }, req.runner)
    if (existings?.records?.length) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'User admin already registered' })
    }
  }

  // public is the default
  const publicRole = global.roles?.public?.code || 'public'
  data.roles = (data.requiredRoles || []).map((r) => global.roles[r]?.code).filter((r) => !!r)
  if (!data.roles.includes(publicRole)) {
    data.roles.push(publicRole)
  }

  const user = await req.server['userManager'].createUser({ ...data, password: password }, req.runner)
  if (!user) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'User not registered' })
  }

  return user
}

export async function unregister(req: FastifyRequest, reply: FastifyReply) {
  const { email, password } = req.data()

  let user = await req.server['userManager'].retrieveUserByPassword(email, password, req.runner)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong credentials' })
  }

  if (user.blocked) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User blocked' })
  }

  user = await req.server['userManager'].disableUserById(user.getId(), req.runner)
  isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'User not valid' })
  }

  return { ok: true }
}

export async function validatePassword(req: FastifyRequest, reply: FastifyReply) {
  const { password } = req.data()

  if (!password) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Password cannot be null' })
  }

  const match = regExp.password.test(password)
  if (!match) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Password is not valid' })
  }

  return { ok: match }
}

export async function changePassword(req: FastifyRequest, reply: FastifyReply) {
  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  const _user = req.user
  if (!_user) {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' })
  }

  const { email, oldPassword, newPassword1, newPassword2 } = req.data()

  if (_user.email !== email) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Email not valid' })
  }

  if (!newPassword1 || !regExp.password.test(newPassword1)) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'New password is not valid' })
  }

  if (!newPassword2 || newPassword2 !== newPassword1) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Repeated new password not match' })
  }

  let user = await req.server['userManager'].retrieveUserByPassword(email, oldPassword, req.runner)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong credentials' })
  }

  if (user.blocked) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User blocked' })
  }

  user = await req.server['userManager'].changePassword(email, newPassword1, oldPassword, req.runner)
  isValid = await req.server['userManager'].isValidUser(user)
  return { ok: isValid }
}

export async function forgotPassword(req: FastifyRequest, reply: FastifyReply) {
  const { username, email } = req.data()

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!username && !regExp.isEmail(email)) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing a valid user identifier' })
  }

  let user = null as any
  if (email) {
    user = await req.server['userManager'].retrieveUserByEmail(email, req.runner)
  } else if (username) {
    user = await req.server['userManager'].retrieveUserByUsername(username, req.runner)
  }

  const isValid = await req.server['userManager'].isValidUser(user)

  // Account-enumeration hardening: do NOT reveal whether the account exists, is
  // invalid or is blocked. Always answer 200 with a generic body; only actually
  // trigger the reset flow when the user exists, is valid and not blocked.
  // (A residual timing side-channel remains since the valid path does a DB write.)
  if (isValid && !user?.blocked) {
    await req.server['userManager'].forgotPassword(user.email, req.runner)
  }

  return { ok: true }
}

export async function confirmEmail(req: FastifyRequest, reply: FastifyReply) {
  const { code } = req.data()

  if (!code) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing the confirm email token' })
  }

  let user = await req.server['userManager'].retrieveUserByConfirmationToken(code, req.runner)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong credentials' })
  }

  if (user.blocked) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User blocked' })
  }

  user = await req.server['userManager'].userConfirmation(user, req.runner)
  isValid = await req.server['userManager'].isValidUser(user)

  return { ok: isValid }
}

export async function resetPassword(req: FastifyRequest, reply: FastifyReply) {
  const { code, newPassword1, newPassword2 } = req.data()

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!newPassword1 || !regExp.password.test(newPassword1)) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'New password not valid' })
  }

  if (!newPassword2 || newPassword2 !== newPassword1) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Repeated new password not match' })
  }

  let user = await req.server['userManager'].retrieveUserByResetPasswordToken(code, req.runner)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong credentials' })
  }

  if (user.blocked) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User blocked' })
  }

  user = await req.server['userManager'].resetPassword(user, newPassword1, req.runner)
  isValid = await req.server['userManager'].isValidUser(user)
  return { ok: isValid, user }
}

export async function login(req: FastifyRequest, reply: FastifyReply) {
  const { email, password } = req.data()
  const { mfa_policy = MfaPolicy.OPTIONAL } = global.config.options || {}

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!regExp.isEmail(email)) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Email not valid' })
  }
  // At login we do NOT re-validate the password complexity policy: the password
  // was already validated when it was set (register/change/reset), and bcrypt is
  // the actual security gate. Re-checking the policy here adds no security and
  // would lock out existing users whenever the policy changes. We only bound the
  // input length as a cheap guard against oversized payloads.
  if (!password || password.length > MAX_PASSWORD_LENGTH) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Password not valid' })
  }

  let user = await req.server['userManager'].retrieveUserByPassword(email, password, req.runner)
  if (!user) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong credentials' })
  }

  const isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Invalid user' })
  }

  if (!(user.confirmed === true)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User email unconfirmed' })
  }

  const isPasswordToBeChanged = req.server['userManager'].isPasswordToBeChanged(user)
  if (isPasswordToBeChanged) {
    return reply.status(403).send(httpError(403, 'Password is expired', 'PASSWORD_TO_BE_CHANGED'))
  }

  if (user.blocked) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User blocked' })
  }

  // MFA Logic Interception
  const isMfaEnabled = user.mfaEnabled
  const isMandatory = mfa_policy === MfaPolicy.MANDATORY

  if (isMfaEnabled || isMandatory) {
    const tempToken = await reply.jwtSign(
      { sub: user.externalId, role: 'pre-auth-mfa', tid: req.tenant?.id },
      { expiresIn: '5m' }
    )
    // Use 202 Accepted to bypass 200 OK strict schema filtering
    return reply.status(202).send({
      mfaRequired: isMfaEnabled, // If enabled, verify. If not enabled but mandatory, setup.
      mfaSetupRequired: isMandatory && !isMfaEnabled,
      tempToken: tempToken
    })
  }

  if (config.options.reset_external_id_on_login) {
    user = await req.server['userManager'].resetExternalId(user.getId(), req.runner)
  }

  // https://www.iana.org/assignments/jwt/jwt.xhtml
  const token = await reply.jwtSign({ sub: user.externalId, tid: req.tenant?.id })
  const refreshToken = reply.server.jwt['refreshToken']
    ? await reply.server.jwt['refreshToken'].sign({ sub: user.externalId, tid: req.tenant?.id })
    : undefined

  const AUTH_MODE = process.env.AUTH_MODE || 'BEARER'

  if (AUTH_MODE === 'COOKIE') {
    reply.setCookie('auth_token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      signed: true,
      maxAge: 86400
    })

    return {
      ...user,
      roles: (user.roles || [global.role?.public?.code || 'public']).map((r) => r?.code || r),
      token: null, // Token hidden in cookie
      refreshToken: null,
      securityPolicy: {
        mfaPolicy: mfa_policy
      }
    }
  }

  // Standard 200 OK (BEARER MODE)
  return {
    ...user,
    roles: (user.roles || [global.role?.public?.code || 'public']).map((r) => r?.code || r),
    token: token,
    refreshToken,
    securityPolicy: {
      mfaPolicy: mfa_policy
    }
  }
}

export async function logout(_req: FastifyRequest, reply: FastifyReply) {
  if (process.env.AUTH_MODE === 'COOKIE') {
    reply.clearCookie('auth_token', { path: '/' })
  }
  return { ok: true }
}

export async function refreshToken(req: FastifyRequest, reply: FastifyReply) {
  const { token, refreshToken } = req.data()

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  // Refresh tokens are optional (JWT_REFRESH). When disabled there is no refresh
  // verifier registered — answer a clean 404 instead of throwing a 500 later.
  if (!reply.server.jwt['refreshToken']) {
    return reply.status(404).send(httpError(404, 'Refresh tokens are disabled', 'NOT_FOUND'))
  }

  if (!token || !refreshToken) {
    return reply
      .status(400)
      .send({ statusCode: 400, error: 'Bad Request', message: 'Missing token or refreshToken' })
  }

  // Verify the signature of the (possibly expired) access token: `ignoreExpiration`
  // lets a stale token through — which is the whole point of refresh — but a forged
  // or tampered token is now rejected (previously `decode` skipped signature checks).
  let tokenData: { sub: number; iat?: number }
  try {
    tokenData = (await reply.server.jwt.verify(token, { ignoreExpiration: true })) as { sub: number; iat?: number }
  } catch {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Invalid token' })
  }

  // Reject refresh of access tokens issued too long ago. Use the real temporal
  // claim (`iat`), not `sub` (the externalId): the old check compared a user id
  // against a unix timestamp and was effectively dead code.
  const minAccettable = Math.floor(Date.now() / 1000) - 2592000 // 30 days
  if (!tokenData?.iat || tokenData.iat < minAccettable) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Token too old' })
  }

  const refreshTokenData = await reply.server.jwt['refreshToken'].verify(refreshToken)
  if (tokenData?.sub && tokenData?.sub !== refreshTokenData?.sub) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Mismatched tokens' })
  }

  const user = await req.server['userManager'].retrieveUserByExternalId(tokenData.sub, req.runner)
  const isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong refresh token' })
  }

  const newToken = await reply.jwtSign({ sub: user.externalId, tid: req.tenant?.id })
  return {
    token: newToken
  }
}

export async function invalidateTokens(req: FastifyRequest, reply: FastifyReply) {
  let isValid = await req.server['userManager'].isValidUser(req.user)
  if (!req.user || !isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User not linked' })
  }

  const user = await req.server['userManager'].resetExternalId(req.user.getId(), req.runner)
  isValid = await req.server['userManager'].isValidUser(user)
  return { ok: isValid }
}

export async function mfaSetup(req: FastifyRequest, reply: FastifyReply) {
  const user = req.user
  if (!user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' })

  try {
    // Use mfaManager (injected) for logic
    const appName = process.env.MFA_APP_NAME || 'VolcanicApp'
    const setupData = await req.server['mfaManager'].generateSetup(appName, user.email)
    return setupData
  } catch (error: any) {
    req.log.error({ err: error }, 'MFA Setup failed')
    return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to generate MFA setup' })
  }
}

export async function mfaEnable(req: FastifyRequest, reply: FastifyReply) {
  const user = req.user
  const { secret, token } = req.data()
  const { mfa_policy = MfaPolicy.OPTIONAL } = global.config.options || {}

  if (!user || !secret || !token) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing parameters' })

  try {
    // 1. Verify using mfaManager (tools)
    const { valid, counter } = evaluateMfaResult(req.server['mfaManager'].verify(token, secret))
    if (!valid) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid token' })
    }

    // 2. Save using userManager (typeorm)
    await req.server['userManager'].saveMfaSecret(user.getId(), secret, req.runner)
    await req.server['userManager'].enableMfa(user.getId(), req.runner)

    // Record the consumed time-step so the same code cannot be replayed on the first /mfa/verify.
    if (counter !== null) {
      await req.server['userManager'].updateUserById(user.getId(), { mfaLastUsedCounter: counter }, req.runner)
    }

    // IMPORTANT: Return full tokens upon enablement if user was in pending state
    // BUT usually user is already logged in via temp token or full token.
    // If user is setting up from "Forced Setup", they need tokens now.

    const finalToken = await reply.jwtSign({ sub: user.externalId, tid: req.tenant?.id })
    const refreshToken = reply.server.jwt['refreshToken']
      ? await reply.server.jwt['refreshToken'].sign({ sub: user.externalId, tid: req.tenant?.id })
      : undefined

    return {
      ...user,
      mfaEnabled: true,
      roles: (user.roles || [global.role?.public?.code || 'public']).map((r) => r?.code || r),
      token: finalToken,
      refreshToken: refreshToken,
      securityPolicy: {
        mfaPolicy: mfa_policy
      }
    }
  } catch (error: any) {
    req.log.error({ err: error }, 'MFA Enable failed')
    return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to enable MFA' })
  }
}

export async function mfaVerify(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization
  const { mfa_policy = MfaPolicy.OPTIONAL } = global.config.options || {}

  if (!authHeader) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Missing authorization' })

  const tokenStr = authHeader.split(' ')[1]
  let decoded: any
  try {
    decoded = req.server.jwt.verify(tokenStr)
  } catch (_e) {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid token' })
  }

  if (decoded.role !== 'pre-auth-mfa' && (!req.user || !req.user.getId())) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Invalid token scope' })
  }

  const subjectId = decoded.sub
  const { token } = req.data()
  if (!token) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing token' })

  // 1. Retrieve secret via userManager
  const user = await req.server['userManager'].retrieveUserByExternalId(subjectId, req.runner)
  if (!user) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })

  const secret = await req.server['userManager'].retrieveMfaSecret(user.getId(), req.runner)
  if (!secret) return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'MFA not configured for user' })

  // 2. Verify via mfaManager
  const { valid, counter } = evaluateMfaResult(req.server['mfaManager'].verify(token, secret))
  if (!valid) return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Invalid MFA token' })

  // 3. Anti-replay: reject a code whose time-step was already consumed (same or earlier than the last).
  const lastCounter = user.mfaLastUsedCounter
  if (counter !== null && lastCounter != null && counter <= lastCounter) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'MFA token already used' })
  }
  if (counter !== null) {
    await req.server['userManager'].updateUserById(user.getId(), { mfaLastUsedCounter: counter }, req.runner)
  }

  if (config.options.reset_external_id_on_login) {
    await req.server['userManager'].resetExternalId(user.getId(), req.runner)
  }

  const finalToken = await reply.jwtSign({ sub: user.externalId, tid: req.tenant?.id })
  const refreshToken = reply.server.jwt['refreshToken']
    ? await reply.server.jwt['refreshToken'].sign({ sub: user.externalId, tid: req.tenant?.id })
    : undefined

  return {
    ...user,
    roles: (user.roles || [global.role?.public?.code || 'public']).map((r) => r?.code || r),
    token: finalToken,
    refreshToken: refreshToken,
    securityPolicy: {
      mfaPolicy: mfa_policy
    }
  }
}

export async function mfaDisable(req: FastifyRequest, reply: FastifyReply) {
  const user = req.user
  if (!user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' })

  const { mfa_policy = MfaPolicy.OPTIONAL } = global.config.options || {}
  if (mfa_policy === MfaPolicy.MANDATORY || mfa_policy === MfaPolicy.ONE_WAY) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'MFA disable is not allowed by security policy' })
  }

  try {
    await req.server['userManager'].disableMfa(user.getId(), req.runner)
    return { ok: true }
  } catch (error: any) {
    req.log.error({ err: error }, 'MFA Disable failed')
    return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to disable MFA' })
  }
}
