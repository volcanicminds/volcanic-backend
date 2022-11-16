module.exports = {
  config: {
    title: 'User useful functions',
    description: 'User useful functions',
    controller: 'controller',
    tags: ['auth'],
    enable: true,
    deprecated: false, // swagger
    version: false // swagger
  },
  routes: [
    {
      method: 'POST',
      path: '/login',
      roles: [],
      handler: 'auth.login',
      middlewares: [],
      config: {
        enable: true,
        title: 'Login', // swagger summary
        description: 'Login', // swagger
        body: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            password: { type: 'string' }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              token: { type: 'string' },
              roles: { type: 'array' }
            }
          }
        } // swagger
      }
    },
    {
      method: 'GET',
      path: '/demo',
      roles: [roles.backoffice],
      handler: 'auth.demo',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Demo auth',
        description: 'Demo auth',
        enable: true,
        response: {
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
