[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![opensource](https://img.shields.io/badge/open-source-blue)](https://en.wikipedia.org/wiki/Open_source)
[![volcanic-backend](https://img.shields.io/badge/volcanic-minds-orange)](https://github.com/volcanicminds/volcanic-backend)
[![npm](https://img.shields.io/badge/package-npm-white)](https://www.npmjs.com/package/@volcanicminds/backend)
[![CI](https://github.com/volcanicminds/volcanic-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/volcanicminds/volcanic-backend/actions/workflows/ci.yml)

# volcanic-backend

`@volcanicminds/backend` is a Node.js framework on Fastify 5 for REST APIs. Routes, controllers, schemas,
hooks and jobs are found by convention in your `src/` tree. Authentication, sessions, roles and a native API
for users, tokens and tenants come with it. An optional data layer on Postgres adds a query language read
from the URL, versioned migrations and an isolated container per tenant.

## What it gives you

The package ships two layers. The HTTP core runs with no database at all. The data layer is the subpath
`@volcanicminds/backend/db`: its dependencies are optional peers, and the Drizzle underneath is not part of
the API. The boundary is enforced in CI, where the core may not import the data layer.

Tenants are isolated by construction. Each customer gets a schema or a database of its own, chosen by
qualifying the tables and never by session state left on a pooled connection. The tenant comes from the token
whenever there is one, and a query with no container throws instead of reading whichever one the pool held.

Sessions can be revoked. Cookie mode is the default (signed, httpOnly, SameSite=Strict); bearer mode serves
integrations. The refresh credential is an opaque session row, rotated at every renewal, and a spent one
presented again after a short grace window closes the whole session. The login is a flow of stages: password, TOTP, an email code and
OIDC, configured per plane, with an MFA policy set per deployment, per plane and per tenant.

A tenant leaves as a package: its dump without credentials, a manifest of hashes the customer can check
offline, and an envelope only the operator keeps. The same package restores it as a new tenant, here or on
another instance. A single-tenant deployment and the control plane are backed up by the infrastructure
instead, because there the customer owns the whole database.

The schema is committed SQL, applied in order and recorded inside each container. An instance refuses to boot
behind its own schema, and a fleet migrator brings every tenant forward and names the ones that failed.

Magic Query turns the query string into SQL: filters, boolean logic, sorting and pagination, with your
row-level permissions applied after everything the URL asked for. A filter it cannot honour
answers 400.

Failures are visible. The boot refuses a weak signing secret, an unknown auth mode, a CORS wildcard with
credentials and a tenancy strategy it cannot isolate; an audit write that fails fails the request.

Also included: role-based access, capabilities for the admin consoles, change tracking, a job scheduler, a
per-route response cache, Swagger, rate limiting, CORS, Helmet, multipart uploads, static files and
OpenTelemetry tracing.

## Compatibility

Compatibility follows the major version: `@volcanicminds/backend` 5.x works with the 5.x releases of

| Package | What it adds |
|---|---|
| `@volcanicminds/tools` | TOTP for the second factor, a mailer, object storage, resumable uploads, AI utilities |
| `@volcanicminds/admin` | the admin console, built from the manifest the backend serves |
| `@volcanicminds/rag` | retrieval: ingestion, dense and hybrid search, one interface over several vector engines |

The runtime is Node.js 26 or later, ESM only (`require` is not supported). The data layer runs on Postgres;
PGlite runs it inside the process for development and tests.

## Breaking changes in 5.0

5.0 is a new framework, not an upgrade of 4.x, and there is no migration path. A project on 4.x stays there
with `npm install @volcanicminds/backend@4`, which saves `^4.0.3` in its package.json. For whoever knows 4.x, the changes that
matter most:

- the data layer moved from `@volcanicminds/backend/typeorm` (TypeORM) to `@volcanicminds/backend/db`, on
  Postgres only; MongoDB is gone
- `global.connection`, `global.entity`, `global.repository`, `req.db` and `req.runner` are gone: a request
  is handed `req.control` and `req.tenant`
- the schema is versioned migrations: `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` and the `/tool` routes are gone
- the session lives in a cookie by default (`AUTH_MODE=COOKIE`, which needs `COOKIE_SECRET`), the access
  token lasts `1h`, and the refresh credential is a rotating session row instead of a JWT
- the login is `/auth/flow/*`: the one-shot login route and the separate MFA route are gone, and a JWT with a
  `role` claim is refused
- registration is closed by default, and a login refusal no longer tells whether the address has an account:
  it answers `401 AUTH_INVALID_CREDENTIALS`
- Magic Query parameters take an underscore (`_page`, `_pageSize`, `_sort=-field`)

[docs/MIGRATION_V4_V5.md](docs/MIGRATION_V4_V5.md) is the full list of breaking changes, with the 5.0 form
beside the 4.x one.

## Install

```sh
npm install @volcanicminds/backend
```

The data layer needs its optional peers, only the ones your engine uses:

```sh
npm install drizzle-orm bcrypt pg                        # Postgres on a server
npm install drizzle-orm bcrypt pg @electric-sql/pglite   # PGlite in process: development and tests
```

`pg` is needed with PGlite too, since one adapter serves both. `drizzle-kit` goes in `devDependencies`: it
generates migrations, it does not run them. Single sign-on needs `openid-client`; tracing needs
`@opentelemetry/sdk-node`, `@fastify/otel` and `@opentelemetry/instrumentation-undici`.

## A minimal server

The entry point, `index.ts`:

```typescript
import { preload, start as startServer } from '@volcanicminds/backend'
import { start as startDataLayer } from '@volcanicminds/backend/db'

await preload() // reads config/general.ts; without it the data layer falls back to its defaults
const layer = await startDataLayer()
await layer.migrations.apply({ locator: 'public' }) // in production a deploy step, before the new code starts
await startServer(layer)
```

With no database, the entry point is one line, `await startServer()`: the core falls back to Null-Object
managers and everything that does not need a row keeps working.

A route, `src/api/hello/routes.ts`, and its controller, `src/api/hello/controller/world.ts`:

```typescript
export default {
  routes: [{ method: 'GET', path: '/', handler: 'world.sayHello' }]
}
```

```typescript
import type { FastifyReply, FastifyRequest } from '@volcanicminds/backend'

export function sayHello(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ message: 'Hello, World' })
}
```

The `.env` needs two signing secrets of at least 32 characters, and the database:

```sh
JWT_SECRET=...
COOKIE_SECRET=...
DATABASE_URL=postgres://user:password@localhost:5432/app   # or CONTROL_ENGINE=pglite
```

Run it with `npx tsx --env-file .env index.ts` and open `http://localhost:2230/hello`.

## Documentation

[llms.txt](llms.txt) is the complete reference, for people and for coding agents: every option, environment
variable, route and contract, with examples and recipes. Where it and the source in `lib/` disagree, the
source wins.

The documents under `docs/` go deeper on one subject each:
[API](docs/API_V5.md), [configuration](docs/CONFIGURATION_V5.md),
[deployment profiles](docs/DEPLOYMENT_PROFILES_V5.md), [schema](docs/SCHEMA_V5.md),
[Magic Query](docs/MAGIC_QUERY_V5.md), [managers](docs/MANAGERS_V5.md),
[authorization](docs/AUTHORIZATION_V5.md), [authentication flows](docs/AUTH_FLOW_V5.md),
[security and MFA](docs/SECURITY_MFA.md), [per-route cache](docs/CACHE.md),
[service layer](docs/ADVANCED_ARCHITECTURE.md), [TypeScript](docs/TYPESCRIPT_GUIDE.md),
[testing](docs/TESTING_V5.md), [tuning](docs/TUNING.md), [Docker](DOCKER.md) and
[coverage](COVERAGE.md).

[volcanic-backend-sample](https://github.com/volcanicminds/volcanic-backend-sample) is a running project
built on this package.

## License

[MIT](LICENSE)
