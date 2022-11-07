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
      handler: 'user.isAdmin',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Check if is an admin',
        description: 'Check if the current user is an admin',
        enable: true,
        deprecated: false,
        version: false
      }
    },
    {
      method: 'GET',
      path: '/demo',
      roles: [],
      handler: 'user.demo',
      middlewares: ['global.isAdmin'],
      config: {
        enable: false,
        title: 'Me title', // swagger summary
        description: 'Me description', // swagger
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
              id: { type: 'string' },
              demo: { type: 'boolean' },
              date: { type: 'string' },
              query: { type: 'object' },
              body: { type: 'object' }
            }
          }
        } // swagger
      }
    },
    {
      method: 'POST',
      path: '/demo',
      roles: [],
      handler: 'user.demo',
      middlewares: ['global.isAdmin'],
      config: {
        enable: false,
        title: 'Me title', // swagger summary
        description: 'Me description', // swagger
        deprecated: false, // swagger
        version: false, // swagger
        body: {
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
              id: { type: 'string' },
              demo: { type: 'boolean' },
              date: { type: 'string' },
              body: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  role: { type: 'string' }
                }
              }
            }
          }
        } // swagger
      }
    }
  ]
}
