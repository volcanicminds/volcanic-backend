import {
  UserManagement,
  TokenManagement,
  TrackingManagement,
  MfaManagement,
  TransferManagement,
  TenantManagement,
  SystemUserManagement
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
function notImplemented<T extends object>(manager: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      // `then` must stay undefined: an object that answers to `then` is treated as a
      // promise, and awaiting a manager by accident would hang or resolve to nonsense.
      if (typeof property === 'symbol' || property === 'then') return undefined
      if (property === 'isImplemented') return () => false

      return async () => {
        throw new Error(
          `${manager}.${String(property)} is not implemented: inject a real manager through start(decorators), ` +
            `or load the data layer from @volcanicminds/backend/db`
        )
      }
    }
  })
}

export const defaultUserManager = notImplemented<UserManagement>('userManager')
export const defaultTokenManager = notImplemented<TokenManagement>('tokenManager')
export const defaultTrackingManager = notImplemented<TrackingManagement>('trackingManager')
export const defaultTenantManager = notImplemented<TenantManagement>('tenantManager')
export const defaultSystemUserManager = notImplemented<SystemUserManagement>('systemUserManager')
export const defaultMfaManager = notImplemented<MfaManagement>('mfaManager')
export const defaultTransferManager = notImplemented<TransferManagement>('transferManager')
