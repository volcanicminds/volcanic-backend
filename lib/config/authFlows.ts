import type { AuthFlowsConfig } from '../../types/global.js'

//
// The framework's flows (F33, F34): the login of today on both planes, a
// password and then a TOTP code for whoever has one enrolled.
//
// A project's `src/config/authFlows.ts` replaces a plane's block whole, never merges into it: a
// stage list merged with this one is the quietest way to end up with a login one factor short.
// The MFA policy is not written here: `MANDATORY` is applied by the engine whatever a flow says.
//
const authFlows: AuthFlowsConfig = {
  tenant: {
    identify: ['password'],
    flows: [{ roles: ['*'], stages: [{ anyOf: ['totp'], optional: true }] }]
  },
  control: {
    identify: ['password'],
    flows: [{ roles: ['*'], stages: [{ anyOf: ['totp'], optional: true }] }]
  },
  limits: {
    flowTtl: 600,
    otpTtl: 300,
    otpMaxAttempts: 5,
    otpMaxSends: 3
  }
}

export default authFlows
