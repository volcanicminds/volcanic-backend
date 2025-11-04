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
      path: '/me',
      roles: [],
      handler: 'user.currentUser',
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
    }
  ]
}
