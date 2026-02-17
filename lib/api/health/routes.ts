export default {
  config: {
    title: 'Health functions',
    description: 'Health functions',
    controller: 'controller',
    tags: ['health']
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [],
      handler: 'health.check',
      middlewares: [],
      config: {
        title: 'Health check service',
        description: 'Health check service',
        tenantContext: false,
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }
  ]
}
