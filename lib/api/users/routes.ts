export default {
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
      path: '/roles',
      roles: [],
      handler: 'user.getRoles',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Get all roles',
        description: 'Get all roles',
        response: {
          200: {
            description: 'Default response',
            type: 'array',
            items: { $ref: 'roleSchema#' }
          }
        }
      }
    },
    {
      method: 'GET',
      path: '/:id',
      roles: [roles.admin],
      handler: 'user.findOne',
      middlewares: ['global.isAuthenticated'],
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
      roles: [roles.admin],
      handler: 'user.update',
      middlewares: ['global.isAuthenticated'],
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
      roles: [roles.admin],
      handler: 'user.create',
      middlewares: ['global.isAuthenticated'],
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
      roles: [roles.admin],
      handler: 'user.remove',
      middlewares: ['global.isAuthenticated'],
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
      handler: 'user.getCurrentUser',
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
      method: 'PUT',
      path: '/me',
      roles: [],
      handler: 'user.updateCurrentUser',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Update current user',
        description: 'Update current user',
        body: { $ref: 'currentUserBodySchema#' },
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
    },
    {
      method: 'POST',
      path: '/:id/mfa/reset',
      roles: [roles.admin],
      handler: 'user.resetMfa',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Reset MFA for user',
        description: 'Disable MFA for a specific user (Admin only)',
        params: { $ref: 'globalParamsSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }
  ]
}
