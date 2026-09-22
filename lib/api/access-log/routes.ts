//
// The access log of the tenant plane (T-12.32, F44), read by the tenant's admin.
//
// Read-only: rows are written by the framework as accesses happen and removed by retention, never
// by a client. The query sees only `scope: 'tenant'` rows, a condition added after everything the
// URL asks for: without tenants the platform's rows sit in the same container.
//
export default {
  config: {
    title: 'Access log',
    description: 'Logins, second factors, logouts and session events of this tenant',
    controller: 'controller',
    tags: ['access-log'],
    version: false,
    manifest: {
      group: 'system',
      resource: { name: 'accessLog', titleField: 'event', subtitleField: 'occurredAt' }
    }
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: ['admin'],
      handler: 'accessLog.find',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Find access log entries',
        description: 'Magic Query over the fields of the access log',
        query: { $ref: 'getQueryParamsSchema' },
        response: {
          200: { description: 'Default response', type: 'array', items: { $ref: 'accessLogSchema#' } }
        }
      }
    },
    {
      method: 'GET',
      path: '/count',
      roles: ['admin'],
      handler: 'accessLog.count',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Count access log entries',
        description: 'Count',
        query: { $ref: 'getQueryParamsSchema' },
        response: { 200: { description: 'Default response', type: 'number' } }
      }
    }
  ]
}
