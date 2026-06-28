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
      roles: [roles.admin],
      handler: 'manifest.get',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Admin manifest',
        description: 'Manifest v2 describing the admin-manageable API (full, with declared roles).'
      }
    }
  ]
}
