/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyReply, FastifyRequest } from 'fastify'
import * as regExp from '../../../util/regexp.js'
import { MfaPolicy } from '../../../config/constants.js'
import { httpError } from '../../../util/httpError.js'
import { dataContext, isTenancyEnabled } from '../../../util/tenancy.js'
import { uuidv7 } from '../../../util/uuid.js'
import { EMAIL_ALREADY_REGISTERED } from '../../../config/constants.js'
import {
  clearSessionCookies,
  isCookieMode,
  issuePreAuth,
  issueSession,
  refreshCookieOf,
  REFRESH_TYP,
  sessionTokenOf,
  setAccessCookie
} from '../../../util/credential.js'

// Upper bound for the password accepted at login: a cheap guard against oversized
// payloads. Complexity is enforced only when a password is set, not at login.
const MAX_PASSWORD_LENGTH = 256

// TOTP period in seconds — must match the period used by the MFA manager (tools default: 30).
const TOTP_PERIOD_SECONDS = 30

const DEFAULT_RESET_PASSWORD_TOKEN_TTL = 3600

/** Reset-token TTL in seconds, applied when /auth/forgot-password mints the token. */
export function resetPasswordTokenTtl(): number {
  return Number(global.config?.options?.reset_password_token_ttl) || DEFAULT_RESET_PASSWORD_TOKEN_TTL
}

/**
 * True when a reset token is past the deadline it carries in its own
 * `<epochSeconds>.<random>` prefix (see `userManager.forgotPassword`, which
 * explains why the deadline is not read back from the DB).
 *
 * Fails closed: a token without a parsable epoch counts as expired. Tampering is
 * a non-issue — the token is the lookup key, so an edited epoch matches no row.
 */
function isResetTokenExpired(code: string): boolean {
  const expiresAt = Number(String(code ?? '').split('.')[0])
  if (!Number.isFinite(expiresAt)) return true
  return Date.now() / 1000 > expiresAt
}

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

/**
 * The single answer every login failure that happens *before* a verified password gets
 * (defect D-17, docs/API_V5.md §2.1).
 *
 * v4 said which of «Wrong credentials», «Invalid user», «User email unconfirmed» and «User
 * blocked» applied. Those four messages are a directory: they tell anyone who asks whether an
 * address has an account here, and whether that account is merely unconfirmed or has been
 * shut off — the two facts a credential-stuffing list is built out of. The caller now gets
 * one code for all four; the cause goes to the log, where the operator answering the support
 * call can read it and the internet cannot.
 *
 * 401 and not 403: the request was not authenticated, which is what 401 means. v4 answered
 * 403 for all of them, and that is one of the breaks written down in the migration guide.
 */
function refuseLogin(reply: FastifyReply, cause: string, email: string) {
  if (log.w) log.warn(`Login refused (${cause}) for ${email}`)
  return reply.status(401).send(httpError(401, 'Invalid credentials', 'AUTH_INVALID_CREDENTIALS'))
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

  // Registration never grants the admin role — the admin apex is provisioned only at boot
  // from ADMIN_EMAIL (see docs/AUTHORIZATION_MODEL.md §6). `public` is the default.
  const publicRole = global.roles?.public?.code || 'public'
  const adminRole = global.roles?.admin?.code || 'admin'
  data.roles = (data.requiredRoles || [])
    .map((r) => global.roles[r]?.code)
    .filter((r) => !!r && r !== adminRole)
  if (!data.roles.includes(publicRole)) {
    data.roles.push(publicRole)
  }

  // No lookup before the insert, on purpose. A pre-check answers before anything expensive
  // has happened, so a taken address comes back in milliseconds and a free one comes back
  // after a bcrypt hash: the two are one stopwatch apart, and the uniform body of decision A5
  // would be undone by the latency. Letting the unique index decide means both paths hash,
  // both paths touch the database, and both cost the same.
  let user: any
  try {
    user = await req.server['userManager'].createUser(dataContext(req), { ...data, password: password })
  } catch (err: any) {
    if (err?.code !== EMAIL_ALREADY_REGISTERED) throw err

    // An address that is already registered gets the answer a new one gets (decision A5).
    // Anything else — a different status, a different body, a different latency — walks a
    // list of addresses and learns which of them have accounts here. Nothing is created; the
    // identifiers below are minted for this response alone and are stored nowhere, in the
    // same v7 shape the database mints so the version nibble does not answer the question
    // either.
    if (log.w) log.warn(`Registration refused (AUTH_EMAIL_TAKEN) for ${data.email}`)
    return {
      id: uuidv7(),
      externalId: uuidv7(),
      username: data.username ?? null,
      email: String(data.email).trim().toLowerCase(),
      roles: data.roles
    }
  }

  if (!user) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'User not registered' })
  }

  return user
}

export async function unregister(req: FastifyRequest, reply: FastifyReply) {
  const { email, password } = req.data()

  let user = await req.server['userManager'].retrieveUserByPassword(dataContext(req), email, password)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong credentials' })
  }

  if (user.blocked) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User blocked' })
  }

  user = await req.server['userManager'].disableUserById(dataContext(req), user.id)
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

  let user = await req.server['userManager'].retrieveUserByPassword(dataContext(req), email, oldPassword)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong credentials' })
  }

  if (user.blocked) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User blocked' })
  }

  user = await req.server['userManager'].changePassword(dataContext(req), email, newPassword1, oldPassword)
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
    user = await req.server['userManager'].retrieveUserByEmail(dataContext(req), email)
  } else if (username) {
    user = await req.server['userManager'].retrieveUserByUsername(dataContext(req), username)
  }

  const isValid = await req.server['userManager'].isValidUser(user)

  // Account-enumeration hardening: do NOT reveal whether the account exists, is
  // invalid or is blocked. Always answer 200 with a generic body; only actually
  // trigger the reset flow when the user exists, is valid and not blocked.
  // (A residual timing side-channel remains since the valid path does a DB write.)
  if (isValid && !user?.blocked) {
    const updated = await req.server['userManager'].forgotPassword(dataContext(req), user.email, resetPasswordTokenTtl())
    // The token never reaches the response — it is handed to the
    // `global.postForgotPassword` middleware, which the consumer implements to
    // deliver it (the core has no mailer and cannot know the frontend URL).
    req.resetToken = updated?.resetPasswordToken
  }

  return { ok: true }
}

export async function confirmEmail(req: FastifyRequest, reply: FastifyReply) {
  const { code } = req.data()

  if (!code) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing the confirm email token' })
  }

  let user = await req.server['userManager'].retrieveUserByConfirmationToken(dataContext(req), code)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong credentials' })
  }

  if (user.blocked) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User blocked' })
  }

  user = await req.server['userManager'].userConfirmation(dataContext(req), user)
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

  let user = await req.server['userManager'].retrieveUserByResetPasswordToken(dataContext(req), code)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong credentials' })
  }

  if (user.blocked) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User blocked' })
  }

  // Distinct message on purpose: the caller already holds a token that matched a
  // row, so telling them it aged out reveals nothing and lets the UI offer a new link.
  if (isResetTokenExpired(code)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Reset token expired' })
  }

  user = await req.server['userManager'].resetPassword(dataContext(req), user, newPassword1)
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

  let user = await req.server['userManager'].retrieveUserByPassword(dataContext(req), email, password)
  if (!user) {
    // The manager cannot say which of the two it was: it compares against a dummy hash when
    // the address is unknown, precisely so the answer costs the same either way. The lookup
    // that tells them apart therefore runs here, on the failure path only, for the log. It
    // gives an attacker nothing — the response, its code and its body are identical — and it
    // gives the operator the one line that makes a support call answerable.
    const known = await req.server['userManager'].retrieveUserByEmail(dataContext(req), email)
    return refuseLogin(reply, known ? 'AUTH_BAD_PASSWORD' : 'AUTH_UNKNOWN_EMAIL', email)
  }

  const isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return refuseLogin(reply, 'AUTH_INVALID_USER', email)
  }

  if (!(user.confirmed === true)) {
    return refuseLogin(reply, 'AUTH_UNCONFIRMED', email)
  }

  // Before the expiry check, and not after it as in v4: a blocked account whose password had
  // aged out was answered `PASSWORD_TO_BE_CHANGED`, which is a distinct code handed to
  // someone the deployment has decided to shut out.
  if (user.blocked) {
    return refuseLogin(reply, 'AUTH_BLOCKED', email)
  }

  // Stays distinct, and stays 403: it is reached only after the password verified, so it
  // tells the caller nothing they did not already prove they knew.
  const isPasswordToBeChanged = req.server['userManager'].isPasswordToBeChanged(user)
  if (isPasswordToBeChanged) {
    return reply.status(403).send(httpError(403, 'Password is expired', 'PASSWORD_TO_BE_CHANGED'))
  }

  // MFA Logic Interception
  const isMfaEnabled = user.mfaEnabled
  const isMandatory = mfa_policy === MfaPolicy.MANDATORY

  if (isMfaEnabled || isMandatory) {
    // In cookie mode the pre-auth token goes in the cookie and `tempToken` is null.
    const tempToken = await issuePreAuth(reply, 'tenant', { sub: user.externalId, tid: req.tenantInfo?.id })
    // Use 202 Accepted to bypass 200 OK strict schema filtering
    return reply.status(202).send({
      mfaRequired: isMfaEnabled, // If enabled, verify. If not enabled but mandatory, setup.
      mfaSetupRequired: isMandatory && !isMfaEnabled,
      tempToken: tempToken
    })
  }

  if (config.options.reset_external_id_on_login) {
    user = await req.server['userManager'].resetExternalId(dataContext(req), user.id)
  }

  // https://www.iana.org/assignments/jwt/jwt.xhtml
  // In cookie mode both come back null: the session is in the cookies.
  const { token, refreshToken } = await issueSession(reply, 'tenant', { sub: user.externalId, tid: req.tenantInfo?.id })

  return {
    ...user,
    roles: (user.roles || [global.role?.public?.code || 'public']).map((r) => r?.code || r),
    token,
    refreshToken,
    securityPolicy: {
      mfaPolicy: mfa_policy
    }
  }
}

export async function logout(_req: FastifyRequest, reply: FastifyReply) {
  clearSessionCookies(reply, 'tenant')
  return { ok: true }
}

export async function refreshToken(req: FastifyRequest, reply: FastifyReply) {
  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  // Refresh tokens are optional (JWT_REFRESH). When disabled there is no refresh
  // verifier registered — answer a clean 404 instead of throwing a 500 later.
  if (!reply.server.jwt['refreshToken']) {
    return reply.status(404).send(httpError(404, 'Refresh tokens are disabled', 'NOT_FOUND'))
  }

  if (isCookieMode()) return renewFromCookie(req, reply)

  const { token, refreshToken } = req.data()
  if (!token || !refreshToken) {
    return reply
      .status(400)
      .send({ statusCode: 400, error: 'Bad Request', message: 'Missing token or refreshToken' })
  }

  // Verify the signature of the (possibly expired) access token: `ignoreExpiration`
  // lets a stale token through — which is the whole point of refresh — but a forged
  // or tampered token is now rejected (previously `decode` skipped signature checks).
  let tokenData: { sub: number; iat?: number; tid?: string; typ?: string; imp?: string }
  try {
    tokenData = (await reply.server.jwt.verify(token, { ignoreExpiration: true })) as {
      sub: number
      iat?: number
      tid?: string
      typ?: string
      imp?: string
    }
  } catch {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Invalid token' })
  }
  // An impersonated session ends with its record and is never renewed into an ordinary one;
  // and a refresh token in the place of the access token is the pair collapsing into one.
  if (tokenData.typ === REFRESH_TYP || tokenData.imp) {
    return reply.status(403).send(httpError(403, 'Invalid token'))
  }

  // Defect D-19. This is the one route where the token arrives in the BODY, so the tenant
  // resolution of T-3.2 could not read it: it resolved the container from the header, as it
  // does for any request without an Authorization token. The comparison therefore has to
  // happen here, or renewal becomes the single door through which a token issued for one
  // tenant is exchanged for a token valid in another.
  if (isTenancyEnabled() && tokenData.tid !== req.tenantInfo?.id) {
    return reply.status(403).send(httpError(403, 'The token does not belong to this tenant', 'TENANT_MISMATCH'))
  }

  // Reject refresh of access tokens issued too long ago. Use the real temporal
  // claim (`iat`), not `sub` (the externalId): the old check compared a user id
  // against a unix timestamp and was effectively dead code.
  const minAccettable = Math.floor(Date.now() / 1000) - 2592000 // 30 days
  if (!tokenData?.iat || tokenData.iat < minAccettable) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Token too old' })
  }

  // Verified inside a try: an expired or forged refresh token is a refusal, not a 500.
  let refreshTokenData: { sub?: number; tid?: string; typ?: string }
  try {
    refreshTokenData = await reply.server.jwt['refreshToken'].verify(refreshToken)
  } catch {
    return reply.status(403).send(httpError(403, 'Invalid refresh token'))
  }
  // Without the claim an access token verifies as a refresh token whenever the two secrets
  // are the same, and a short access token could then renew itself forever.
  if (refreshTokenData?.typ !== REFRESH_TYP) {
    return reply.status(403).send(httpError(403, 'Invalid refresh token'))
  }
  if (tokenData?.sub && tokenData?.sub !== refreshTokenData?.sub) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Mismatched tokens' })
  }
  // The pair must agree on the tenant too: checking only the subject would let an access
  // token of one tenant be renewed against a refresh token minted in another.
  if (isTenancyEnabled() && refreshTokenData?.tid !== tokenData.tid) {
    return reply.status(403).send(httpError(403, 'The token does not belong to this tenant', 'TENANT_MISMATCH'))
  }

  const user = await req.server['userManager'].retrieveUserByExternalId(dataContext(req), tokenData.sub)
  const isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Wrong refresh token' })
  }

  const newToken = await reply.jwtSign({ sub: user.externalId, tid: req.tenantInfo?.id })
  return {
    token: newToken
  }
}

/**
 * Renewal in cookie mode (T-10.39): the refresh token is the whole credential.
 *
 * The bearer renewal asks for the expired access token too, and binds the pair on subject and
 * tenant. Here the access cookie is gone by the time it is needed, because it lives exactly as
 * long as its token (T-10.38), so the bindings are checked on the refresh token itself: it
 * carries the subject and the tenant it was issued for, and it arrives from a signed httpOnly
 * cookie that only this server writes, restricted to this route.
 */
async function renewFromCookie(req: FastifyRequest, reply: FastifyReply) {
  const refreshToken = refreshCookieOf(req, 'tenant')
  if (!refreshToken) {
    return reply.status(401).send(httpError(401, 'No refresh cookie on this request', 'REFRESH_REQUIRED'))
  }

  let data: { sub?: string; tid?: string; typ?: string }
  try {
    data = await reply.server.jwt['refreshToken'].verify(refreshToken)
  } catch {
    clearSessionCookies(reply, 'tenant')
    return reply.status(401).send(httpError(401, 'The session has expired', 'REFRESH_REQUIRED'))
  }
  if (data?.typ !== REFRESH_TYP || !data.sub) {
    clearSessionCookies(reply, 'tenant')
    return reply.status(403).send(httpError(403, 'Invalid refresh token'))
  }
  // D-19 again, on the only token there is: renewal must not become the door through which a
  // session of one tenant is exchanged for a session in another.
  if (isTenancyEnabled() && data.tid !== req.tenantInfo?.id) {
    return reply.status(403).send(httpError(403, 'The token does not belong to this tenant', 'TENANT_MISMATCH'))
  }

  const user = await req.server['userManager'].retrieveUserByExternalId(dataContext(req), data.sub)
  const isValid = user ? await req.server['userManager'].isValidUser(user) : false
  if (!isValid || user.blocked) {
    clearSessionCookies(reply, 'tenant')
    return reply.status(403).send(httpError(403, 'Wrong refresh token'))
  }

  setAccessCookie(reply, 'tenant', await reply.jwtSign({ sub: user.externalId, tid: req.tenantInfo?.id }))
  return { token: null }
}

export async function invalidateTokens(req: FastifyRequest, reply: FastifyReply) {
  let isValid = await req.server['userManager'].isValidUser(req.user)
  if (!req.user || !isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User not linked' })
  }

  const user = await req.server['userManager'].resetExternalId(dataContext(req), req.user.id)
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
    await req.server['userManager'].saveMfaSecret(dataContext(req), user.id, secret)
    await req.server['userManager'].enableMfa(dataContext(req), user.id)

    // Record the consumed time-step so the same code cannot be replayed on the first /mfa/verify.
    if (counter !== null) {
      await req.server['userManager'].updateUserById(dataContext(req), user.id, { mfaLastUsedCounter: counter })
    }

    // IMPORTANT: Return full tokens upon enablement if user was in pending state
    // BUT usually user is already logged in via temp token or full token.
    // If user is setting up from "Forced Setup", they need tokens now.

    const { token: finalToken, refreshToken } = await issueSession(reply, 'tenant', {
      sub: user.externalId,
      tid: req.tenantInfo?.id
    })

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
  // In cookie mode the pre-auth token is in the access cookie, and reading the header by hand
  // here made MFA unusable in that mode.
  const tokenStr = sessionTokenOf(req, 'tenant')
  const { mfa_policy = MfaPolicy.OPTIONAL } = global.config.options || {}

  if (!tokenStr) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Missing authorization' })

  let decoded: any
  try {
    decoded = req.server.jwt.verify(tokenStr)
  } catch (_e) {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid token' })
  }

  if (decoded.role !== 'pre-auth-mfa' && (!req.user || !req.user.id)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Invalid token scope' })
  }

  const subjectId = decoded.sub
  const { token } = req.data()
  if (!token) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing token' })

  // 1. Retrieve secret via userManager
  const user = await req.server['userManager'].retrieveUserByExternalId(dataContext(req), subjectId)
  if (!user) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })

  const secret = await req.server['userManager'].retrieveMfaSecret(dataContext(req), user.id)
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
    await req.server['userManager'].updateUserById(dataContext(req), user.id, { mfaLastUsedCounter: counter })
  }

  if (config.options.reset_external_id_on_login) {
    await req.server['userManager'].resetExternalId(dataContext(req), user.id)
  }

  const { token: finalToken, refreshToken } = await issueSession(reply, 'tenant', {
    sub: user.externalId,
    tid: req.tenantInfo?.id
  })

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
    await req.server['userManager'].disableMfa(dataContext(req), user.id)
    return { ok: true }
  } catch (error: any) {
    req.log.error({ err: error }, 'MFA Disable failed')
    return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to disable MFA' })
  }
}
