/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-object-type */
import { FastifyRequest, FastifyReply } from 'fastify'

export interface AuthenticatedUser {
  getId(): any
  username: string
  email: string
  roles: Role[]
  externalId: string // Added missing property for Auth Controller
  mfaEnabled?: boolean
}

export enum MfaPolicy {
  OPTIONAL = 'OPTIONAL',
  MANDATORY = 'MANDATORY',
  ONE_WAY = 'ONE_WAY'
}

export interface AuthenticatedToken {
  getId(): any
  name: string
  roles: Role[]
}

export interface Role {
  code: string
  name: string
  description: string
}

export interface Roles {
  [option: string]: Role
}

export interface Data {
  [option: string]: any
}

export interface RouteConfig {
  title: string
  description: string
  enable: boolean
  deprecated: boolean
  tags?: string[]
  version: string
  security?: any
  params?: any
  query?: any
  body?: any
  response?: any
  consumes?: any
  rawBody?: boolean
}

export interface Route {
  method: string
  path: string
  handler: string
  roles: Role[]
  middlewares: string[]
  config?: RouteConfig
  rateLimit?: any
}

export interface GeneralConfig {
  name: string
  enable: boolean
  options: {
    allow_multiple_admin: boolean
    reset_external_id_on_login: boolean
    scheduler: boolean
    embedded_auth: boolean
    // MFA Configs
    mfa_policy?: string | MfaPolicy
  }
}

export interface JobSchedule {
  active: boolean // boolean (required)
  type?: string // cron|interval, default: interval
  async?: boolean // boolean, default: true
  preventOverrun?: boolean // boolean, default: true

  cron?: {
    expression?: string // required if type = 'cron', use cron syntax (if not specified cron will be disabled)
    timezone?: string // optional, like "Europe/Rome" (to test)
  }

  interval?: {
    days?: number // number, default 0
    hours?: number // number, default 0
    minutes?: number // number, default 0
    seconds?: number // number, default 0
    milliseconds?: number // number, default 0
    runImmediately?: boolean // boolean, default: false
  }
}

export interface ConfiguredRoute {
  enable: boolean
  method: any
  path: string
  handler: any
  rawBody: boolean
  rateLimit: any
  file: string
  func: any
  base: string
  middlewares: string[]
  roles: Role[]
  doc: {
    summary?: string
    description?: string
    deprecated?: boolean
    tags?: string[]
    version?: string
    security?: any
    params?: any
    querystring?: any
    body?: any
    response?: any
    consumes?: any
  }
}

export interface TrackChanges {
  enable: boolean
  method: string
  path: string
  entity: string
  changeEntity: string
  fields?: {
    includes?: string[] | null
    excludes?: string[] | null
  } | null
  primaryKey?: string | null
}

export interface TrackChangesList {
  [option: string]: TrackChanges
}

export interface UserManagement {
  isImplemented(): boolean
  isValidUser(data: any): boolean
  createUser(data: any): any | null
  deleteUser(data: any): any | null
  resetExternalId(data: any): any | null
  updateUserById(id: string, user: any): any | null
  retrieveUserById(id: string): any | null
  retrieveUserByEmail(email: string): any | null
  retrieveUserByResetPasswordToken(code: string): any | null
  retrieveUserByConfirmationToken(code: string): any | null
  retrieveUserByUsername(username: string): any | null
  retrieveUserByExternalId(externalId: string): any | null
  retrieveUserByPassword(email: string, password: string): any | null
  changePassword(email: string, password: string, oldPassword: string): any | null
  forgotPassword(email: string): any | null
  resetPassword(user: any, password: string): any | null
  userConfirmation(user: any)
  blockUserById(id: string, reason: string): any | null
  unblockUserById(id: string): any | null
  countQuery(data: any): any | null
  findQuery(data: any): any | null
  disableUserById(id: string): any | null

  // MFA Persistence Methods
  saveMfaSecret(userId: string, secret: string): Promise<boolean>
  retrieveMfaSecret(userId: string): Promise<string | null>
  enableMfa(userId: string): Promise<boolean>
  disableMfa(userId: string): Promise<boolean>

  // Emergency Reset
  forceDisableMfaForAdmin(email: string): Promise<boolean>
}

export interface TokenManagement {
  isImplemented(): boolean
  isValidToken(data: any): boolean
  createToken(data: any): any | null
  resetExternalId(id: string): any | null
  updateTokenById(id: string, token: any): any | null
  retrieveTokenById(id: string): any | null
  retrieveTokenByExternalId(id: string): any | null
  blockTokenById(id: string, reason: string): any | null
  unblockTokenById(id: string): any | null
  countQuery(data: any): any | null
  findQuery(data: any): any | null
  removeTokenById(id: string): any | null
}

export interface DataBaseManagement {
  isImplemented(): boolean
  synchronizeSchemas(): any | null
  retrieveBy(entityName, entityId): any | null
  addChange(entityName, entityId, status, userId, contents, changeEntity): any | null
}

// Interface injected by the main application (e.g. Gerico Backend)
export interface MfaManagement {
  generateSetup(appName: string, email: string): Promise<{ secret: string; uri: string; qrCode: string }>
  verify(token: string, secret: string): boolean
}

declare module 'fastify' {
  export interface FastifyRequest {
    user?: AuthenticatedUser
    token?: AuthenticatedToken
    startedAt?: Date
    data(): Data
    parameters(): Data
    roles(): string[]
    hasRole(role: Role): boolean
    payloadSize?: number
    trackingData?: any
  }
  export interface FastifyReply {
    payloadSize?: number
  }
}

export interface FastifyRequest extends FastifyRequest {
  user?: AuthenticatedUser
  token?: AuthenticatedToken
  startedAt?: Date
  data(): Data
  parameters(): Data
  roles(): string[]
  hasRole(role: Role): boolean
  payloadSize?: number
  trackingData?: any
}

export interface FastifyReply extends FastifyReply {
  payloadSize?: number
}

export interface global {}

declare global {
  var log: any
  var server: any
  var config: GeneralConfig
  var roles: Roles
  var tracking: TrackChangesList
  var trackingConfig: Data
  var connection: any
  var entity: any
  var repository: any
}

export { global }
