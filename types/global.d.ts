export {}

declare global {
  interface AuthenticatedUser {
    id: number
    name: string
    roles: string[]
  }

  interface Role {
    code: string
    name: string
    description: string
  }

  declare enum RoleKey {
    public = 'public',
    admin = 'admin',
    backoffice = 'backoffice'
  }

  declare type Roles = {
    [key in RoleKey]: Role
  }

  interface RouteConfig {
    title: string
    description: string
    enable: boolean
    deprecated: boolean
    version: string
    params?: any
    body?: any
    response?: any
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
      version?: string
      params?: any
      body?: any
      response?: any
    }
  }
}
