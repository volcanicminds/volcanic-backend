/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyReply, FastifyRequest } from 'fastify'
import * as regExp from '../../../util/regexp.js'
import { MfaPolicy } from '../../../config/constants.js'
import { allowsEnrolment, allowsSelfDisable, mfaAvailable, tenantPolicy } from '../../../util/mfaPolicy.js'
import { httpError } from '../../../util/httpError.js'
import { dataContext, isTenancyEnabled } from '../../../util/tenancy.js'
import { uuidv7 } from '../../../util/uuid.js'
import { EMAIL_ALREADY_REGISTERED } from '../../../config/constants.js'
import { clearSessionCookies, issuePreAuth, issueSession, sessionTokenOf, type SessionOrigin } from '../../../util/credential.js'
import { renew } from '../../../util/renewal.js'
import { CONTROL_ROUTING, sessionRegistryEnabled } from '../../../util/session.js'
// The delta-to-step conversion used to live here, and the control plane had its own copy that
// did not convert at all (T-10.20). One rule, one place.
import { absoluteStep as evaluateMfaResult, isReplay } from '../../../util/mfaCounter.js'

// Upper bound for the password accepted at login: a cheap guard against oversized
// payloads. Complexity is enforced only when a password is set, not at login.
const MAX_PASSWORD_LENGTH = 256

const DEFAULT_RESET_PASSWORD_TOKEN_TTL = 3600

/** Reset-token TTL in seconds, applied when /auth/forgot-password mints the token. */
export function resetPasswordTokenTtl(): number {
  return Number(global.config?.options?.reset_password_token_ttl) || DEFAULT_RESET_PASSWORD_TOKEN_TTL
}

/**
 * Where a tenant session is written down, and how a later renewal finds it again (T-11.7).
 *
 * The container is the one of the request, because a session belongs where its subject lives
 * (F19). `routing` is the segment the opaque refresh credential carries: the tenant id when
 * there are tenants, and `ctl` when there are none, which is not a fallback but the truth —
 * without tenants the application data lives in the control plane's own container.
 */
function tenantOrigin(req: FastifyRequest, subjectId: string): SessionOrigin {
  return {
    ctx: dataContext(req),
    manager: req.server['sessionManager'],
    subjectId,
    scope: 'tenant',
    routing: req.tenantInfo?.id ?? CONTROL_ROUTING,
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string) ?? null
  }
}

/** The session the access token of this request belongs to, when it carries one. */
function currentSid(req: FastifyRequest): string | undefined {
  const raw = sessionTokenOf(req, 'tenant')
  if (!raw) return undefined
  const claims = req.server.jwt.decode(raw) as { sid?: string } | null
  return typeof claims?.sid === 'string' ? claims.sid : undefined
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
  // The policy of THIS tenant (T-10.19): the deployment value is the floor, a customer may only
  // tighten it, and its own value rides in the registry row the resolution has already loaded.
  const mfa_policy = tenantPolicy(req.tenantInfo)

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
  const { token, refreshToken } = await issueSession(
    reply,
    'tenant',
    { sub: user.externalId, tid: req.tenantInfo?.id },
    tenantOrigin(req, user.externalId)
  )

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

/**
 * Ends the session, instead of only forgetting it (T-11.10).
 *
 * v4 cleared the browser's cookies and called that a logout. Anyone holding a copy of the
 * refresh cookie kept renewing afterwards, because nothing on the server had changed. The row
 * is revoked first, and the cookies go after: the user's belief and the server's state now
 * describe the same thing.
 */
export async function logout(req: FastifyRequest, reply: FastifyReply) {
  const manager = req.server['sessionManager']
  const sid = currentSid(req)
  if (sid && sessionRegistryEnabled(manager)) {
    await manager.revokeSession(dataContext(req), sid, 'logout')
  }
  clearSessionCookies(reply, 'tenant')
  return { ok: true }
}

/**
 * Renewal against the session registry (T-11.8).
 *
 * Both modes take the same path now. The credential is opaque, so there is no signature to
 * verify and no second token to pair it with: what the bearer renewal used to check by
 * comparing two JWTs — same subject, same tenant, issued not too long ago — is a property of
 * the row itself, which names one subject, lives in one container and carries two clocks.
 *
 * The flow is shared with the control plane (lib/util/renewal.ts) because the two were written
 * twice and drifted twice.
 */
export async function refreshToken(req: FastifyRequest, reply: FastifyReply) {
  const users = req.server['userManager']
  if (!users.isImplemented()) {
    throw new Error('Not implemented')
  }

  return renew({
    req,
    reply,
    plane: 'tenant',
    scope: 'tenant',
    ctx: dataContext(req),
    manager: req.server['sessionManager'],
    // Defect D-19: this is the one route where the credential arrives in the body or in a
    // cookie scoped to this path, so nothing upstream has decided which container it belongs
    // to. Renewal must not become the door through which a session of one tenant is exchanged
    // for a session in another.
    routing: isTenancyEnabled() ? (req.tenantInfo?.id ?? CONTROL_ROUTING) : null,
    claims: (user) => ({ sub: user.externalId, tid: req.tenantInfo?.id }),
    loadSubject: async (subjectId: string) => {
      const user = await users.retrieveUserByExternalId(dataContext(req), subjectId)
      const valid = user ? await users.isValidUser(user) : false
      return { subject: user, valid: Boolean(valid) && !user?.blocked }
    }
  })
}

export async function invalidateTokens(req: FastifyRequest, reply: FastifyReply) {
  let isValid = await req.server['userManager'].isValidUser(req.user)
  if (!req.user || !isValid) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'User not linked' })
  }

  // Two levels, and they are not the same act (F26). The sessions are closed first, by name, so
  // the registry says when each one ended and why; then the identity is rotated, which is the
  // hammer that also kills every access token already signed for the old `externalId`.
  //
  // The order matters: after the rotation the rows would be keyed to an `externalId` nobody
  // carries any more, and they would sit there live until their own expiry.
  const sessions = req.server['sessionManager']
  if (req.user.externalId && sessionRegistryEnabled(sessions)) {
    await sessions.revokeAllOfSubject(dataContext(req), req.user.externalId, 'tokens invalidated by the user')
  }

  const user = await req.server['userManager'].resetExternalId(dataContext(req), req.user.id)
  isValid = await req.server['userManager'].isValidUser(user)
  clearSessionCookies(reply, 'tenant')
  return { ok: isValid }
}

/**
 * The caller's own sessions (T-11.14).
 *
 * The registry existed for rotation; once it exists, "where am I logged in" is a question with an
 * answer, and the honest place to answer it is here rather than in every consuming project. The
 * rows carry no secret and no hash: the only handle a client needs is the `sid`, which is also
 * what it sends back to close one.
 */
export async function listSessions(req: FastifyRequest, reply: FastifyReply) {
  const sessions = req.server['sessionManager']
  if (!sessionRegistryEnabled(sessions)) {
    return reply.status(404).send(httpError(404, 'This build keeps no session registry', 'NOT_FOUND'))
  }
  if (!req.user?.externalId) {
    return reply.status(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED'))
  }

  const sid = currentSid(req)
  const rows = await sessions.listOfSubject(dataContext(req), req.user.externalId)
  return rows.map((row) => ({
    sid: row.sid,
    // So a console can say "this device" without the client comparing anything it holds.
    current: row.sid === sid,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null
  }))
}

/**
 * Closes one session of the caller: the scalpel next to the hammer (F26).
 *
 * Ownership is checked by looking the session up among the caller's own, never by trusting the
 * path: a `sid` is a handle, not an authorisation, and a session that belongs to somebody else
 * answers the same 404 as one that does not exist, because telling the two apart would turn the
 * identifier into an oracle.
 */
export async function revokeSession(req: FastifyRequest, reply: FastifyReply) {
  const sessions = req.server['sessionManager']
  if (!sessionRegistryEnabled(sessions)) {
    return reply.status(404).send(httpError(404, 'This build keeps no session registry', 'NOT_FOUND'))
  }
  if (!req.user?.externalId) {
    return reply.status(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED'))
  }

  const { id: sid } = req.params as { id?: string }
  const ctx = dataContext(req)
  const mine = await sessions.listOfSubject(ctx, req.user.externalId)
  if (!sid || !mine.some((row) => row.sid === sid)) {
    return reply.status(404).send(httpError(404, 'Not found', 'NOT_FOUND'))
  }

  await sessions.revokeSession(ctx, sid, 'closed by the user')
  // Closing the session you are speaking from is a logout, so it has to look like one here too.
  if (sid === currentSid(req)) clearSessionCookies(reply, 'tenant')
  return { ok: true }
}

export async function mfaSetup(req: FastifyRequest, reply: FastifyReply) {
  const user = req.user
  if (!user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' })
  if (!allowsEnrolment(tenantPolicy(req.tenantInfo))) {
    return reply.status(403).send(httpError(403, 'This policy accepts no new second factors', 'MFA_DISABLED'))
  }
  if (!mfaAvailable(req.server['mfaManager'])) {
    return reply.status(503).send(httpError(503, 'This build has no MFA manager', 'MFA_NOT_AVAILABLE'))
  }

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
  const mfa_policy = tenantPolicy(req.tenantInfo)

  if (!user || !secret || !token) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing parameters' })
  if (!allowsEnrolment(mfa_policy)) {
    return reply.status(403).send(httpError(403, 'This policy accepts no new second factors', 'MFA_DISABLED'))
  }
  if (!mfaAvailable(req.server['mfaManager'])) {
    return reply.status(503).send(httpError(503, 'This build has no MFA manager', 'MFA_NOT_AVAILABLE'))
  }

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

    const { token: finalToken, refreshToken } = await issueSession(
      reply,
      'tenant',
      { sub: user.externalId, tid: req.tenantInfo?.id },
      tenantOrigin(req, user.externalId)
    )

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
  // Verifying is allowed under every policy, `OFF` included: a factor already enrolled keeps
  // working, and it is only enrolment that the policy closes.
  const mfa_policy = tenantPolicy(req.tenantInfo)

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
  if (isReplay(counter, lastCounter)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'MFA token already used' })
  }
  if (counter !== null) {
    await req.server['userManager'].updateUserById(dataContext(req), user.id, { mfaLastUsedCounter: counter })
  }

  if (config.options.reset_external_id_on_login) {
    await req.server['userManager'].resetExternalId(dataContext(req), user.id)
  }

  const { token: finalToken, refreshToken } = await issueSession(
    reply,
    'tenant',
    { sub: user.externalId, tid: req.tenantInfo?.id },
    tenantOrigin(req, user.externalId)
  )

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

  // Self-service removal exists only where the factor is optional (T-10.19): `ONE_WAY` and
  // `MANDATORY` already refused it, and under `OFF` the way out is a reset by an administrator,
  // not a switch that undoes what the policy has just frozen.
  if (!allowsSelfDisable(tenantPolicy(req.tenantInfo))) {
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
