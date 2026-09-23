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
const perMinute = (max: number) => ({ max, timeWindow: 60000 })

//
// The operators are a resource, and they live two segments deep (T-10.20).
//
// This file serves the platform login, the console manifest and this CRUD, so the hint cannot be
// declared once at file level: it is named by the routes that are the resource, and by no other.
// Without it the manifest groups everything under `system`, where six methods on one table look
// like six unrelated capabilities and the console has no screen to manage who administers the
// platform.
//
const operators = {
  group: 'system',
  resource: { prefix: 'system/users', name: 'systemUser', titleField: 'email' }
}

// The platform's access log, its own resource for the same reason (T-12.32).
const platformAccessLog = {
  group: 'system',
  resource: { prefix: 'system/access-log', name: 'systemAccessLog', titleField: 'event', subtitleField: 'occurredAt' }
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
    // The login flow of the platform (T-12.16): the twins of `/auth/flow/*`, served by the same
    // engine. The return route needs no tenant flag: the control plane has one container.
    {
      method: 'GET',
      path: '/auth/flow/options',
      roles: ['public'],
      handler: 'systemFlow.options',
      rateLimit: perMinute(60),
      config: {
        title: 'Platform login methods',
        description: 'The identifiers of the control plane',
        response: { 200: { $ref: 'authFlowOptionsResponseSchema#' } }
      }
    },
    {
      method: 'POST',
      path: '/auth/flow/start',
      roles: ['public'],
      handler: 'systemFlow.start',
      rateLimit: authRateLimit,
      config: {
        title: 'Start a platform login',
        description: '200 with a control session when nothing else is owed, 202 with the next stage otherwise',
        body: { $ref: 'authFlowStartBodySchema#' },
        response: { 202: { $ref: 'authFlowPartialResponseSchema#' } }
      }
    },
    {
      method: 'POST',
      path: '/auth/flow/step',
      roles: ['public'],
      handler: 'systemFlow.step',
      rateLimit: perMinute(10),
      config: {
        title: 'Answer the current stage of a platform login',
        description: 'Verifies `method` for the flow of the credential, or starts its enrolment with `action: enrol`',
        body: { $ref: 'authFlowStepBodySchema#' },
        response: { 202: { $ref: 'authFlowPartialResponseSchema#' } }
      }
    },
    {
      method: 'POST',
      path: '/auth/flow/challenge',
      roles: ['public'],
      handler: 'systemFlow.challenge',
      rateLimit: perMinute(5),
      config: {
        title: 'Send a platform code again',
        description: 'Sends the code of a method of the current stage',
        body: { $ref: 'authFlowChallengeBodySchema#' },
        response: { 202: { $ref: 'authFlowPartialResponseSchema#' } }
      }
    },
    {
      method: 'POST',
      path: '/auth/flow/cancel',
      roles: ['public'],
      handler: 'systemFlow.cancel',
      config: {
        title: 'Abandon a platform login',
        description: 'Ends the flow of the credential, if there is one',
        body: { $ref: 'authFlowCancelBodySchema#' },
        response: { 200: { $ref: 'defaultResponse#' } }
      }
    },
    {
      method: 'GET',
      path: '/auth/flow/return/:method',
      roles: ['public'],
      handler: 'systemFlow.returnFrom',
      rateLimit: perMinute(20),
      config: {
        title: 'Return from a provider to the platform',
        description: 'Records the answer of an external provider in the flow its `state` names, then redirects'
      }
    },
    {
      method: 'POST',
      path: '/auth/logout',
      roles: ['public'],
      handler: 'systemAuth.logout',
      config: { title: 'Log out', description: 'Clears the cookie in COOKIE mode' }
    },
    {
      method: 'POST',
      path: '/auth/refresh-token',
      roles: ['public'],
      handler: 'systemAuth.renew',
      rateLimit: authRateLimit,
      config: { title: 'Renew a control token', description: 'Exchanges a valid control refresh token' }
    },
    {
      method: 'GET',
      path: '/auth/me',
      // Any platform identity, whatever its roles (T-10.14): `public` opens the role gate and
      // `isAuthenticated` closes it again to anonymous callers. `roles: []` would have meant the
      // superuser alone on a control route, and a console needs this answer for every operator.
      roles: ['public'],
      handler: 'systemAuth.me',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'The platform administrator behind the session',
        description: 'Profile and roles, which a console reads to decide what to draw'
      }
    },
    {
      method: 'GET',
      path: '/auth/sessions',
      // Every operator reads its own sessions, whatever its roles: `public` opens the role gate
      // and `isAuthenticated` closes it to anonymous callers, as for `/auth/me`.
      roles: ['public'],
      handler: 'systemAuth.listSessions',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'The platform sessions of the caller',
        description: 'Where this operator is logged in, with the current session marked',
        response: {
          200: { $ref: 'authSessionsResponseSchema#' }
        }
      }
    },
    {
      method: 'DELETE',
      path: '/auth/sessions/:id',
      roles: ['public'],
      handler: 'systemAuth.revokeSession',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Close one platform session',
        description: 'Closes a session of the caller by its id; a session of somebody else answers 404',
        params: { $ref: 'onlyIdSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'GET',
      path: '/access-log',
      requireCapability: 'access-log',
      handler: 'systemAccessLog.find',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Find platform access log entries',
        description: 'Magic Query over the fields of the access log, control plane only',
        manifest: platformAccessLog,
        query: { $ref: 'getQueryParamsSchema' },
        response: { 200: { type: 'array', items: { $ref: 'accessLogSchema#' } } }
      }
    },
    {
      method: 'GET',
      path: '/access-log/count',
      requireCapability: 'access-log',
      handler: 'systemAccessLog.count',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Count platform access log entries',
        description: 'Count',
        manifest: platformAccessLog,
        query: { $ref: 'getQueryParamsSchema' },
        response: { 200: { type: 'number' } }
      }
    },
    // Who may create an account in a tenant, for every tenant (F49). Reading it is oversight,
    // writing it changes how every customer's users get in.
    {
      method: 'GET',
      path: '/account-creation',
      requireCapability: 'tenants:read',
      handler: 'systemAccountCreation.get',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Read the account creation rule of every tenant',
        description: 'The modes a tenant may choose from and the one that applies until it chooses',
        response: { 200: { $ref: 'accountCreationRuleSchema#' } }
      }
    },
    {
      method: 'PUT',
      path: '/account-creation',
      requireCapability: 'tenants',
      handler: 'systemAccountCreation.update',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Set the account creation rule of every tenant',
        description: 'Replaces the deployment rule; a tenant with its own set in `config.account_creation` keeps it',
        body: { $ref: 'accountCreationRuleBodySchema#' },
        response: { 200: { $ref: 'accountCreationRuleSchema#' } }
      }
    },
    {
      method: 'DELETE',
      path: '/account-creation',
      requireCapability: 'tenants',
      handler: 'systemAccountCreation.reset',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Go back to the deployment rule',
        description: 'Removes the rule stored by the platform',
        response: { 200: { $ref: 'accountCreationRuleSchema#' } }
      }
    },
    {
      method: 'GET',
      path: '/manifest',
      requireCapability: 'manifest',
      handler: 'systemManifest.get',
      middlewares: ['global.isAuthenticated'],
      config: {
        // Two switches, as for `/admin/manifest`: the manifest is opt-in, and this file only
        // exists where there are tenants.
        enable: isTenancyEnabled() && Boolean(global.config?.options?.manifest?.enabled),
        title: 'Platform console manifest',
        description: 'Manifest v2 of the control plane: its routes, its roles, its auth endpoints'
      }
    },
    {
      method: 'POST',
      path: '/auth/mfa/setup',
      // Every platform identity enrols its own second factor: `public` opens the role gate and
      // `isAuthenticated` closes it to anonymous callers, as for `/auth/me`. With `roles: []` a
      // control route means the superuser alone, so an operator could not turn MFA on at all.
      roles: ['public'],
      handler: 'systemAuth.mfaSetup',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Start MFA enrolment',
        description: 'Returns the secret and its QR code. Enrolment is required to destroy a container'
      }
    },
    {
      method: 'POST',
      path: '/auth/mfa/enable',
      roles: ['public'],
      handler: 'systemAuth.mfaEnable',
      middlewares: ['global.isAuthenticated'],
      // The code is six digits, as on the tenant plane: throttled against online guessing.
      rateLimit: { max: 10, timeWindow: 60000 },
      config: { title: 'Finish MFA enrolment', description: 'Body: the code from the authenticator' }
    },
    {
      method: 'GET',
      path: '/users',
      requireCapability: 'system-users',
      handler: 'systemUser.find',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Find platform administrators',
        description: 'Magic Query over the control plane',
        manifest: operators,
        query: { $ref: 'getQueryParamsSchema' },
        response: { 200: { type: 'array', items: { $ref: 'systemUserSchema#' } } }
      }
    },
    {
      method: 'GET',
      path: '/users/count',
      requireCapability: 'system-users',
      handler: 'systemUser.count',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Count platform administrators',
        description: 'Count',
        manifest: operators,
        query: { $ref: 'getQueryParamsSchema' }
      }
    },
    {
      method: 'GET',
      path: '/users/:id',
      requireCapability: 'system-users',
      handler: 'systemUser.findOne',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Read one platform administrator',
        description: 'By id',
        manifest: operators,
        response: { 200: { $ref: 'systemUserSchema#' } }
      }
    },
    {
      method: 'POST',
      path: '/users',
      requireCapability: 'system-users',
      handler: 'systemUser.create',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Provision a platform administrator',
        description: 'There is no self-registration',
        manifest: operators,
        body: { $ref: 'systemUserBodySchema#' },
        response: { 201: { $ref: 'systemUserSchema#' } }
      }
    },
    {
      method: 'PUT',
      path: '/users/:id',
      requireCapability: 'system-users',
      handler: 'systemUser.update',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Update a platform administrator',
        description: 'Roles and labels; never the password',
        manifest: operators,
        body: { $ref: 'systemUserBodySchema#' },
        response: { 200: { $ref: 'systemUserSchema#' } }
      }
    },
    {
      method: 'DELETE',
      path: '/users/:id',
      requireCapability: 'system-users',
      handler: 'systemUser.remove',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Delete a platform administrator',
        description: 'Soft delete',
        manifest: operators,
        response: { 200: { $ref: 'defaultResponse#' } }
      }
    },
    {
      method: 'POST',
      path: '/users/:id/block',
      requireCapability: 'system-users',
      handler: 'systemUser.block',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Block a platform administrator',
        description: 'With a stated reason',
        manifest: { ...operators, input: { fields: { reason: { widget: 'textarea' } } } },
        body: { $ref: 'blockBodySchema#' },
        response: { 200: { $ref: 'systemUserSchema#' } }
      }
    },
    {
      method: 'POST',
      path: '/users/:id/unblock',
      requireCapability: 'system-users',
      handler: 'systemUser.unblock',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Unblock a platform administrator',
        description: 'Restores access',
        manifest: operators,
        response: { 200: { $ref: 'systemUserSchema#' } }
      }
    },
    {
      method: 'POST',
      path: '/users/:id/mfa/reset',
      requireCapability: 'system-users',
      handler: 'systemUser.resetMfa',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Reset the second factor of a platform administrator',
        description: 'The way back for an operator who lost the device. Never self-service (T-10.19)',
        manifest: operators,
        response: { 200: { $ref: 'defaultResponse#' } }
      }
    }
  ]
}
