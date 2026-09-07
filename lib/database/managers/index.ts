import type { ControlHandle } from '../../../types/global.js'
import { createUserManager } from './user.js'
import { createTokenManager } from './token.js'
import { createTrackingManager } from './tracking.js'
import { createTenantManager, type TenantProvider } from './tenant.js'
import { createSystemUserManager } from './systemUser.js'
import { createImpersonationManager } from './impersonation.js'

export {
  createUserManager,
  createTokenManager,
  createTrackingManager,
  createTenantManager,
  createSystemUserManager,
  createImpersonationManager
}
export { runtime, control } from './runtime.js'

//
// The set a consumer injects through `start(decorators)`.
//
export function buildManagers(provider: TenantProvider & { control(): ControlHandle | Promise<ControlHandle> }) {
  return {
    userManager: createUserManager(),
    tokenManager: createTokenManager(),
    trackingManager: createTrackingManager(),
    tenantManager: createTenantManager(provider),
    // Platform identities, in the control plane and nowhere else (T-4.1). Every method of
    // this one takes a ControlHandle, so the compiler refuses to read a system user from
    // inside a customer's container.
    systemUserManager: createSystemUserManager(),
    // The trail of a system user entering a customer's data, written in the control plane
    // before the token that allows it exists (T-4.2).
    impersonationManager: createImpersonationManager()
  }
}
