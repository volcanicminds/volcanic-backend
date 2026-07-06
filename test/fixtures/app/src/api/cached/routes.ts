// Fixture routes exercising the per-route cache OOTB capability:
//  - GET /cached           → cached (default key-group = folder 'cached')
//  - POST /cached/bump      → invalidates the 'cached' key-group on success
export default {
  config: {
    title: 'Cached',
    description: 'Per-route cache fixture',
    controller: 'controller',
    tags: ['cached']
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [{ code: 'public' }],
      handler: 'cached.counter',
      cache: { ttl: 60 },
      config: { title: 'Cached counter', description: 'Cached GET (public)' }
    },
    {
      method: 'POST',
      path: '/bump',
      roles: [{ code: 'public' }],
      handler: 'cached.bump',
      cache: { invalidates: ['cached'] },
      config: { title: 'Bump', description: 'Invalidates the cached key-group' }
    },
    {
      method: 'GET',
      path: '/limited',
      roles: [{ code: 'public' }],
      handler: 'cached.limited',
      // Per-route rate limit (the plugin is registered with global:false, so it
      // only throttles routes that opt in here).
      rateLimit: { max: 2, timeWindow: '1 minute' },
      config: { title: 'Rate limited', description: 'Per-route rate limit' }
    },
    {
      method: 'GET',
      path: '/failing',
      roles: [{ code: 'public' }],
      handler: 'cached.failing',
      cache: { ttl: 60 }, // opted in, but responses are 5xx → never cached
      config: { title: 'Failing', description: 'Always 500 (non-2xx not cached)' }
    }
  ]
}
