// Fixture: FILE-LEVEL invalidation-only inheritance. The file-level `config.cache`
// disables caching for this file's routes but declares `invalidates`, inherited by
// the POST below (no per-route `cache`): a successful mutation flushes the
// 'cachedfile' key-group (a DIFFERENT api folder — cross-folder invalidation).
export default {
  config: {
    title: 'CachedInval',
    description: 'File-level invalidation-only inheritance fixture',
    controller: 'controller',
    tags: ['cachedinval'],
    cache: { enabled: false, invalidates: ['cachedfile'] }
  },
  routes: [
    {
      method: 'POST',
      path: '/bump',
      roles: [{ code: 'public' }],
      handler: 'cachedinval.bump',
      // No per-route `cache`: invalidation comes from the file-level config above.
      config: { title: 'Bump', description: 'Flushes the cachedfile key-group' }
    }
  ]
}
