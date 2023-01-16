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
      roles: [roles.public],
      handler: 'user.user',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Get current user',
        description: 'Get current user',
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              id: { type: 'string' },
              externalId: { type: 'string' },
              username: { type: 'string' },
              email: { type: 'string' },
              blocked: { type: 'boolean' },
              blockedReason: { type: 'string' },
              blockedAt: { type: 'string' },
              confirmed: { type: 'boolean' },
              confirmedAt: { type: 'string' },
              roles: { type: 'array', items: { type: 'string' } },
              createdAt: { type: 'string' },
              version: { type: 'number' },
              updatedAt: { type: 'string' }
            }
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
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              isAdmin: { type: 'boolean' }
            }
          }
        }
      }
    }
  ]
}
