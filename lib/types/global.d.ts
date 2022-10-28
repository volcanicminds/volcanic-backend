export {}

declare global {
  interface AuthenticatedUser {
    id: number
    name: string
    roles: string[]
    scope: string[]
  }

  interface Role {
    code: string
    name: string
    description: string
    inherits: string[]
  }

  interface RouteConfig {
    title: string
    description: string
    enable: boolean
    deprecated: boolean
    version: string
  }

  interface Route {
    method: string
    path: string
    handler: string
    roles: Role[]
    config?: RouteConfig
    middlewares: string[]
  }

  interface ConfiguredRoute {
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
}
