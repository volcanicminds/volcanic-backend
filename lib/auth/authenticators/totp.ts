import type { AuthContext, AuthInput, AuthResult, AuthSubject, Authenticator, ControlHandle, EnrolmentSetup } from '../../../types/global.js'
import { absoluteStep, isReplay } from '../../util/mfaCounter.js'
import { mfaAvailable } from '../../util/mfaPolicy.js'

//
// `totp` as a verifier (T-12.20), and the in-flow enrolment the MFA floor demands (T-12.21).
//
// The engine reserves one of the flow's attempts before `verify` runs, so a wrong code, a replayed
// one and a burst of parallel guesses all spend the same ceiling. A replay answers exactly like a
// wrong code: telling the two apart would confirm to whoever holds a stolen code that it was right.
//
// During an in-flow enrolment the secret was generated here, on the server, and waits encrypted in
// the flow row; the first right code moves it onto the subject. The client never sends a secret.
//

const INVALID: AuthResult = { outcome: 'fail', reason: 'FLOW_CODE_INVALID' }

/** The two planes keep the secret and the step counter in different stores. */
function store(ctx: AuthContext) {
  if (ctx.plane === 'control') {
    const users = ctx.managers.systemUserManager
    const handle = ctx.handle as ControlHandle
    return {
      secretOf: (id: string) => users.retrieveMfaSecret(handle, id),
      lastStepOf: async (id: string) => (await users.retrieveSystemUserById(handle, id))?.mfaLastUsedCounter as number | null | undefined,
      recordStep: (id: string, counter: number) => users.recordMfaCounter(handle, id, counter),
      save: async (id: string, secret: string) => {
        await users.saveMfaSecret(handle, id, secret)
        await users.enableMfa(handle, id)
      }
    }
  }
  const users = ctx.managers.userManager
  return {
    secretOf: (id: string) => users.retrieveMfaSecret(ctx.handle, id),
    lastStepOf: async (id: string) => (await users.retrieveUserById(ctx.handle, id))?.mfaLastUsedCounter as number | null | undefined,
    recordStep: (id: string, counter: number) => users.updateUserById(ctx.handle, id, { mfaLastUsedCounter: counter }),
    save: async (id: string, secret: string) => {
      await users.saveMfaSecret(ctx.handle, id, secret)
      await users.enableMfa(ctx.handle, id)
    }
  }
}

const enrolled = (subject: AuthSubject) => subject.factors.includes('totp')

export const totpAuthenticator: Authenticator = {
  id: 'totp',
  kind: 'verifier',
  planes: ['tenant', 'control'],

  isEnrolled: (_ctx, subject) => enrolled(subject),

  async enrol(ctx: AuthContext, subject: AuthSubject): Promise<EnrolmentSetup> {
    const appName = process.env.MFA_APP_NAME || 'VolcanicApp'
    return await ctx.managers.mfaManager.generateSetup(appName, subject.email)
  },

  async verify(ctx: AuthContext, input: AuthInput): Promise<AuthResult> {
    const subject = ctx.subject
    const code = typeof input.code === 'string' ? input.code.trim() : ''
    if (!subject || !code) return INVALID
    if (!mfaAvailable(ctx.managers.mfaManager)) return { outcome: 'fail', reason: 'MFA_NOT_AVAILABLE' }

    const keys = store(ctx)
    const pending = enrolled(subject) ? undefined : ctx.flow?.external?.enrolmentSecret
    const secret = pending ?? (await keys.secretOf(subject.id))
    if (!secret) return INVALID

    // Awaited: the contract allows an async verifier, and an unawaited Promise read as a result
    // would be neither a number nor null.
    const { valid, counter } = absoluteStep(await ctx.managers.mfaManager.verify(code, secret))
    if (!valid) return INVALID

    if (pending) {
      await keys.save(subject.id, pending)
    } else if (isReplay(counter, await keys.lastStepOf(subject.id))) {
      return INVALID
    }
    if (counter !== null) await keys.recordStep(subject.id, counter)
    return { outcome: 'success' }
  }
}
