import type { Authenticator, AuthResult } from '../../types/global.js'

//
// The methods the framework ships, registered before a consumer's (T-12.3).
//
// They exist so that `config/authFlows.ts` can name them and the boot can validate what it names.
// The login routes still verify passwords and TOTP codes on their own and never call `verify`
// here: until the engine does, a call is refused with a code rather than half-served.
//
const notServedYet = async (): Promise<AuthResult> => ({ outcome: 'fail', reason: 'AUTH_FLOW_NOT_AVAILABLE' })

export const passwordAuthenticator: Authenticator = {
  id: 'password',
  kind: 'identifier',
  planes: ['tenant', 'control'],
  verify: notServedYet
}

export const totpAuthenticator: Authenticator = {
  id: 'totp',
  kind: 'verifier',
  planes: ['tenant', 'control'],
  verify: notServedYet,
  isEnrolled: (_ctx, subject) => subject.factors.includes('totp')
}

export const BUILTIN_AUTHENTICATORS: readonly Authenticator[] = [passwordAuthenticator, totpAuthenticator]
