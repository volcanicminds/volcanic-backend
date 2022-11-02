module.exports = {
  config: {
    title: 'Useful functions',
    description: 'Useful functions',
    controller: 'controller',
    tags: ['user', 'code'], // swagger
    enable: true,
    deprecated: false, // swagger
    version: false // swagger
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [],
      handler: 'me.user',
      middlewares: ['global.isAuthenticated'],
      config: {
        enable: true,
        title: 'Me title', // swagger summary
        description: 'Me description', // swagger
        tags: ['user', 'code'], // swagger
        deprecated: false, // swagger
        version: false, // swagger
        response: {
          403: {
            description: 'Successful response',
            type: 'object',
            properties: {
              hello: { type: 'string' }
            }
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
      handler: 'me.isAdmin',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Admin',
        description: 'Admin',
        enable: true,
        deprecated: false,
        version: false
      }
    },
    {
      method: 'GET',
      path: '/demo',
      roles: [],
      handler: 'me.demo',
      middlewares: ['global.isAdmin'],
      config: {
        enable: true,
        title: 'Me title', // swagger summary
        description: 'Me description', // swagger
        tags: ['user', 'code'], // swagger
        deprecated: false, // swagger
        version: false, // swagger
        params: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'user id'
            }
          }
        }, // swagger
        response: {
          201: {
            description: 'Successful response',
            type: 'object',
            properties: {
              hello: { type: 'string' }
            }
          },
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              foo: { type: 'string' }
            }
          }
        } // swagger
      }
    }
  ]
}
