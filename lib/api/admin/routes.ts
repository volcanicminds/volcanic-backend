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
      // A role granted the `manifest` capability can load the admin console; the client
      // hides what the caller's roles cannot reach and every API route still enforces.
      requireCapability: 'manifest',
      handler: 'manifest.get',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Admin manifest',
        description: 'Manifest v2 describing the admin-manageable API (full, with declared roles).'
      }
    }
  ]
}
