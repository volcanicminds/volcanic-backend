export interface global {}
declare global {
  var log: any
}

declare interface Role {
  code: string
  name: string
  description: string
  inherits: string[]
}

declare enum RoleKey {
  public = 'public',
  backoffice = 'backoffice'
}

declare type Roles = {
  [key in RoleKey]: Role
}

declare interface RouteConfig {
  title: string
  description: string
  enable: boolean
  deprecated: boolean
  version: string
}

declare interface Route {
  method: string
  path: string
  handler: string
  roles: Role[]
  config?: RouteConfig
  middlewares: string[]
}

declare interface ConfiguredRoute {
  title: string
  description: string
  method: any
  path: string
  handler: any

  file: string
  func: any
  base: string

  middlewares: string[]
  roles: Role[]
  enable: boolean
  deprecated: boolean
  version: string
}

declare interface RouteInfo {
  method: string
  path: string
  handler: string
  roles: Role[]
  config: {
    title: string
    description: string
    enable: boolean
    deprecated: boolean
    version: boolean
  }
}

declare interface Log {
  debug(...elems: any[]): void
  fatal(...elems: any[]): void
  error(...elems: any[]): void
  warn(...elems: any[]): void
  info(...elems: any[]): void
  trace(...elems: any[]): void
  e?: boolean
  d?: boolean
  t?: boolean
  w?: boolean
  i?: boolean
}

declare interface GitConfiguration {
  remote: string
  branch: string
  repository: any //cannot import nodegit type here unfortunately
}

declare interface CMS {
  contentsPath?: string
  contentsRoot?: string
  gitConfig?: GitConfiguration
}
