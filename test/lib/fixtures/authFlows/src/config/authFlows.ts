import type { AuthFlowsConfig } from '../../../../../../types/global.js'

// A project that declares the tenant plane only, and one limit.
const authFlows: AuthFlowsConfig = {
  tenant: {
    identify: ['password'],
    flows: [
      { roles: ['admin'], stages: [{ anyOf: ['sms'] }] },
      { roles: ['*'], stages: [] }
    ]
  },
  limits: { flowTtl: 900 }
}

export default authFlows
