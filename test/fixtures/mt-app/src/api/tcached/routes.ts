// Multi-tenant cache fixture: a tenant-scoped (tenantContext default = true),
// public, cached GET. The cache key includes the resolved tenant id, so acme and
// globex get isolated entries and a tenant-context miss (no tenant header) is
// never cached.
export default {
  config: {
    title: 'TCached',
    description: 'Multi-tenant per-route cache fixture',
    controller: 'controller',
    tags: ['tcached'],
    cache: { ttl: 60 }
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [{ code: 'public' }],
      handler: 'tcached.show',
      config: { title: 'Tenant cached', description: 'Cached, tenant-scoped GET' }
    }
  ]
}
