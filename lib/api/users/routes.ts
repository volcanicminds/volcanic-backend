module.exports = {
  config: {
    title: 'User useful functions',
    description: 'User useful functions',
    controller: 'controller',
    tags: ['users'],
    version: false
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [],
      handler: 'user.user',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Get current user',
        description: 'Get current user',
        response: {
          403: {
            description: 'Unauthorized',
            type: 'string'
          },
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              email: { type: 'string' },
              roles: { type: 'array' }
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
          403: {
            description: 'Unauthorized',
            type: 'string'
          },
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
