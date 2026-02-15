const { multi_tenant } = global.config?.options || {}
const isEnabled = multi_tenant?.enabled || false

export default {
  config: {
    title: 'Tenant Management',
    description: 'Administration of tenants (global scope)',
    controller: 'controller',
    enable: isEnabled,
    tenantContext: false, // Critical: Operate on global scope (public schema), bypass tenant context
    tags: ['tenants']
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [roles.admin],
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
      roles: [roles.admin],
      handler: 'tenants.create',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Create Tenant',
        description: 'Create a new tenant with its own schema.',
        body: { $ref: 'tenantBodySchema#' },
        response: {
          201: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'GET',
      path: '/:id',
      roles: [roles.admin],
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
      roles: [roles.admin],
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
      roles: [roles.admin],
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
      path: '/:id/restore',
      roles: [roles.admin],
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
