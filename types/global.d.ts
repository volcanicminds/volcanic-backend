import { FastifyRequest, FastifyReply } from 'fastify'

export interface AuthenticatedUser {
  id: number
  username: string
  email: string
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

export interface UserManagement {
  createUser(data: any): any | null
  resetExternalId(data: any): any | null
  updateUserById(id: string, user: any): any | null
  retrieveUserById(id: string): any | null
  retrieveUserByEmail(email: string): any | null
  retrieveUserByExternalId(externalId: string): any | null
  retrieveUserByPassword(email: string, password: string): any | null
  changePassword(email: string, password: string, oldPassword: string): any | null
  enableUserById(id: string): any | null
  disableUserById(id: string): any | null
  isValidUser(data: any): boolean
}

declare module 'fastify' {
  export interface FastifyRequest {
    user?: AuthenticatedUser
    startedAt?: Date
    data(): Data
    parameters(): Data
    roles(): string[]
    hasRole(role: Role): boolean
    payloadSize?: number
  }
  export interface FastifyReply {
    payloadSize?: number
  }
}

export interface FastifyRequest extends FastifyRequest {
  user?: AuthenticatedUser
  startedAt?: Date
  data(): Data
  parameters(): Data
  roles(): string[]
  hasRole(role: Role): boolean
  payloadSize?: number
}

export interface FastifyReply extends FastifyReply {
  payloadSize?: number
}

export interface global {}

declare global {
  var log: any
  var server: any
  var roles: Roles
  var connection: any
  var entity: any
  var repository: any
}

export { global }
