export default {
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
      requireCapability: 'tokens',
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
      requireCapability: 'tokens',
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
      requireCapability: 'tokens',
      handler: 'token.findOne',
      middlewares: [],
      config: {
        title: 'Find token',
        description: 'Get token by id',
        params: { $ref: 'onlyIdSchema#' },
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
      requireCapability: 'tokens',
      handler: 'token.create',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Create new token',
        description: 'Create a new token',
        body: { $ref: 'tokenCreateBodySchema' },
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
      requireCapability: 'tokens',
      handler: 'token.update',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Update existing token',
        description: 'Update an existing token',
        params: { $ref: 'onlyIdSchema#' },
        body: { $ref: 'tokenUpdateBodySchema' },
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
      requireCapability: 'tokens',
      handler: 'token.remove',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Unregister existing token (actually disables it)',
        description: 'Unregister an existing token (actually disables it)',
        params: { $ref: 'onlyIdSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/block/:id',
      requireCapability: 'tokens',
      handler: 'token.block',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Block a token by id',
        description: 'Block a token by id',
        params: { $ref: 'onlyIdSchema#' },
        body: { $ref: 'blockBodySchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/unblock/:id',
      requireCapability: 'tokens',
      handler: 'token.unblock',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Unblock a token by id',
        description: 'Unblock a token by id',
        params: { $ref: 'onlyIdSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }
  ]
}
