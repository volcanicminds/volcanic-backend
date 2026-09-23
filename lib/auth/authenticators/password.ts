import type { AuthContext, AuthInput, AuthResult, Authenticator, ControlHandle } from '../../../types/global.js'
import * as regExp from '../../util/regexp.js'
import { tenantRefusal, toSubject } from '../subjects.js'

//
// `password` as an identifier (T-12.19): the login of both planes, moved here from the two
// controllers that each wrote it once.
//
// Every failure before a verified password is the one refusal of D-17: an unknown address, a wrong
// password, an invalid, unconfirmed or blocked account all answer `AUTH_INVALID_CREDENTIALS`, and
// the cause goes to the log only. `PASSWORD_TO_BE_CHANGED` stays distinct because it is reached
// after the password verified, and it belongs to this method: a subject who identifies another way
// has proven nothing about a password.
//

/** Upper bounds, not policies: a cheap guard against oversized payloads, per plane as before. */
const MAX_PASSWORD_LENGTH = { tenant: 256, control: 128 } as const

const refused = (cause: string, email: string): AuthResult => {
  if (log.w) log.warn(`Login refused (${cause}) for ${email}`)
  return { outcome: 'fail', reason: 'AUTH_INVALID_CREDENTIALS' }
}

async function verifyTenant(ctx: AuthContext, email: string, password: string): Promise<AuthResult> {
  const users = ctx.managers.userManager
  const user = await users.retrieveUserByPassword(ctx.handle, email, password)
  if (!user) {
    // The manager compares against a dummy hash for an unknown address, so the answer costs the
    // same either way; the lookup that tells the two apart runs on the failure path, for the log.
    const known = await users.retrieveUserByEmail(ctx.handle, email)
    return refused(known ? 'AUTH_BAD_PASSWORD' : 'AUTH_UNKNOWN_EMAIL', email)
  }
  // Before the expiry, so a blocked or waiting account never learns that its password aged out.
  const cause = await tenantRefusal(users, user)
  if (cause) return refused(cause, email)
  if (users.isPasswordToBeChanged(user)) return { outcome: 'fail', reason: 'PASSWORD_TO_BE_CHANGED' }
  return { outcome: 'success', subject: toSubject('tenant', user) }
}

async function verifyControl(ctx: AuthContext, email: string, password: string): Promise<AuthResult> {
  const user = await ctx.managers.systemUserManager.retrieveSystemUserByPassword(ctx.handle as ControlHandle, email, password)
  if (!user) return refused('AUTH_BAD_CREDENTIALS', email)
  if (user.blocked) return refused('AUTH_BLOCKED', email)
  return { outcome: 'success', subject: toSubject('control', user) }
}

export const passwordAuthenticator: Authenticator = {
  id: 'password',
  kind: 'identifier',
  planes: ['tenant', 'control'],
  async verify(ctx: AuthContext, input: AuthInput): Promise<AuthResult> {
    const { email, password } = input
    if (typeof email !== 'string' || !regExp.isEmail(email)) return { outcome: 'fail', reason: 'AUTH_INPUT_INVALID' }
    if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH[ctx.plane]) {
      return { outcome: 'fail', reason: 'AUTH_INPUT_INVALID' }
    }
    return ctx.plane === 'control' ? verifyControl(ctx, email, password) : verifyTenant(ctx, email, password)
  }
}
