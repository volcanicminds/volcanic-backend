export default {
  config: {
    title: 'Useful functions',
    description: 'Useful functions',
    enable: true,
    deprecated: false,
    version: false,
    controller: 'controller'
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      handler: 'me.user',
      roles: ['admin'],
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
      handler: 'me.isAdmin',
      roles: ['admin'],
      config: {
        title: 'Admin',
        description: 'Admin',
        enable: true,
        deprecated: false,
        version: false
      }
    }
  ]
}
