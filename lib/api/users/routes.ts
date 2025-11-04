module.exports = {
  config: {
    title: 'User functions',
    description: 'User functions',
    controller: 'controller',
    tags: ['users'],
    version: false
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [roles.admin],
      handler: 'user.find',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Find users',
        description: 'Get users',
        query: { $ref: 'getQueryParamsSchema' },
        response: {
          200: {
            description: 'Default response',
            type: 'array',
            items: { $ref: 'userSchema#' }
          }
        }
      }
    },
    {
      method: 'GET',
      path: '/count',
      roles: [roles.admin],
      handler: 'user.count',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Count users',
        description: 'Count users',
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
      roles: [],
      handler: 'user.findOne',
      middlewares: [],
      config: {
        title: 'Find user',
        description: 'Get user by id',
        params: { $ref: 'globalParamsSchema#' },
        response: {
          200: {
            description: 'Default response',
            $ref: 'userSchema#'
          }
        }
      }
    },
    {
      method: 'PUT',
      path: '/:id',
      roles: [],
      handler: 'user.update',
      middlewares: [],
      config: {
        title: 'Update user',
        description: 'Updates a user by id',
        params: { $ref: 'globalParamsSchema#' },
        body: { $ref: 'userBodySchema#' },
        response: {
          200: {
            description: 'Default response',
            $ref: 'userSchema#'
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/',
      roles: [],
      handler: 'user.create',
      middlewares: [],
      config: {
        title: 'Create a user',
        description: 'Creates a new user',
        body: { $ref: 'userBodySchema#' },
        response: {
          200: {
            description: 'Default response',
            $ref: 'userSchema#'
          }
        }
      }
    },
    {
      method: 'DELETE',
      path: '/:id',
      roles: [],
      handler: 'user.remove',
      middlewares: [],
      config: {
        title: 'Delete user',
        description: 'Deletes user by id',
        params: { $ref: 'globalParamsSchema#' },
        response: {
          200: {
            description: 'Default response',
            $ref: 'userSchema#'
          }
        }
      }
    },
    {
      method: 'GET',
      path: '/me',
      roles: [],
      handler: 'user.currentUser',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Get current user',
        description: 'Get current user',
        response: {
          200: { $ref: 'userSchema#' }
        }
      }
    },
    {
      method: 'GET',
      path: '/is-admin',
      roles: [],
      handler: 'user.isAdmin',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Check if is an admin',
        description: 'Check if the current user is an admin',
        response: {
          200: { $ref: 'isAdminSchema#' }
        }
      }
    }
  ]
}
