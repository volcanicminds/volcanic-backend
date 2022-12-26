module.exports = {
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
