const { manifest } = global.config?.options || {}
const isEnabled = manifest?.enabled || false

export default {
  config: {
    title: 'Admin',
    description: 'Backoffice support: manifest descriptor (admin scope)',
    controller: 'controller',
    enable: isEnabled, // opt-in via config.options.manifest.enabled
    tenantContext: false,
    tags: ['admin']
  },
  routes: [
    {
      method: 'GET',
      path: '/manifest',
      // `backoffice` is allowed too: operators with limited roles still need the
      // manifest to boot the admin UI — the client hides what their roles cannot
      // reach (declared per-capability `roles`), and every API route still enforces.
      roles: [roles.admin, roles.backoffice],
      handler: 'manifest.get',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Admin manifest',
        description: 'Manifest v2 describing the admin-manageable API (full, with declared roles).'
      }
    }
  ]
}
