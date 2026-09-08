import { isTenancyEnabled } from '../../util/tenancy.js'

//
// The control scope's own surface (T-4.1, docs/API_V5.md §5).
//
// Every route here declares `scope: 'control'`, which means two things at once: the request
// never opens a tenant container, and it authenticates against the PLATFORM's identities,
// not a customer's. The two are the same decision, so they are one declaration.
//
// Enabled only where the split is real. A deployment without a `tenants` block has one
// container and one identity space, so there is no platform to administer separately and
// these routes would be a login nobody can pass: the framework does not ship a door that
// never opens.
//
// There is deliberately NO registration route: system users are provisioned, never
// self-registered (docs/SCHEMA_V5.md §3.2).
//
const authRateLimit = {
  max: Math.floor(Number(process.env.AUTH_RATELIMIT_MAX) || 10),
  timeWindow: Math.floor(Number(process.env.AUTH_RATELIMIT_WINDOW) || 60000)
}

export default {
  config: {
    title: 'Platform administration',
    description: 'Authentication and identities of the control scope',
    controller: 'controller',
    tags: ['system'],
    enable: isTenancyEnabled(),
    scope: 'control'
  },
  routes: [
    {
      method: 'POST',
      path: '/auth/login',
      roles: ['system:public'],
      handler: 'systemAuth.login',
      rateLimit: authRateLimit,
      config: {
        title: 'Log a platform administrator in',
        description: 'Returns a token carrying the control scope and no tenant',
        body: { $ref: 'authLoginBodySchema#' }
      }
    },
    {
      method: 'POST',
      path: '/auth/logout',
      roles: ['system:public'],
      handler: 'systemAuth.logout',
      config: { title: 'Log out', description: 'Clears the cookie in COOKIE mode' }
    },
    {
      method: 'POST',
      path: '/auth/refresh-token',
      roles: ['system:public'],
      handler: 'systemAuth.renew',
      rateLimit: authRateLimit,
      config: { title: 'Renew a control token', description: 'Exchanges a valid control refresh token' }
    },
    {
      method: 'GET',
      path: '/users',
      requireCapability: 'system-users',
      handler: 'systemUser.find',
      middlewares: ['global.isAuthenticated'],
      config: { title: 'Find platform administrators', description: 'Magic Query over the control plane' }
    },
    {
      method: 'GET',
      path: '/users/count',
      requireCapability: 'system-users',
      handler: 'systemUser.count',
      middlewares: ['global.isAuthenticated'],
      config: { title: 'Count platform administrators', description: 'Count' }
    },
    {
      method: 'GET',
      path: '/users/:id',
      requireCapability: 'system-users',
      handler: 'systemUser.findOne',
      middlewares: ['global.isAuthenticated'],
      config: { title: 'Read one platform administrator', description: 'By id' }
    },
    {
      method: 'POST',
      path: '/users',
      requireCapability: 'system-users',
      handler: 'systemUser.create',
      middlewares: ['global.isAuthenticated'],
      config: { title: 'Provision a platform administrator', description: 'There is no self-registration' }
    },
    {
      method: 'PUT',
      path: '/users/:id',
      requireCapability: 'system-users',
      handler: 'systemUser.update',
      middlewares: ['global.isAuthenticated'],
      config: { title: 'Update a platform administrator', description: 'Roles and labels; never the password' }
    },
    {
      method: 'DELETE',
      path: '/users/:id',
      requireCapability: 'system-users',
      handler: 'systemUser.remove',
      middlewares: ['global.isAuthenticated'],
      config: { title: 'Delete a platform administrator', description: 'Soft delete' }
    },
    {
      method: 'POST',
      path: '/users/:id/block',
      requireCapability: 'system-users',
      handler: 'systemUser.block',
      middlewares: ['global.isAuthenticated'],
      config: { title: 'Block a platform administrator', description: 'With a stated reason' }
    },
    {
      method: 'POST',
      path: '/users/:id/unblock',
      requireCapability: 'system-users',
      handler: 'systemUser.unblock',
      middlewares: ['global.isAuthenticated'],
      config: { title: 'Unblock a platform administrator', description: 'Restores access' }
    }
  ]
}
