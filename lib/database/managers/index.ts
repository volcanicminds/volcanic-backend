import type { ControlHandle } from '../../../types/global.js'
import { createUserManager } from './user.js'
import { createTokenManager } from './token.js'
import { createTrackingManager } from './tracking.js'
import { createTenantManager, type TenantProvider } from './tenant.js'
import { createSystemUserManager } from './systemUser.js'
import { createImpersonationManager } from './impersonation.js'
import { createDestructionManager } from './destruction.js'
import { createSessionManager } from './session.js'
import { createAuthFlowManager } from './authFlow.js'
import { createExternalIdentityManager } from './externalIdentity.js'
import { createIdentityProviderManager } from './identityProvider.js'
import { createAccessLogManager } from './accessLog.js'

export {
  createUserManager,
  createTokenManager,
  createTrackingManager,
  createTenantManager,
  createSystemUserManager,
  createImpersonationManager,
  createDestructionManager,
  createSessionManager,
  createAuthFlowManager,
  createExternalIdentityManager,
  createIdentityProviderManager,
  createAccessLogManager
}
export { challengeMac } from './authFlow.js'
export { truncateIp, type AccessLogIpMode } from './accessLog.js'
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
    impersonationManager: createImpersonationManager(),
    // The permission-with-a-fuse that phase 1 of a destruction writes (T-6.3).
    destructionManager: createDestructionManager(),
    // The live sessions, in the container of their subject (T-11.5). Without this one there is
    // no renewal at all: a refresh nobody can consume is a credential that never expires.
    sessionManager: createSessionManager(),
    // Multi-step logins (T-12.12): without it only a flow that closes in one request can run (F46).
    authFlowManager: createAuthFlowManager(),
    externalIdentityManager: createExternalIdentityManager(),
    // Control plane only: a tenant's IdP secret never sits in the container it serves (F38).
    identityProviderManager: createIdentityProviderManager(),
    accessLogManager: createAccessLogManager()
  }
}
