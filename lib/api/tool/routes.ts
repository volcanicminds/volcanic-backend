module.exports = {
  config: {
    title: 'Tool functions',
    description: 'Tool functions',
    controller: 'controller',
    tags: ['tool']
  },
  routes: [
    {
      method: 'POST',
      path: '/synchronize-schemas',
      roles: [roles.admin],
      handler: 'tool.synchronizeSchemas',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Synchronize database schema',
        description: 'Synchronize database schema',
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }
  ]
}
