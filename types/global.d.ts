import { FastifyRequest, FastifyReply } from 'fastify'

export interface AuthenticatedUser {
  id: number
  name: string
  roles: string[]
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
  params?: Data
  body?: Data
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
    params?: any
    querystring?: any
    body?: any
    response?: any
  }
}

declare module 'fastify' {
  import { FastifyRequest } from 'fastify'
  export interface FastifyRequest {
    user?: AuthenticatedUser
    data(): Data
  }
}

export interface FastifyRequest extends FastifyRequest {
  user?: AuthenticatedUser
  data(): Data
}

export interface FastifyReply extends FastifyReply {}

export interface global {}

declare global {
  var log: any
  var roles: Roles
}

export { global }
