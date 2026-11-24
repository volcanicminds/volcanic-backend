export default {
  config: {
    title: 'Health functions',
    description: 'Health functions',
    controller: 'controller',
    tags: ['health'],
    // A liveness probe for load balancers, answering `{ ok }`: no rows for a console to draw.
    manifest: { exclude: true }
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      // A health check answers before anyone is authenticated, on either plane.
      roles: ['public'],
      handler: 'health.check',
      middlewares: [],
      config: {
        title: 'Health check service',
        description: 'Health check service',
        scope: 'control',
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }
  ]
}
