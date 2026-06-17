import { expect } from 'expect'
import {
  defaultTenantManager,
  defaultUserManager,
  defaultTokenManager,
  defaultDataBaseManager,
  defaultMfaManager,
  defaultTransferManager
} from '../../lib/defaults/managers.js'

// Null Object defaults: when a consumer does not inject a manager, the server
// must still boot. These report "not implemented" and throw on real operations.
export default () => {
  describe('default managers (Null Object)', () => {
    it('report isImplemented() === false', () => {
      expect(defaultTenantManager.isImplemented()).toBe(false)
      expect(defaultUserManager.isImplemented()).toBe(false)
      expect(defaultTokenManager.isImplemented()).toBe(false)
      expect(defaultDataBaseManager.isImplemented()).toBe(false)
      expect(defaultTransferManager.isImplemented()).toBe(false)
    })

    it('throw "Not implemented" on real user operations', () => {
      expect(() => defaultUserManager.createUser({})).toThrow(/Not implemented/)
      expect(() => defaultUserManager.retrieveUserByEmail('a@b.co')).toThrow(/Not implemented/)
      expect(() => defaultUserManager.changePassword('a@b.co', 'x', 'y')).toThrow(/Not implemented/)
    })

    it('throw "Not implemented" on token/tenant/db/mfa/transfer operations', () => {
      expect(() => defaultTokenManager.createToken({})).toThrow(/Not implemented/)
      expect(() => defaultTenantManager.createTenant({})).toThrow(/Not implemented/)
      expect(() => defaultDataBaseManager.synchronizeSchemas()).toThrow(/Not implemented/)
      expect(() => defaultMfaManager.verify('123456', 'secret')).toThrow(/Not implemented/)
      expect(() => defaultTransferManager.getPath()).toThrow(/Not implemented/)
    })
  })
}
