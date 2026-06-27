/* eslint-disable @typescript-eslint/no-explicit-any */
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
    }
  ]
}
