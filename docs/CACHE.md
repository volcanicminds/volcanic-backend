# Per-route Response Cache

An **opt-in**, in-memory response cache for read-heavy, slow-changing endpoints (e.g. a public storefront or
any GET whose result rarely changes). It cuts database load and latency without a separate cache service:
enable it per route (or per file), and the framework serves cache hits **after** authentication/role checks
and **before** the handler runs.

- **Zero dependency** — backed by an internal LRU + TTL store.
- **Scope-safe by design** — the cache key includes tenant, authenticated subject and role set, so a cached
  response is never served across tenants, users or privilege levels.
- **GET + 2xx only** — mutations are never cached.
- **Invalidation by key-group** — declarative (`invalidates`) or imperative (`invalidateCache()`).

Available since **3.5.0**.

---

## 1. Enabling the cache on a route

Add a `cache` prop to a route in `routes.ts`. It accepts three authored forms:

```typescript
cache: true                 // enable with the global default TTL
cache: 3600                 // enable with a TTL of 3600 seconds
cache: {                    // full form
  enabled?: boolean         // default: true when the object is present
  ttl?: number              // seconds; falls back to the global default (options.cache.ttl)
  keyGroup?: string         // logical group for invalidation; default = the api folder (area)
  invalidates?: string | string[] // key-group(s) to flush after a successful (2xx) response
}
```

Example — a cached public list plus the admin write that invalidates it:

```typescript
// src/api/public/routes.ts
{ method: 'GET', path: '/vehicles', roles: [roles.public], handler: 'public.vehicles',
  cache: { ttl: 3600 } }

// src/api/vehicles/routes.ts (admin)
{ method: 'PUT', path: '/:id', roles: [roles.admin], handler: 'vehicle.update',
  cache: { invalidates: ['public'] } }
```

### File-level default (inheritance)

`cache` can also be set once at the **file-level** `config`, and every route in that file inherits it (a
per-route `cache` always overrides the file-level one). This is the recommended way to adopt it across a
resource:

```typescript
// src/api/public/routes.ts — cache every GET in this file under the 'public' key-group
export default {
  config: { title: 'Public', controller: 'controller', cache: { ttl: 3600 } },
  routes: [ /* GET routes — all cached; a POST here is a mutation and is never cached */ ]
}

// src/api/vehicles/routes.ts — invalidation-only: don't cache admin (per-user) responses,
// just flush the public storefront on every successful mutation.
export default {
  config: { title: 'Vehicles', controller: 'controller', cache: { enabled: false, invalidates: ['public'] } },
  routes: [ /* GET stay uncached; POST/PUT/PATCH/DELETE flush 'public' */ ]
}
```

---

## 2. What gets cached (and what doesn't)

The read hook (`preHandler`, after auth) returns a stored response on a hit; the write hook (`onSend`) stores a
fresh one. A response is cached only when **all** of these hold:

- the route opted in (`cache.enabled`) and the global cache is enabled;
- the method is **GET**;
- the status is **2xx**;
- the payload is a serialized string (JSON/text — not a stream/Buffer);
- there is no `Set-Cookie` on the response;
- if multi-tenant is enabled and the route is tenant-scoped, a tenant was resolved (otherwise the cache is
  skipped to avoid any cross-tenant leak).

On a hit the stored **status**, body and the `content-type` + `v-*` (pagination) headers are replayed, so
paginated responses keep their metadata. Non-2xx responses (validation errors, 404, 5xx) are **never** cached,
so a "not found" never sticks.

---

## 3. The cache key (scope isolation)

The key is:

```
keyGroup :: tenant | subject | roles :: METHOD url
```

- **tenant** — `req.tenant?.id` (empty in single-tenant mode).
- **subject** — `req.user?.externalId` (or the API-token id), or `anon` for unauthenticated callers.
- **roles** — the effective role codes, sorted.

Consequences:

- Anonymous / `public` callers share one entry (the storefront is the same for everyone).
- Authenticated callers get **their own** entry per tenant/role — a cached admin response is never served to a
  different admin, user or tenant.
- The full `url` (path + query string) is part of the key, so different filters/pages are cached separately.

---

## 4. Storage: LRU + TTL

The store is a single in-memory instance (a `Map`, no external dependency):

- **TTL** — each entry expires after its route `ttl` (or the global default). Expiry is enforced lazily on read
  and by a periodic background sweep.
- **LRU** — on read, an entry is marked most-recently-used; when the number of entries exceeds `maxEntries`, the
  least-recently-used entry is evicted.

Global defaults live in `general.ts` under `options.cache`:

```typescript
// src/config/general.ts
export default {
  name: 'general',
  options: {
    cache: {
      enabled: true,   // master switch for the whole feature
      ttl: 3600,       // default TTL (seconds) for routes without an explicit ttl
      maxEntries: 1000 // LRU cap before eviction
    }
  }
}
```

`options.cache.enabled = false` (or a route `ttl`/global `ttl` of `0`) turns caching off — every request runs
fresh. With the master switch off the store stays empty, so declared `invalidates` become no-ops (the `onSend`
hook short-circuits, no store scan). The effective configuration is logged at startup:

```
Cache 🧊 enabled — ttl 3600s, maxEntries 1000, strategy LRU+TTL
```

---

## 5. Invalidation

Invalidation is by **key-group** (the default key-group is the api folder, e.g. `src/api/public/*` → `public`).

### Declarative

Add `invalidates` to a mutating route (or its file-level `config.cache`): on a successful (2xx) response the
listed key-groups are flushed.

```typescript
cache: { invalidates: ['public'] }               // one group
cache: { invalidates: ['public', 'brands'] }      // several
cache: { enabled: false, invalidates: ['public'] } // don't cache this route, only invalidate
```

### Imperative

Import the helper (also mirrored on `global.cache`) and call it from anywhere — a service, a hook, a job:

```typescript
import { invalidateCache, cache } from '@volcanicminds/backend'

invalidateCache('public')            // flush one key-group
invalidateCache(['public', 'brands']) // flush several
invalidateCache()                    // flush everything

// global.cache is the same facade:
global.cache.invalidate('public')
global.cache.flushAll()
global.cache.del(key)                // delete a single computed key
global.cache.stats()                 // { size, hits, misses, enabled, ttl, maxEntries }
```

---

## 6. Caveats

- **Multi-tenant**: the key already includes the tenant id; tenant-scoped routes are skipped when no tenant is
  resolved. If you add cross-tenant routes, make sure the response truly is tenant-independent before caching.
- **Memory**: bound growth with `maxEntries`. A route with many distinct query-string combinations creates many
  keys — keep the client's allowed filters small, or lower `maxEntries`.
- **Negative caching**: disabled on purpose — non-2xx responses are not cached, so a newly-published record is
  never masked by a stale 404.
- **Scope correctness is opt-in**: only enable `cache` on routes whose response is fully determined by
  method + url + tenant + subject + roles. If a handler varies its output by something else (a custom header, the
  time of day, …), don't cache it.

---

## 7. Adoption example (Dionisi storefront)

```typescript
// src/api/public/routes.ts     → cache all storefront GETs for 1h (key-group 'public')
config: { /* … */ cache: { ttl: 3600 } }

// src/api/vehicles/routes.ts   → admin writes flush the storefront
// src/api/brands/routes.ts
// src/api/company/routes.ts
config: { /* … */ cache: { enabled: false, invalidates: ['public'] } }
```

Result: the public site is served from memory and refreshed only when the admin actually changes something (or
after the TTL as a safety net).
