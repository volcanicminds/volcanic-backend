import { FastifyRequest, FastifyReply } from 'fastify'

export interface AuthenticatedUser {
  getId(): any
  username: string
  email: string
  roles: Role[]
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
}

export interface Route {
  method: string
  path: string
  handler: string
  roles: Role[]
  config?: RouteConfig
  middlewares: string[]
}

export interface ConfiguredRoute {
  enable: boolean
  method: any
  path: string
  handler: any
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
  }
}

export interface TrackChanges {
  enable: boolean
  method: string
  path: string
  entity: string
  changeEntity: string
  fields?: { includes: string[] } | null
  primaryKey?: string | null
}

export interface TrackChangesList {
  [option: string]: TrackChanges
}

export interface UserManagement {
  isImplemented(): boolean
  isValidUser(data: any): boolean
  createUser(data: any): any | null
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
  var roles: Roles
  var tracking: TrackChangesList
  var connection: any
  var entity: any
  var repository: any
}

export { global }
