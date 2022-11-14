module.exports = {
  config: {
    title: 'User useful functions',
    description: 'User useful functions',
    controller: 'controller',
    tags: ['users'],
    enable: true,
    deprecated: false, // swagger
    version: false // swagger
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [],
      handler: 'user.user',
      middlewares: ['global.isAuthenticated'],
      config: {
        enable: true,
        title: 'Get current user', // swagger summary
        description: 'Get current user', // swagger
        deprecated: false, // swagger
        version: false, // swagger
        response: {
          403: {
            description: 'Unauthorized',
            type: 'string'
          },
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              id: { type: 'number' }
            }
          }
        } // swagger
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
        enable: true,
        deprecated: false,
        version: false,
        response: {
          403: {
            description: 'Unauthorized',
            type: 'string'
          },
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
        } // swagger
      }
    }
  ]
}
