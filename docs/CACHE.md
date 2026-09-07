# Per-route Response Cache

An **opt-in**, in-memory response cache for read-heavy, slow-changing endpoints (e.g. a public storefront or
any GET whose result rarely changes). It cuts database load and latency without a separate cache service:
enable it per route (or per file), and the framework serves cache hits **after** authentication/role checks
and **before** the handler runs.

- **Zero dependency**: backed by an internal LRU + TTL store.
- **Scope-safe by design**: the cache key states the container, the authenticated subject and the role set, so a
  cached response is never served across tenants, users or privilege levels.
- **GET + 2xx only**: mutations are never cached.
- **Invalidation by key-group**: declarative (`invalidates`) or imperative (`invalidateCache()`), and it does not
  travel between instances (section 6).

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
keyGroup :: container :: subject | roles :: METHOD url
```

- **container**: `control` for the platform, `tenant:<id>` inside a customer's container.
- **subject**: `req.user?.externalId` (or the API-token id), or `anon` for unauthenticated callers.
- **roles**: the effective role codes, sorted.

**Why the container is written out.** It could be inferred from the rest of the key in most
shapes, and that is exactly the reason it is stated. Defect D-15 was a cache key that happened
to be unique: the v4 data-layer cache keyed on the SQL, and with a schema-per-tenant strategy
the SQL of two tenants is the same string, so the key stopped isolating the day the schema
moved out of it. Isolation that holds by accident holds until something else changes.

Consequences:

- Anonymous / `public` callers share one entry (the storefront is the same for everyone).
- Authenticated callers get **their own** entry per container and role set: a cached admin
  response is never served to a different admin, user or tenant.
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

### The default TTL is two numbers, not one

When `ttl` is not declared, the framework picks it from the shape of the deployment it can
see:

| Deployment | Default `ttl` | Why |
|---|---|---|
| no `tenants` block | **3600s** | a single application, usually a single process |
| `tenants` declared | **60s** | the deployment that gets replicated, and the store is per process |

The reason is section 6: an invalidation reaches the instance that served the request and no
other, so behind several instances the TTL is what bounds how long the rest stay behind. One
hour of that is not a cache, it is a stale read with a timer.

The residual case is worth stating rather than hiding: a **single-tenant** application can also
run behind several instances, and there the one-hour default is the unsafe one. Declare
`cache.ttl` explicitly when that is the shape you run.

`options.cache.enabled = false` (or a route `ttl`/global `ttl` of `0`) turns caching off: every request runs
fresh. With the master switch off the store stays empty, so declared `invalidates` become no-ops (the `onSend`
hook short-circuits, no store scan). The effective configuration is logged at startup, and it says where the
number came from:

```
Cache 🧊 enabled: ttl 60s (default with tenants), maxEntries 1000, strategy LRU+TTL
Cache 🧊 is per process: an invalidation reaches this instance only. TTL bounds the staleness.
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

### The store is per process, and an invalidation does not travel

This is a **known limit and a decision**, not an oversight (defect D-26). The store is a `Map`
in the process that serves the request. A declarative `invalidates`, or a call to
`invalidateCache()`, empties that instance's entries and reaches no other instance, so behind a
load balancer a stale entry survives on the other replicas until it expires.

What follows from it:

- the TTL is the only bound on cross-instance staleness, which is why the default is 60s as
  soon as tenants are declared (section 4);
- a write that must be visible everywhere immediately does not belong behind this cache: leave
  those routes uncached rather than tuning the TTL down to nothing;
- the alternative is a shared store behind a port, with a Redis adapter. It is deliberately not
  shipped: it adds a service to operate and a new way to fail (an unreachable cache that has to
  choose between failing the request and silently degrading), for a problem a low TTL bounds.
  If a deployment genuinely needs it, that is the moment to add the port, not before.

### Others

- **Multi-tenant**: the key states the container, and a declarative invalidation only sweeps
  the container the request ran in: a write inside one customer's data cannot have staled
  another's. Tenant-scoped routes are skipped when no tenant is resolved. If you add
  cross-tenant routes, make sure the response truly is tenant-independent before caching.
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
