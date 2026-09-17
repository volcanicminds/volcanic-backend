const { manifest } = global.config?.options || {}
const isEnabled = manifest?.enabled || false

export default {
  config: {
    title: 'Admin',
    description: 'Backoffice support: manifest descriptor',
    controller: 'controller',
    enable: isEnabled, // opt-in via config.options.manifest.enabled
    // Tenant scope (T-10.14). With tenants declared this is the manifest of a customer's console,
    // read by that customer's users with the tenant catalogue; the platform console reads
    // `/system/manifest`. Without tenants the two planes are one identity space and the manifest
    // is whole.
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
        description: 'Manifest v2 of the tenant plane: its routes with their declared roles.'
      }
    }
  ]
}
