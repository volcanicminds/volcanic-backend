// Fixture: FILE-LEVEL cache inheritance. `config.cache` is set once at the file
// level and inherited by every route in this file (no per-route `cache` prop),
// under the default key-group = the api folder ('cachedfile').
export default {
  config: {
    title: 'CachedFile',
    description: 'File-level cache inheritance fixture',
    controller: 'controller',
    tags: ['cachedfile'],
    cache: { ttl: 60 }
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [{ code: 'public' }],
      handler: 'cachedfile.list',
      // No per-route `cache`: caching comes from the file-level config above.
      config: { title: 'File-cached list', description: 'GET cached via file-level config' }
    }
  ]
}
