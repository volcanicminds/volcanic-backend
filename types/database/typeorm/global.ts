import { QueryRunner } from 'typeorm'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Database {
  default: any
  [option: string]: any
}

export interface UserManagement {
  isImplemented(): boolean
  isValidUser(data: any): Promise<boolean>
  createUser(data: any, runner?: QueryRunner): Promise<any | null>
  deleteUser(id: string, runner?: QueryRunner): Promise<any | null>
  resetExternalId(id: string, runner?: QueryRunner): Promise<any | null>
  updateUserById(id: string, user: any, runner?: QueryRunner): Promise<any | null>
  retrieveUserById(id: string, runner?: QueryRunner): Promise<any | null>
  retrieveUserByEmail(email: string, runner?: QueryRunner): Promise<any | null>
  retrieveUserByResetPasswordToken(code: string, runner?: QueryRunner): Promise<any | null>
  retrieveUserByConfirmationToken(code: string, runner?: QueryRunner): Promise<any | null>
  retrieveUserByUsername(username: string, runner?: QueryRunner): Promise<any | null>
  retrieveUserByExternalId(externalId: string, runner?: QueryRunner): Promise<any | null>
  retrieveUserByPassword(email: string, password: string, runner?: QueryRunner): Promise<any | null>
  changePassword(email: string, password: string, oldPassword: string, runner?: QueryRunner): Promise<any | null>
  forgotPassword(email: string, runner?: QueryRunner): Promise<any | null>
  resetPassword(user: any, password: string, runner?: QueryRunner): Promise<any | null>
  userConfirmation(user: any, runner?: QueryRunner): Promise<any | null>
  blockUserById(id: string, reason: string, runner?: QueryRunner): Promise<any | null>
  unblockUserById(id: string, runner?: QueryRunner): Promise<any | null>
  countQuery(data: any, runner?: QueryRunner): Promise<any | null>
  findQuery(data: any, runner?: QueryRunner): Promise<any | null>
  disableUserById(id: string, runner?: QueryRunner): Promise<any | null>
  isPasswordToBeChanged(user: any): boolean

  // MFA Persistence Methods
  saveMfaSecret(userId: string, secret: string, runner?: QueryRunner): Promise<boolean>
  retrieveMfaSecret(userId: string, runner?: QueryRunner): Promise<string | null>
  enableMfa(userId: string, runner?: QueryRunner): Promise<boolean>
  disableMfa(userId: string, runner?: QueryRunner): Promise<boolean>

  // Emergency Reset
  forceDisableMfaForAdmin(email: string, runner?: QueryRunner): Promise<boolean>
}

export interface TokenManagement {
  isImplemented(): boolean
  isValidToken(data: any): Promise<boolean>
  createToken(data: any, runner?: QueryRunner): Promise<any | null>
  resetExternalId(id: string, runner?: QueryRunner): Promise<any | null>
  updateTokenById(id: string, token: any, runner?: QueryRunner): Promise<any | null>
  retrieveTokenById(id: string, runner?: QueryRunner): Promise<any | null>
  retrieveTokenByExternalId(externalId: string, runner?: QueryRunner): Promise<any | null>
  blockTokenById(id: string, reason: string, runner?: QueryRunner): Promise<any | null>
  unblockTokenById(id: string, runner?: QueryRunner): Promise<any | null>
  countQuery(data: any, runner?: QueryRunner): Promise<any | null>
  findQuery(data: any, runner?: QueryRunner): Promise<any | null>
  removeTokenById(id: string, runner?: QueryRunner): Promise<any | null>
}

export interface DataBaseManagement {
  isImplemented(): boolean
  synchronizeSchemas(runner?: QueryRunner): Promise<boolean>
  retrieveBy(entityName: string, entityId: string, runner?: QueryRunner): Promise<any | null>
  addChange(
    entityName: string,
    entityId: string,
    status: string,
    userId: string,
    contents: any,
    changeEntity?: string,
    runner?: QueryRunner
  ): Promise<any | null>
}
