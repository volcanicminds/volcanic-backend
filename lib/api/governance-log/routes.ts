//
// The governance log of the container the request works on, read by its admin: a tenant's
// own log inside the tenant, the only database without tenants. The control plane's is read at
// `/system/governance-log`, and no route reads another container's.
//
// Read-only: the database refuses to rewrite a row. `governance-log` is reserved by both
// catalogues, one per plane, as `manifest` is (lib/loader/roles.ts).
//
export default {
  config: {
    title: 'Governance log',
    description: 'The acts on the integration tokens of this tenant',
    controller: 'controller',
    tags: ['governance-log'],
    version: false,
    manifest: {
      group: 'system',
      resource: { name: 'governanceLog', titleField: 'action', subtitleField: 'occurredAt' }
    }
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      requireCapability: 'governance-log',
      handler: 'governanceLog.find',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Find governance log entries',
        description: 'Magic Query over the fields of the governance log: action, actorId, actorKind, targetId, occurredAt',
        query: { $ref: 'getQueryParamsSchema' },
        response: {
          200: { description: 'Default response', type: 'array', items: { $ref: 'governanceLogSchema#' } }
        }
      }
    },
    {
      method: 'GET',
      path: '/count',
      requireCapability: 'governance-log',
      handler: 'governanceLog.count',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Count governance log entries',
        description: 'Count',
        query: { $ref: 'getQueryParamsSchema' },
        response: { 200: { description: 'Default response', type: 'number' } }
      }
    }
  ]
}
