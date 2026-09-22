import { randomInt } from 'crypto'
import type {
  AuthContext,
  AuthInput,
  AuthResult,
  AuthSubject,
  Authenticator,
  ChallengeLimits,
  ChallengePurpose,
  ControlHandle
} from '../../../types/global.js'
import * as regExp from '../../util/regexp.js'
import { toSubject } from '../subjects.js'

//
// `email-otp` in its two roles (T-12.22, T-12.23).
//
// As a verifier it sends a code to the address on file of a subject already identified, and only
// of a confirmed one: an address nobody proved is not a channel a second factor may travel on.
// As an identifier the address is all the caller has, so the answer must not tell whether it
// belongs to anybody (F43): an unknown address gets the same 202, the same descriptor and the same
// write to the flow row (a code nobody receives), and the only difference, the delivery, happens
// after the response is decided and is never awaited, because the latency of a mail server is a
// stopwatch.
//
// The code comes from the CSPRNG and is stored as an HMAC keyed by the flow secret, which the
// authenticator never sees: it goes through `ctx.challenges`, bound by the engine to the credential
// of the request. Checking and spending it is one conditional statement in the store.
//

export const EMAIL_OTP_ID = 'email-otp'

/** Six digits after a first factor, eight when the address alone asks for the code (F37). */
const CODE_LENGTH: Record<ChallengePurpose, number> = { verify: 6, identify: 8 }

/** Per subject, across every flow: restarting a login does not reset the count (F37). */
export const SUBJECT_SEND_WINDOWS: ChallengeLimits['perSubject'] = [
  { max: 5, windowSeconds: 15 * 60 },
  { max: 20, windowSeconds: 24 * 60 * 60 }
]

const MAX_EMAIL_LENGTH = 320

export function newCode(purpose: ChallengePurpose): string {
  const length = CODE_LENGTH[purpose]
  return String(randomInt(0, 10 ** length)).padStart(length, '0')
}

/** `d***@a***.com`: enough for a person to recognise the address, not enough to learn it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  const host = dot > 0 ? domain.slice(0, dot) : domain
  const tld = dot > 0 ? domain.slice(dot) : ''
  return `${local[0]}***@${host[0] ?? ''}***${tld}`
}

/** The subject behind an address, when it may receive a code: valid, confirmed, not blocked. */
async function eligibleByEmail(ctx: AuthContext, email: string): Promise<AuthSubject | null> {
  if (ctx.plane === 'control') {
    const user = await ctx.managers.systemUserManager.retrieveSystemUserByEmail(ctx.handle as ControlHandle, email)
    return user && !user.blocked ? toSubject('control', user) : null
  }
  const users = ctx.managers.userManager
  const user = await users.retrieveUserByEmail(ctx.handle, email)
  if (!user || !(await users.isValidUser(user)) || user.confirmed !== true || user.blocked) return null
  return toSubject('tenant', user)
}

async function byExternalId(ctx: AuthContext, externalId: string): Promise<AuthSubject | null> {
  if (ctx.plane === 'control') {
    const user = await ctx.managers.systemUserManager.retrieveSystemUserByExternalId(ctx.handle as ControlHandle, externalId)
    return user ? toSubject('control', user) : null
  }
  const user = await ctx.managers.userManager.retrieveUserByExternalId(ctx.handle, externalId)
  return user ? toSubject('tenant', user) : null
}

/** After the response: scheduled, not awaited, and a failure is a log line and nothing else. */
function deliverLater(ctx: AuthContext, subject: AuthSubject, code: string, purpose: ChallengePurpose, expiresAt: Date): void {
  const port = ctx.managers.challengeDeliveryManager
  setImmediate(() => {
    Promise.resolve()
      .then(() =>
        port.deliver({
          channel: 'email',
          to: subject.email,
          code,
          purpose,
          expiresAt,
          plane: ctx.plane,
          tenantId: ctx.tenant?.id ?? null,
          subjectId: subject.externalId
        })
      )
      .catch((error) => {
        if (log.w) log.warn(`Email code not delivered to subject ${subject.externalId} (${(error as Error)?.message})`)
      })
  })
}

/**
 * Sends one code. `subject` null is the unknown address of the identifier role: the same write to
 * the row, a code nobody will ever receive, and the same answer.
 */
async function send(ctx: AuthContext, subject: AuthSubject | null, destination: string, purpose: ChallengePurpose): Promise<AuthResult> {
  const challenges = ctx.challenges
  if (!challenges) return { outcome: 'fail', reason: 'AUTH_FLOW_NOT_AVAILABLE' }

  const code = newCode(purpose)
  const now = Date.now()
  const expiresAt = new Date(now + ctx.limits.otpTtl * 1000)
  const recorded = await challenges.record({
    method: EMAIL_OTP_ID,
    code,
    expiresAt,
    limits: { perFlow: ctx.limits.otpMaxSends, perSubject: SUBJECT_SEND_WINDOWS }
  })

  const descriptor = (resendAt: Date | string | null) => ({
    outcome: 'challenge' as const,
    challenge: {
      channel: 'email' as const,
      destination: maskEmail(destination),
      expiresAt: expiresAt.toISOString(),
      resendAt: resendAt === null ? null : new Date(resendAt).toISOString()
    }
  })

  if (recorded.outcome === 'limit') {
    // The per-flow ceiling is the same for every address, so saying it reveals nothing. The
    // per-subject one exists only for a real subject: as an identifier it is answered as a send
    // that went out, and nothing is sent. The code already in the flow stays valid.
    if (recorded.scope === 'subject' && purpose === 'identify') return descriptor(new Date(now))
    return { outcome: 'fail', reason: 'FLOW_SEND_LIMIT', recoverable: true, retryAt: recorded.retryAt }
  }

  if (subject) deliverLater(ctx, subject, code, purpose, expiresAt)
  // As an identifier, an unknown address never meets a per-subject window: the next send is
  // allowed now for both, and only the per-flow count may close it.
  const resendAt = recorded.resendAt === null ? null : purpose === 'identify' ? new Date(now) : recorded.resendAt
  return descriptor(resendAt)
}

/** A consumed code, read back as the answer of a method. */
function refusal(outcome: 'invalid' | 'exhausted' | 'expired', remaining?: number): AuthResult {
  if (outcome === 'exhausted') return { outcome: 'fail', reason: 'FLOW_ATTEMPTS_EXHAUSTED' }
  if (outcome === 'expired') return { outcome: 'fail', reason: 'FLOW_CODE_EXPIRED', recoverable: true }
  return { outcome: 'fail', reason: 'FLOW_CODE_INVALID', recoverable: true, remaining }
}

export const emailOtpAuthenticator: Authenticator = {
  id: EMAIL_OTP_ID,
  kind: ['identifier', 'verifier'],
  planes: ['tenant', 'control'],

  // Nothing to enrol: the factor is the address on file, and it counts once somebody proved it.
  isEnrolled: (_ctx, subject) => subject.confirmed && Boolean(subject.email),

  async initiate(ctx: AuthContext, input: AuthInput): Promise<AuthResult> {
    // The verifier: the destination is the subject's own, whatever the body says.
    if (ctx.subject) {
      if (!ctx.subject.confirmed || !ctx.subject.email) return { outcome: 'fail', reason: 'FLOW_METHOD_NOT_ALLOWED' }
      return await send(ctx, ctx.subject, ctx.subject.email, 'verify')
    }

    const email = typeof input.email === 'string' ? input.email.trim() : ''
    if (!email || email.length > MAX_EMAIL_LENGTH || !regExp.isEmail(email)) return { outcome: 'fail', reason: 'AUTH_INPUT_INVALID' }

    // The flow is bound to the subject its first send named. A later send for another address,
    // or for an address that is nobody, costs the same and delivers nothing.
    const found = await eligibleByEmail(ctx, email)
    const candidate = ctx.flow?.candidateSubjectId ?? null
    let subject: AuthSubject | null = null
    if (found && (candidate === null || candidate === found.externalId)) {
      if (candidate === null && !(await ctx.challenges?.nominate(found.externalId))) return { outcome: 'fail', reason: 'FLOW_REQUIRED' }
      subject = found
    }
    return await send(ctx, subject, email, 'identify')
  },

  async verify(ctx: AuthContext, input: AuthInput): Promise<AuthResult> {
    const code = typeof input.code === 'string' ? input.code.trim() : ''
    if (!ctx.challenges) return { outcome: 'fail', reason: 'AUTH_FLOW_NOT_AVAILABLE' }
    if (!/^\d{1,16}$/.test(code)) return refusal('invalid')

    const consumed = await ctx.challenges.consume(code)
    if (consumed.outcome !== 'ok') return refusal(consumed.outcome, consumed.outcome === 'invalid' ? consumed.remaining : undefined)

    // The verifier proves the subject already known; the identifier names the candidate the code
    // was sent to, and the engine loads and validates it again before trusting it.
    if (ctx.subject) return { outcome: 'success' }
    const candidate = ctx.flow?.candidateSubjectId
    const subject = candidate ? await byExternalId(ctx, candidate) : null
    return subject ? { outcome: 'success', subject } : { outcome: 'fail', reason: 'AUTH_INVALID_CREDENTIALS' }
  }
}
