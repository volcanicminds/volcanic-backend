import {
  UserManagement,
  TokenManagement,
  DataBaseManagement,
  MfaManagement,
  TransferManagement,
  TenantManagement,
  TransferCallback
} from '../../types/global.js'
import { FastifyReply, FastifyRequest } from 'fastify'

// Default implementations that throw errors or return not implemented
export const defaultTenantManager: TenantManagement = {
  isImplemented() {
    return false
  },
  resolveTenant(_req) {
    throw new Error('Not implemented')
  },
  switchContext(_tenant, _db?) {
    throw new Error('Not implemented')
  },
  createTenant(_data) {
    throw new Error('Not implemented')
  },
  deleteTenant(_id) {
    throw new Error('Not implemented')
  },
  listTenants() {
    throw new Error('Not implemented')
  },
  getTenant(_id) {
    throw new Error('Not implemented')
  },
  updateTenant(_id, _data) {
    throw new Error('Not implemented')
  },
  restoreTenant(_id) {
    throw new Error('Not implemented')
  }
}

export const defaultUserManager: UserManagement = {
  isImplemented() {
    return false
  },
  isValidUser(_data: unknown) {
    throw new Error('Not implemented.')
  },
  createUser(_data: unknown) {
    throw new Error('Not implemented.')
  },
  deleteUser(_data: unknown) {
    throw new Error('Not implemented.')
  },
  resetExternalId(_data: unknown) {
    throw new Error('Not implemented.')
  },
  updateUserById(_id: string, _user: unknown) {
    throw new Error('Not implemented.')
  },
  retrieveUserById(_id: string) {
    throw new Error('Not implemented.')
  },
  retrieveUserByEmail(_email: string) {
    throw new Error('Not implemented.')
  },
  retrieveUserByConfirmationToken(_code: string) {
    throw new Error('Not implemented.')
  },
  retrieveUserByResetPasswordToken(_code: string) {
    throw new Error('Not implemented.')
  },
  retrieveUserByUsername(_username: string) {
    throw new Error('Not implemented.')
  },
  retrieveUserByExternalId(_externalId: string) {
    throw new Error('Not implemented.')
  },
  retrieveUserByPassword(_email: string, _password: string) {
    throw new Error('Not implemented.')
  },
  changePassword(_email: string, _password: string, _oldPassword: string) {
    throw new Error('Not implemented.')
  },
  forgotPassword(_email: string) {
    throw new Error('Not implemented.')
  },
  userConfirmation(_user: unknown) {
    throw new Error('Not implemented.')
  },
  resetPassword(_user: unknown, _password: string) {
    throw new Error('Not implemented.')
  },
  blockUserById(_id: string, _reason: string) {
    throw new Error('Not implemented.')
  },
  unblockUserById(_data: unknown) {
    throw new Error('Not implemented.')
  },
  countQuery(_data: unknown) {
    throw new Error('Not implemented.')
  },
  findQuery(_data: unknown) {
    throw new Error('Not implemented.')
  },
  disableUserById(_id: string) {
    throw new Error('Not implemented.')
  },
  saveMfaSecret(_userId: string, _secret: string) {
    throw new Error('Not implemented.')
  },
  retrieveMfaSecret(_userId: string) {
    throw new Error('Not implemented.')
  },
  enableMfa(_userId: string) {
    throw new Error('Not implemented.')
  },
  disableMfa(_userId: string) {
    throw new Error('Not implemented.')
  },
  forceDisableMfaForAdmin(_email: string) {
    throw new Error('Not implemented.')
  }
}

export const defaultTokenManager: TokenManagement = {
  isImplemented() {
    return false
  },
  isValidToken(_data: unknown) {
    throw new Error('Not implemented.')
  },
  createToken(_data: unknown) {
    throw new Error('Not implemented.')
  },
  resetExternalId(_id: string) {
    throw new Error('Not implemented.')
  },
  updateTokenById(_id: string, _token: unknown) {
    throw new Error('Not implemented.')
  },
  retrieveTokenById(_id: string) {
    throw new Error('Not implemented.')
  },
  retrieveTokenByExternalId(_id: string) {
    throw new Error('Not implemented.')
  },
  blockTokenById(_id: string, _reason: string) {
    throw new Error('Not implemented.')
  },
  unblockTokenById(_id: string) {
    throw new Error('Not implemented.')
  },
  countQuery(_data: unknown) {
    throw new Error('Not implemented.')
  },
  findQuery(_data: unknown) {
    throw new Error('Not implemented.')
  },
  removeTokenById(_id: string) {
    throw new Error('Not implemented.')
  }
}

export const defaultDataBaseManager: DataBaseManagement = {
  isImplemented() {
    return false
  },
  synchronizeSchemas() {
    throw new Error('Not implemented.')
  },
  retrieveBy(_entityName, _entityId) {
    throw new Error('Not implemented.')
  },
  addChange(_entityName, _entityId, _status, _userId, _contents, _changeEntity) {
    throw new Error('Not implemented.')
  }
}

export const defaultMfaManager: MfaManagement = {
  generateSetup(_appName: string, _email: string) {
    throw new Error('Not implemented.')
  },
  verify(_token: string, _secret: string) {
    throw new Error('Not implemented.')
  }
}

export const defaultTransferManager: TransferManagement = {
  isImplemented() {
    return false
  },
  getPath() {
    throw new Error('Not implemented.')
  },
  getServer() {
    throw new Error('Not implemented.')
  },
  onUploadCreate(_callback: TransferCallback) {
    throw new Error('Not implemented.')
  },
  onUploadFinish(_callback: TransferCallback) {
    throw new Error('Not implemented.')
  },
  onUploadTerminate(_callback: TransferCallback) {
    throw new Error('Not implemented.')
  },
  handle(_req: FastifyRequest, _res: FastifyReply) {
    throw new Error('Not implemented.')
  },
  isValid(_req: FastifyRequest) {
    throw new Error('Not implemented.')
  }
}
