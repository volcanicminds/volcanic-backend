/* eslint-disable @typescript-eslint/no-explicit-any */
// Multi-tenant cache fixture controller. Echoes the resolved tenant id plus a
// module-level counter that advances on every REAL invocation — so a cached
// (replayed) response keeps the same `n`, while a fresh one (different tenant
// scope, or after invalidation) advances it. Proves the cache key isolates by
// tenant: acme and globex never share an entry.
let n = 0

export async function show(req: any, _reply: any) {
  n += 1
  return { n, tenant: req.tenant?.id ?? null }
}
