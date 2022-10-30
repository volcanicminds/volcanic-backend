export default {
  config: {
    title: 'Useful functions',
    description: 'Useful functions',
    controller: 'controller',
    enable: true,
    deprecated: false,
    version: false
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [],
      handler: 'me.user',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Me',
        description: 'Me',
        enable: true,
        deprecated: false,
        version: false
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
        title: 'Demo',
        description: 'Demo',
        enable: true,
        deprecated: false,
        version: false
      }
    }
  ]
}
