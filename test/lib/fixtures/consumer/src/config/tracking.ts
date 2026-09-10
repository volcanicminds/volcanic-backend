export default {
  config: { enableAll: true, primaryKey: 'uuid' },
  changes: [
    // No `enable`, on purpose: the loader must persist `enable: true`, or the runtime gate
    // reads undefined and the change is never tracked despite looking configured.
    { method: 'PUT', path: '/products/:id', entity: 'product' },
    // Not a tracked method: it must be dropped rather than stored and silently ignored.
    { method: 'GET', path: '/products', entity: 'product' }
  ]
}
