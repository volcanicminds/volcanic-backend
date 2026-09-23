import {
  UserManagement,
  TokenManagement,
  TrackingManagement,
  MfaManagement,
  TransferManagement,
  TenantManagement,
  SystemUserManagement,
  ImpersonationManagement,
  DestructionManagement,
  SessionManagement,
  AuthFlowManagement,
  ExternalIdentityManagement,
  SettingManagement,
  IdentityProviderManagement,
  ChallengeDeliveryManagement,
  AccessLogManagement
} from '../../types/global.js'

//
// Null-object managers.
//
// A consumer injects the real ones through `start(decorators)`; without them the server
// still boots, and every data call fails loudly instead of silently doing nothing. The
// framework asks `isImplemented()` before taking any path that needs persistence.
//
// v4 listed all sixty methods by hand and each one threw the same sentence, so every change
// to a manager contract meant editing this file twice: once for the signature, once for the
// argument names nobody reads. One factory does the same job and cannot drift from the
// interfaces, because there is nothing here to keep in sync.
//
function notImplemented<T extends object>(manager: string, methods: readonly string[]): T {
  const known = new Set(methods)

  return new Proxy({} as T, {
    get(_target, property) {
      if (typeof property === 'symbol') return undefined
      if (property === 'isImplemented') return () => false
      // Only the contract's own methods answer. A proxy that responds to EVERY property is a
      // liar with consequences: Fastify probes a decorator for `getter`/`setter` before
      // registering it, so a catch-all answered "yes, I am an accessor" and the manager was
      // wired as something else entirely. Found by the isolation bench, which is what a bench
      // written before the code is for.
      if (!known.has(property as string)) return undefined

      return async () => {
        throw new Error(
          `${manager}.${String(property)} is not implemented: inject a real manager through start(decorators), ` +
            `or load the data layer from @volcanicminds/backend/db`
        )
      }
    },
    has: (_target, property) => property === 'isImplemented' || known.has(property as string)
  })
}

const USER_METHODS = [
  'isValidUser', 'isPasswordToBeChanged', 'createUser', 'updateUserById', 'deleteUser', 'resetExternalId',
  'retrieveUserById', 'retrieveUserByExternalId', 'retrieveUserByEmail', 'retrieveUserByUsername',
  'retrieveUserByResetPasswordToken', 'retrieveUserByConfirmationToken', 'retrieveUserByPassword',
  'changePassword', 'forgotPassword', 'resetPassword', 'userConfirmation',
  'blockUserById', 'unblockUserById', 'approveUserById', 'countQuery', 'findQuery',
  'saveMfaSecret', 'retrieveMfaSecret', 'enableMfa', 'disableMfa', 'forceDisableMfa'
] as const

const TOKEN_METHODS = [
  'isValidToken', 'createToken', 'updateTokenById', 'removeTokenById', 'resetExternalId',
  'retrieveTokenById', 'retrieveTokenByExternalId', 'blockTokenById', 'unblockTokenById',
  'countQuery', 'findQuery'
] as const

const TRACKING_METHODS = ['retrieveBy', 'addChange'] as const

const TENANT_METHODS = [
  'listTenants', 'getTenant', 'getTenantBySlug', 'createTenant', 'updateTenant',
  'suspendTenant', 'restoreTenant', 'softDeleteTenant',
  'openContainer', 'closeContainer', 'migrateContainer', 'exportContainer',
  'destroyContainer', 'inspectContainer'
] as const

const SYSTEM_USER_METHODS = [
  'createSystemUser', 'updateSystemUserById', 'deleteSystemUser', 'retrieveSystemUserById',
  'retrieveSystemUserByEmail', 'retrieveSystemUserByExternalId', 'retrieveSystemUserByPassword',
  'blockSystemUserById', 'unblockSystemUserById', 'countQuery', 'findQuery',
  'saveMfaSecret', 'retrieveMfaSecret', 'enableMfa', 'disableMfa', 'recordMfaCounter'
] as const

const IMPERSONATION_METHODS = ['openImpersonation', 'getImpersonation', 'revokeImpersonation', 'findQuery'] as const

const SESSION_METHODS = [
  'openSession', 'findBySecret', 'rotate', 'revokeSession', 'revokeAllOfSubject', 'listOfSubject', 'purgeExpired'
] as const

const DESTRUCTION_METHODS = ['openRequest', 'findLiveRequest', 'consumeRequest'] as const

const MFA_METHODS = ['generateSetup', 'verify'] as const

const AUTH_FLOW_METHODS = [
  'openFlow', 'findBySecret', 'findByState', 'advance', 'recordChallenge', 'consumeChallenge',
  'recordAttempt', 'bindExternal', 'recordExternalResult', 'recordExternalFailure', 'completeFlow', 'cancelFlow',
  'purgeExpired'
] as const

const EXTERNAL_IDENTITY_METHODS = ['findLink', 'createLink', 'listOfSubject', 'removeLink', 'touch'] as const

const IDENTITY_PROVIDER_METHODS = ['list', 'get', 'create', 'update', 'remove'] as const

const CHALLENGE_DELIVERY_METHODS = ['deliver'] as const

const SETTING_METHODS = ['get', 'set', 'remove'] as const

const ACCESS_LOG_METHODS = ['record', 'findQuery', 'countQuery', 'purgeBefore', 'purgeExpired'] as const

const TRANSFER_METHODS = [
  'getPath', 'getServer', 'onUploadCreate', 'onUploadFinish', 'onUploadTerminate', 'handle', 'isValid'
] as const

export const defaultUserManager = notImplemented<UserManagement>('userManager', USER_METHODS)
export const defaultTokenManager = notImplemented<TokenManagement>('tokenManager', TOKEN_METHODS)
export const defaultTrackingManager = notImplemented<TrackingManagement>('trackingManager', TRACKING_METHODS)
export const defaultTenantManager = notImplemented<TenantManagement>('tenantManager', TENANT_METHODS)
export const defaultSystemUserManager = notImplemented<SystemUserManagement>('systemUserManager', SYSTEM_USER_METHODS)
export const defaultImpersonationManager = notImplemented<ImpersonationManagement>(
  'impersonationManager',
  IMPERSONATION_METHODS
)
export const defaultDestructionManager = notImplemented<DestructionManagement>(
  'destructionManager',
  DESTRUCTION_METHODS
)
// Without this one there is no renewal at all (F28): a refresh that nobody can consume is a
// credential that never expires, which is worse than not having one.
export const defaultSessionManager = notImplemented<SessionManagement>('sessionManager', SESSION_METHODS)
export const defaultMfaManager = notImplemented<MfaManagement>('mfaManager', MFA_METHODS)
export const defaultTransferManager = notImplemented<TransferManagement>('transferManager', TRANSFER_METHODS)
// Without a flow store only the flows that close in one request can run (F46): a second step with
// no memory is a second step that counts no attempts.
export const defaultAuthFlowManager = notImplemented<AuthFlowManagement>('authFlowManager', AUTH_FLOW_METHODS)
export const defaultExternalIdentityManager = notImplemented<ExternalIdentityManagement>(
  'externalIdentityManager',
  EXTERNAL_IDENTITY_METHODS
)
export const defaultIdentityProviderManager = notImplemented<IdentityProviderManagement>(
  'identityProviderManager',
  IDENTITY_PROVIDER_METHODS
)
export const defaultChallengeDeliveryManager = notImplemented<ChallengeDeliveryManagement>(
  'challengeDeliveryManager',
  CHALLENGE_DELIVERY_METHODS
)
// Asked with isImplemented() before every write: without it an access is written to the process log only.
export const defaultAccessLogManager = notImplemented<AccessLogManagement>('accessLogManager', ACCESS_LOG_METHODS)
// Without a settings store every rule of F49 falls back to the deployment's own values: nothing
// a tenant or an operator chose at runtime can be read, and nothing can be written.
export const defaultSettingManager = notImplemented<SettingManagement>('settingManager', SETTING_METHODS)
