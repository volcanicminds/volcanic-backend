import {
  UserManagement,
  TokenManagement,
  TrackingManagement,
  MfaManagement,
  TransferManagement,
  TenantManagement,
  SystemUserManagement,
  ImpersonationManagement
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
  'isValidUser', 'createUser', 'updateUserById', 'deleteUser', 'resetExternalId',
  'retrieveUserById', 'retrieveUserByExternalId', 'retrieveUserByEmail', 'retrieveUserByUsername',
  'retrieveUserByResetPasswordToken', 'retrieveUserByConfirmationToken', 'retrieveUserByPassword',
  'changePassword', 'forgotPassword', 'resetPassword', 'userConfirmation',
  'blockUserById', 'unblockUserById', 'countQuery', 'findQuery',
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
  'blockSystemUserById', 'unblockSystemUserById', 'countQuery', 'findQuery'
] as const

const IMPERSONATION_METHODS = ['openImpersonation', 'getImpersonation', 'revokeImpersonation', 'findQuery'] as const

const MFA_METHODS = ['generateSetup', 'verify'] as const

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
export const defaultMfaManager = notImplemented<MfaManagement>('mfaManager', MFA_METHODS)
export const defaultTransferManager = notImplemented<TransferManagement>('transferManager', TRANSFER_METHODS)
