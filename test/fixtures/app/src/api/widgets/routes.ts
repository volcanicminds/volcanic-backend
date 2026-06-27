 
// Consumer-app CUSTOM routes, auto-discovered from src/api/**/routes.ts alongside
// the framework's own routes. Demonstrates: a custom-role-gated endpoint
// (roles: ['editor']), a custom global middleware (global.auditStamp), and a
// tracked mutation (PUT, see src/config/tracking.ts).
export default {
  config: {
    title: 'Widgets',
    description: 'Custom widget resource',
    controller: 'controller',
    tags: ['widgets']
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [{ code: 'editor' }],
      handler: 'widget.list',
      middlewares: ['global.auditStamp', 'global.isAuthenticated'],
      config: {
        title: 'List widgets',
        description: 'List all widgets (editor only)'
      }
    },
    {
      method: 'PUT',
      path: '/:id',
      roles: [{ code: 'editor' }],
      handler: 'widget.update',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Update a widget',
        description: 'Rename a widget (tracked)'
      }
    },
    {
      method: 'POST',
      path: '/upload',
      roles: [{ code: 'editor' }],
      handler: 'widget.upload',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Upload (multipart)',
        description: 'Parse a multipart form (proves the multipart plugin)'
      }
    },
    {
      method: 'POST',
      path: '/webhook',
      roles: [{ code: 'editor' }],
      handler: 'widget.webhook',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Webhook (raw body)',
        description: 'Echo the raw request body (proves the rawBody plugin)',
        rawBody: true
      }
    }
  ]
}
