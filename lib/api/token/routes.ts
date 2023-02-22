module.exports = {
  config: {
    title: 'Integration token functions',
    description: 'Integration token functions',
    controller: 'controller',
    tags: ['token'],
    deprecated: false,
    version: false,
    enable: true
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [roles.admin, roles.backoffice],
      handler: 'token.find',
      middlewares: [],
      config: {
        title: 'Find tokens',
        description: 'Get tokens list',
        query: { $ref: 'getQueryParamsSchema' },
        response: {
          200: {
            description: 'Default response',
            type: 'array',
            items: { $ref: 'tokenSchema#' }
          }
        }
      }
    },
    {
      method: 'GET',
      path: '/count',
      roles: [roles.admin, roles.backoffice],
      handler: 'token.count',
      middlewares: [],
      config: {
        title: 'Count tokens',
        description: 'Count tokens',
        response: {
          200: {
            description: 'Default response',
            type: 'number'
          }
        }
      }
    },
    {
      method: 'GET',
      path: '/:id',
      roles: [roles.admin, roles.backoffice],
      handler: 'token.findOne',
      middlewares: [],
      config: {
        title: 'Find token',
        description: 'Get token by id',
        params: { $ref: 'tokenParamsSchema#' },
        response: {
          200: {
            description: 'Default response',
            $ref: 'tokenSchema#'
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/',
      roles: [roles.admin, roles.backoffice],
      handler: 'token.create',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Create new token',
        description: 'Create a new token',
        body: { $ref: 'tokenBodySchema' },
        response: {
          200: {
            description: 'Default response',
            $ref: 'tokenSchema#'
          }
        }
      }
    },
    {
      method: 'PUT',
      path: '/:id',
      roles: [roles.admin, roles.backoffice],
      handler: 'token.update',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Update existing token',
        description: 'Update an existing token',
        params: { $ref: 'tokenParamsSchema#' },
        body: { $ref: 'tokenBodySchema' },
        response: {
          200: {
            description: 'Default response',
            $ref: 'tokenSchema#'
          }
        }
      }
    },
    {
      method: 'DELETE',
      path: '/:id',
      roles: [roles.admin, roles.backoffice],
      handler: 'token.remove',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Unregister existing token (actually disables it)',
        description: 'Unregister an existing token (actually disables it)',
        params: { $ref: 'tokenParamsSchema#' },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/block/:id',
      roles: [roles.admin, roles.backoffice],
      handler: 'token.block',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Block a token by id',
        description: 'Block a token by id',
        params: { $ref: 'tokenParamsSchema#' },
        body: { $ref: 'blockBodySchema' },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/unblock/:id',
      roles: [roles.admin, roles.backoffice],
      handler: 'token.unblock',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Unblock a token by id',
        description: 'Unblock a token by id',
        params: { $ref: 'tokenParamsSchema#' },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
        }
      }
    }
  ]
}
