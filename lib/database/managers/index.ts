import type { ControlHandle } from '../../../types/global.js'
import { createUserManager } from './user.js'
import { createTokenManager } from './token.js'
import { createTrackingManager } from './tracking.js'
import { createTenantManager, type TenantProvider } from './tenant.js'

export { createUserManager, createTokenManager, createTrackingManager, createTenantManager }
export { runtime, control } from './runtime.js'

//
// The set a consumer injects through `start(decorators)`.
//
// The system-user manager is not here yet: platform identities arrive with the control scope
// in T-4.1, and shipping a half of that model would be the kind of "declared but not
// enforced" boundary this rewrite exists to remove.
//
export function buildManagers(provider: TenantProvider & { control(): ControlHandle | Promise<ControlHandle> }) {
  return {
    userManager: createUserManager(),
    tokenManager: createTokenManager(),
    trackingManager: createTrackingManager(),
    tenantManager: createTenantManager(provider)
  }
}
