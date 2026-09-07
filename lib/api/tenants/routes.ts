// The tenant registry only exists where there are tenants: with no `tenants` block the
// whole group stays unmounted (docs/CONFIGURATION_V5.md §1).
const isEnabled = !!global.config?.options?.tenants?.strategy

export default {
  config: {
    title: 'Tenant Management',
    description: 'Administration of tenants (global scope)',
    controller: 'controller',
    enable: isEnabled,
    scope: 'control', // acts on the platform, never inside a customer's container
    tags: ['tenants'],
    manifest: {
      group: 'system',
      resource: { name: 'tenant', titleField: 'name' }
    }
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      requireCapability: 'tenants:read',
      handler: 'tenants.list',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'List Tenants',
        description: 'Retrieve all tenants.',
        response: {
          200: { $ref: 'tenantListResponseSchema#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/',
      requireCapability: 'tenants',
      handler: 'tenants.create',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Create Tenant',
        description: 'Create a new tenant with its own schema.',
        body: { $ref: 'tenantBodySchema#' },
        response: {
          201: { $ref: 'tenantResponseSchema#' }
        }
      }
    },
    {
      method: 'GET',
      path: '/:id',
      requireCapability: 'tenants:read',
      handler: 'tenants.findOne',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Get Tenant',
        description: 'Retrieve a single tenant by ID.',
        params: { $ref: 'globalParamsSchema#' },
        response: {
          200: { $ref: 'tenantResponseSchema#' }
        }
      }
    },
    {
      method: 'PUT',
      path: '/:id',
      requireCapability: 'tenants',
      handler: 'tenants.update',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Update Tenant',
        description: 'Update an existing tenant.',
        params: { $ref: 'globalParamsSchema#' },
        body: { $ref: 'tenantUpdateBodySchema#' },
        response: {
          200: { $ref: 'tenantResponseSchema#' }
        }
      }
    },
    {
      method: 'DELETE',
      path: '/:id',
      requireCapability: 'tenants',
      handler: 'tenants.remove',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Archive Tenant',
        description: 'Soft delete (archive) a tenant.',
        params: { $ref: 'globalParamsSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/:id/suspend',
      requireCapability: 'tenants',
      handler: 'tenants.suspend',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Suspend Tenant',
        description: 'Suspends a tenant: explicit, instead of editing a status field by hand.'
      }
    },
    {
      method: 'POST',
      path: '/:id/impersonate',
      requireCapability: 'tenants:impersonate',
      handler: 'tenants.impersonate',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Act as a user of a tenant',
        description: 'Records who, into which tenant, as whom and why, then issues a short-lived tenant token'
      }
    },
    {
      method: 'POST',
      path: '/impersonate/end',
      // Whoever can open a session can close one. `roles: []` would have resolved to the
      // superuser alone on a control route, which is not what "authenticated (control)"
      // meant: the operator who opened a session must be able to end it.
      requireCapability: 'tenants:impersonate',
      handler: 'tenants.endImpersonation',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'End an impersonation session',
        description: 'Revokes the record, which invalidates the token even though the JWT is still signed'
      }
    },
    {
      method: 'POST',
      path: '/:id/restore',
      requireCapability: 'tenants',
      handler: 'tenants.restore',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Restore Tenant',
        description: 'Restore a soft-deleted tenant.',
        params: { $ref: 'globalParamsSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }
  ]
}
