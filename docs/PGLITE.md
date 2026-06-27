# Embedded database (PGlite) — plug & play Postgres

The data layer (`@volcanicminds/backend/typeorm`) can run on **PGlite**, an in‑process WASM build of Postgres.
No server to install, no Docker container, no connection string: set `type: 'pglite'` and the database is _just
there_. It speaks the **same Postgres dialect** as a real server, so your entities, Magic Queries, services and
multi‑tenant code are **identical** — only the engine changes.

> **Use it for:** local development, automated tests, demos, CLIs, throwaway prototypes, ephemeral preview envs.
> **Don't use it for:** production traffic. A real Postgres server (local install or Docker) remains the
> professional, production‑grade choice. PGlite is a single in‑process instance with serialized access — it is
> not a concurrent, networked database.

## Quick start

Install the optional dependencies (only needed when you actually use the embedded engine):

```sh
npm install typeorm-pglite @electric-sql/pglite
# only if you want pgvector / embeddings:
npm install @electric-sql/pglite-pgvector
```

Point your database config at the embedded engine:

```ts
// src/config/database.ts
import { Database } from '@volcanicminds/backend/typeorm'

export const database: Database = {
  default: {
    type: 'pglite',
    // dataDir omitted -> in-memory (data lost on restart)
    // dataDir: './.pglite'    -> persisted on disk
    vector: true,               // optional: enable pgvector
    synchronize: true
  }
}
```

That's it. Start the app with `START_DB=true` and (for the in‑memory engine, which is empty on every boot)
`DB_SYNCHRONIZE_SCHEMA_AT_STARTUP=true`. The framework auto‑enables the `uuid-ossp` extension so
`@PrimaryGeneratedColumn('uuid')` works out of the box.

## Configuration options

These keys live alongside the standard TypeORM options in `database.default`:

| Key                 | Type                  | Default                      | Description |
|---------------------|-----------------------|------------------------------|-------------|
| `type`              | `'pglite'`            | —                            | Selects the embedded engine. |
| `dataDir`           | `string \| undefined` | `undefined` (in‑memory)      | Filesystem folder to persist the DB. Omit for an ephemeral in‑memory DB. |
| `vector`            | `boolean`             | `false`                      | Loads the `pgvector` extension (`@electric-sql/pglite-pgvector`) and runs `CREATE EXTENSION vector`. |
| `extensions`        | `string[]`            | `['uuid_ossp']`              | Extra PGlite contrib extensions to enable (e.g. `['pgcrypto']`). `uuid_ossp` is always on. |
| `relaxedDurability` | `boolean`             | `true` in‑memory, `false` on disk | Faster writes with weaker fsync guarantees. Great for tests. |

The framework rewrites these into a Postgres‑dialect `DataSource` whose driver is backed by PGlite, then creates
the requested extensions **before** schema synchronization. Everything else (`entities`, `namingStrategy`,
`synchronize`, logging, …) behaves exactly as with a real Postgres.

Introspect the active engine at runtime via `global.embeddedDatabase`:

```ts
// { enabled: true, vector: true, dataDir: undefined, persisted: false, extensions: ['uuid_ossp','vector'] }
```

## Postgres vs PGlite — at a glance

| Aspect | Real Postgres (`type: 'postgres'`) | Embedded PGlite (`type: 'pglite'`) |
|---|---|---|
| **Setup** | Install a server or run a Docker container; manage credentials & ports | None. `npm install` + one config line |
| **Where it runs** | Separate process / host, over TCP | In‑process (WASM), same Node runtime |
| **Concurrency** | Real connection pool, many parallel clients | Single instance, **serialized** queries |
| **Persistence** | Durable, managed storage | In‑memory (ephemeral) or a local `dataDir` folder |
| **Networking** | Remote clients, replication, backups | None (local only) |
| **SQL dialect** | Postgres | Postgres (same engine, compiled to WASM) |
| **Extensions** | Full ecosystem (apt/yum/build) | Bundled contrib set + `pgvector`; registered at startup |
| **Startup time** | Server already running | ~instant cold start in‑process |
| **Footprint** | Full server | ~a few MB WASM, no daemon |
| **Best for** | **Production**, staging, load | Dev, tests, CI, demos, prototypes |
| **Not for** | — | Production traffic / high concurrency |

### Costs & benefits

**Benefits**
- **Zero friction**: no install, no Docker, no DB credentials — clone & run.
- **Fast, isolated tests/CI**: each run gets a clean in‑memory Postgres; no test‑container orchestration.
- **Same code path**: identical dialect means dev/test behaviour matches production far better than SQLite would.
- **pgvector included**: semantic search / embeddings work locally with no extra infrastructure.

**Costs / trade‑offs**
- **Not concurrent**: a single serialized instance — unsuitable for production load.
- **Optional WASM deps**: ~a few MB added when enabled (kept out of the core via optional dependencies).
- **In‑memory by default is ephemeral**: use `dataDir` to persist, or re‑synchronize at startup.
- **Lifecycle caveat**: all `DataSource`s share one PGlite singleton (see multi‑tenancy below).

## Vector search (pgvector)

Set `vector: true` to load `pgvector`. You can then use vector columns and the distance operators (`<->` L2,
`<=>` cosine, `<#>` inner product) directly, or use the higher‑level, engine‑agnostic store from
[`@volcanicminds/tools`](../../volcanic-tools/README.md):

```ts
import { PgVectorStore, embedText } from '@volcanicminds/tools/ai'

const store = new PgVectorStore({
  query: (sql, params) => global.connection.query(sql, params), // the TypeORM DataSource
  table: 'documents',
  dimensions: 1536,        // match your embedding model
  distance: 'cosine'
})
await store.init()
await store.upsert('doc-1', 'hello world', await embedText('hello world'))
const matches = await store.search(await embedText('greeting'), 5)
```

The same `PgVectorStore` runs unchanged against a real Postgres that has `pgvector` installed — only the engine
differs.

## Multi‑tenancy notes

Schema‑based multi‑tenancy (`CREATE SCHEMA` + `search_path`) works on PGlite: `TenantManager.createTenant()`
provisions a schema, synchronizes its tables and seeds the admin user, and `runInTenantContext()` isolates reads
per tenant.

**Important lifecycle caveat:** on the embedded engine **every `DataSource` shares one PGlite instance**
(`PGlitePool.end()` closes that shared singleton). The framework already accounts for this — the ephemeral
`DataSource` used to synchronize a tenant schema is **not** destroyed in embedded mode, so the primary connection
stays alive. If you create your own secondary `DataSource` against PGlite, do **not** call `.destroy()` on it
unless you intend to close the whole database. Use `closeEmbedded()` from `@volcanicminds/backend/typeorm` to shut
the engine down cleanly (e.g. at the end of a test suite).

> ⚠️ **Concurrency caveat — multi‑tenant on PGlite is NOT production‑safe.** Schema isolation relies on a
> per‑request `SET search_path`, but **all** requests on PGlite multiplex a **single** connection, and that
> connection's `search_path` is reset asynchronously (on the response `finish` event). Under concurrent traffic two
> tenant requests can interleave and read each other's schema. On a real Postgres server each request gets its own
> pooled connection, so the switch is naturally isolated. **Use PGlite multi‑tenancy only for sequential dev/test
> scenarios; run real Postgres for any concurrent or production multi‑tenant workload.** (The e2e suite
> `npm run test:e2e:mt:pglite` runs requests sequentially and resets `search_path` between them precisely because of
> this limitation.)

## Reading records — single vs multi tenant

**The controller is identical for PGlite and Postgres, and identical for single- and multi-tenant.** The engine is
chosen in config (`type: 'pglite'`); the tenant is chosen per request by the `x-tenant-id` header. The isolation
lives in `req.db` (the request-scoped `EntityManager`), not in your code — always read through
`service.use(req.db)` (canonical) or `req.db` directly.

```ts
// src/services/product.service.ts
import { Product } from '../entities/product.e.js'
import { BaseService } from './base.service.js'

class ProductService extends BaseService<Product> {
  constructor() { super(Product) }
}
export const productService = new ProductService()
```

```ts
// src/api/products/controller/product.ts — same code for single & multi tenant
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'
import { productService } from '../../../services/product.service.js'

// GET /products — list (magic-query pagination/filters via req.data())
export async function find(req: FastifyRequest, reply: FastifyReply) {
  const { headers, records } = await productService.use(req.db).findAll(req.userContext, req.data())
  return reply.type('application/json').headers(headers).send(records)
}

// GET /products/:id — single record
export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  const product = id ? await productService.use(req.db).findOne(req.userContext, id) : null
  return product || reply.status(404).send()
}
```

**Single tenant** — `req.db` targets the `public` schema; no header needed:

```sh
curl http://localhost:2230/products
```

**Multi tenant** — enable `multi_tenant` in your app options. The framework reads `x-tenant-id`, resolves the
tenant, and runs `SET search_path TO "<tenant_schema>", public` on `req.db`, so the **same** controller reads only
that tenant's rows:

```sh
curl -H "x-tenant-id: acme"   http://localhost:2230/products   # reads tenant_acme
curl -H "x-tenant-id: globex" http://localhost:2230/products   # reads tenant_globex
```

Lower-level read straight from `req.db` (still tenant-safe), and reading a specific tenant outside the HTTP cycle
(e.g. scheduled jobs):

```ts
// inside a controller — single or multi tenant, identical
const products = await req.db.getRepository(Product).find({ where: { active: true } })

// background job — pick the tenant explicitly
import { TenantManager } from '@volcanicminds/backend/typeorm'
const tm = new TenantManager(global.connection)
const acme = await tm.runInTenantContext('acme', (em) => em.getRepository(Product).find())
```

Schemas and `search_path` behave on PGlite exactly as on a real Postgres (covered by `npm run test:pglite`).

## Testing

The framework ships an integration suite that exercises connection, schema synchronization (uuid PKs), queries,
boolean serialization, multi‑tenant schema isolation and pgvector on PGlite:

```sh
npm run test:pglite
```

A real‑Postgres mirror of these tests is planned for the future; the suite is structured so the same scenarios
can be run against `type: 'postgres'`.

## How it works (internals)

1. `start(options)` detects `type: 'pglite'` and calls `setupEmbedded()` (`lib/database/typeorm/embedded.ts`).
2. `setupEmbedded()` `import()`s the optional deps, builds a `PGliteDriver` with the requested extensions and
   `dataDir`, and rewrites the options to `type: 'postgres'` + `driver`.
3. It eagerly creates the shared PGlite instance and runs `CREATE EXTENSION` for each extension **before** any
   `synchronize()`.
4. TypeORM then initializes normally over the PGlite‑backed pool.

Because the heavy deps are loaded only through dynamic `import()` and declared as **optional**, a pure‑Postgres
deployment never installs or loads them.
