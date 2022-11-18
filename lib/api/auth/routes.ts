module.exports = {
  config: {
    title: 'User useful functions',
    description: 'User useful functions',
    controller: 'controller',
    tags: ['auth'],

    deprecated: false,
    version: false
  },
  routes: [
    {
      method: 'POST',
      path: '/login',
      roles: [],
      handler: 'auth.login',
      middlewares: [],
      config: {
        title: 'Login',
        description: 'Basic login authentication',
        body: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            password: { type: 'string' }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              token: { type: 'string' },
              roles: { type: 'array' }
            }
          }
        }
      }
    },
    {
      method: 'GET',
      path: '/demo',
      roles: [roles.backoffice],
      handler: 'auth.demo',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'For debug purpose',
        description: 'Demo login authentication',
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
