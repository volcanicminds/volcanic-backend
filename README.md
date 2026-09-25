[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![opensource](https://img.shields.io/badge/open-source-blue)](https://en.wikipedia.org/wiki/Open_source)
[![volcanic-backend](https://img.shields.io/badge/volcanic-minds-orange)](https://github.com/volcanicminds/volcanic-backend)
[![npm](https://img.shields.io/badge/package-npm-white)](https://www.npmjs.com/package/@volcanicminds/backend)
[![CI](https://github.com/volcanicminds/volcanic-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/volcanicminds/volcanic-backend/actions/workflows/ci.yml)

# volcanic-backend

A Node.js framework based on Fastify to build robust APIs quickly, featuring an automatic routing system, integrated authentication, and a powerful data access layer.

> **This branch is `5.0.0-alpha`, and this document describes v5.** The data layer was
> rewritten: the TypeORM one and the `@volcanicminds/backend/typeorm` subpath are gone, and
> the Drizzle one lives behind `@volcanicminds/backend/db` — a subpath that names no engine,
> because in v4 the ORM was part of the public API and changing it broke every consumer.
>
> **Coming from 4.x?** Read [docs/MIGRATION_V4_V5.md](docs/MIGRATION_V4_V5.md) first: v5 is
> breaking on purpose, there is no compatibility branch and no silent translation of a v4
> configuration. Where the framework can tell that a v4 spelling was used, it **refuses to
> start** and names the replacement.
>
> **For production today, use 4.x from `main`.** The contracts are in `docs/SCHEMA_V5.md`,
> `docs/MAGIC_QUERY_V5.md`, `docs/MANAGERS_V5.md`, `docs/AUTHORIZATION_V5.md`,
> `docs/API_V5.md`, `docs/CONFIGURATION_V5.md` and `docs/TESTING_V5.md`; the plan that
> produced them is `EVO_FRAMEWORK.md`.

## What goes in the control plane

> Outside the customer's container sits only what you could publish.

The control plane holds the tenant registry, the platform administrators, identifiers,
counters, status and configuration. It does **not** hold content written or uploaded by a
customer, not even a title. A feature that needs to read across tenants is designed as an
explicit aggregation; it is never solved by moving the data up into the control plane, because
everything that lands there loses the boundary that makes a container deliverable, restorable
and destroyable on its own.

The rule is short on purpose: it is meant to be quotable in a review, where the question is
always the same — could this row be published without harming the customer it belongs to?

## Two layers in one package

`@volcanicminds/backend` ships a **DB-agnostic HTTP core** and an **optional data layer**, cleanly separated:

- **HTTP Core** (`@volcanicminds/backend`) — Fastify wrapper: routing autodiscovery, JSON-Schema validation,
  JWT/cookie auth, a composable login flow, RBAC, scheduler, and a native API (`/auth`, `/users`, `/token`, `/tenants`,
  `/system/*`, `/health`). **Runs with no database.**
- **Data Layer** (subpath `@volcanicminds/backend/db`) — Drizzle underneath, and that is an implementation
  detail rather than a promise: Magic Query, the framework schema, per-tenant containers, migrations and the
  managers you inject. Its deps are **optional peer dependencies**.

The separation is not a diagram, it is **checked in CI**: the core may not import `lib/database/**` or any of
its peer dependencies, and the data layer may import only *types* from the core. A rule that a build enforces
is a rule; one that a document states is a hope.

The layers meet at one seam: `start(decorators)` on the core, into which you inject the **managers** the data
layer returns (or nothing — it falls back to Null-Object defaults). See `llms.txt` **Part 0** for the model and
**Part 12** for end-to-end scenarios (public/private, Bearer/Cookie, with/without DB, single/multi-tenant, with
`@volcanicminds/tools`).

## Feature Matrix

A synthetic overview of the out-of-the-box (OOTB) capabilities of this opinionated package.
✅ = yes · — = no.

| Feature | In `@volcanicminds/backend` | Via `@volcanicminds/tools` | Active on startup | Description |
|---|:---:|:---:|:---:|---|
| **JWT auth** | ✅ | — | ✅ | `@fastify/jwt`. Login/logout, `isAuthenticated`. Signing secret required (`assertSecretStrength`). Access token of `1h` by default |
| **Refresh token** | ✅ | — | ✅ | An opaque credential (`vs1.<routing>.<sid>.<secret>`) against the `session` registry, rotated at every renewal, with reuse detection. In cookie mode an httpOnly cookie limited to the renewal route. Needs a data layer; disable with `JWT_REFRESH=false` |
| **Cookie auth mode** | ✅ | — | ✅ | `@fastify/cookie`, **the default** (`AUTH_MODE=COOKIE`). HttpOnly/SameSite=Strict signed cookies, one pair per plane; needs `COOKIE_SECRET`. The `Authorization` header keeps working for integration tokens |
| **Token revocation** | ✅ | — | ✅ | Three levels: one session (`logout`), every session of a subject, and the `externalId` rotation that invalidates the access tokens already signed |
| **CORS** | ✅ | — | ✅ | `@fastify/cors`. Allowlist from `CORS_ORIGINS`, credentials only against a real allowlist, `v-*` pagination headers exposed |
| **Helmet** | ✅ | — | ✅ | `@fastify/helmet`. Security HTTP headers |
| **Rate limit** | ✅ | — | ✅ | `@fastify/rate-limit`, registered `global:false` → limits only opt-in routes (e.g. MFA) + 404 handler |
| **Central error handler** | ✅ | — | ✅ | Preserves controller status; hides details via `HIDE_ERROR_DETAILS` (default on in prod) |
| **Route autodiscovery** | ✅ | — | ✅ | Convention-based router loader |
| **Schema autodiscovery** | ✅ | — | ✅ | JSON Schema, deep-merge override on matching `$id` |
| **Hooks autodiscovery** | ✅ | — | ✅ | `onRequest` / `onResponse` / `onError` / `preHandler` / `preSerialization` |
| **Middleware** | ✅ | — | ✅ | `isAuthenticated`, `isAdmin`, pre/post auth & forgot-password, auto-loaded |
| **Roles / RBAC** | ✅ | — | ✅ | Per-route roles loader |
| **i18n** | ✅ | — | ✅ | `i18n` package, `global.t` |
| **Logging** | ✅ | — | ✅ | `pino` + `pino-pretty`, `global.log` |
| **Native APIs** | ✅ | — | ✅ | `auth`, `users`, `token`, `health`, `tenants`, `system`, `admin`. `/tool` is gone: it synchronised schemas, and schemas are versioned migrations now |
| **Swagger / OpenAPI** | ✅ | — | — | `@fastify/swagger` + `@fastify/swagger-ui` at `/api-docs`. Enabled by `SWAGGER=true` |
| **Compression** | ✅ | — | — | `@fastify/compress`. Opt-in (`enable`) |
| **Multipart / uploads** | ✅ | — | — | `@fastify/multipart`. Opt-in (`enable`) |
| **Static files** | ✅ | — | — | `@fastify/static`, single or multiple mounts. Opt-in (`enable`) |
| **Raw body** | ✅ | — | — | `fastify-raw-body` for webhooks/signatures. Opt-in (`enable`) |
| **Scheduler / cron** | ✅ | — | — | `@fastify/schedule` + `toad-scheduler`. Enabled by `options.scheduler` |
| **In-memory cache** | ✅ | — | — | LRU+TTL per-route cache (`cache:`), `invalidateCache`. Enabled by `options.cache.enabled` |
| **Manifest endpoint** | ✅ | — | — | `GET /admin/manifest` (tenant plane) and, with tenants, `GET /system/manifest` (platform console), each gated by the `manifest` capability of its catalogue. Enabled by `options.manifest.enabled` |
| **Multi-tenant** | ✅ | — | — | Header or subdomain resolver, and the **token decides** whenever there is one. Enabled by declaring the `tenants` block; a schema, a database or a file per customer |
| **Data layer (Magic Query)** | ✅ | — | — | Drizzle + query builder via subpath `/db`. Optional peer deps (`drizzle-orm`, `pg` or `better-sqlite3`/`@libsql/client`, `bcrypt`) |
| **Schema migrations** | ✅ | — | ✅ | Committed SQL applied in order, versioned **inside each container**. The instance refuses to boot behind its own schema |
| **Login flow** | ✅ | — | ✅ | `/auth/flow/*` and `/system/auth/flow/*`: password, TOTP, email code and OIDC as composable stages, configured per plane in `config/authFlows.ts` ([docs](docs/AUTH_FLOW_V5.md)). Flow state and access log need the data layer |
| **MFA / TOTP** | (policy and flow) | ✅ | — | Enforced by the flow engine, `202` + stage; TOTP implementation via injected `mfaManager`. Policy via `MFA_POLICY`, `SYSTEM_MFA_POLICY` and per tenant |
| **Email sign-in codes** | (flow) | ✅ | — | `email-otp` as identifier or second factor; the code is delivered by an injected `challengeDeliveryManager`, typically on the tools mailer |
| **OIDC single sign-on** | ✅ | — | — | per deployment or per tenant, PKCE and `nonce` always, optional peer `openid-client` |
| **Resumable uploads (TUS)** | (mount) | ✅ | — | TUS route mounted from injected `transferManager` |
| **Mailer** | — | ✅ | — | Email sending via tools |
| **Object storage** | — | ✅ | — | S3 / MinIO storage via tools |
| **AI utilities** | — | ✅ | — | AI helpers (Mastra) via tools |

## Runtime requirements & notable behavior

- **Node.js ≥ 24**, **pure ESM** (`NodeNext`); CommonJS/`require` is not supported. REST-only (no GraphQL).
- `helmet` security headers are enabled by default.
- Startup **fails fast**, and the list of things it refuses is deliberate. A missing or weak signing secret
  (`JWT_SECRET`, and `COOKIE_SECRET` in cookie mode, which is the default): minimum 32
  characters, fatal in production and a warning otherwise. An `AUTH_MODE` that is not `COOKIE` or `BEARER`,
  and cookie mode with the `cookie` plugin disabled. A CORS wildcard with credentials, or a wildcard that arrived by omission
  in production. An engine and tenancy strategy the framework cannot isolate. A control plane behind its own
  schema version. Each of these was, in some deployment, a silent misbehaviour before it was a refusal.

## Changelog

### 5.0.0-alpha

**The data layer was rewritten, and the tenant boundary with it.** Every break, with the new form beside the
old one, is in [docs/MIGRATION_V4_V5.md](docs/MIGRATION_V4_V5.md).

- **Subpath and ORM.** `@volcanicminds/backend/typeorm` becomes `@volcanicminds/backend/db`; TypeORM is
  replaced by Drizzle and the ORM stops being part of the public API. Engines: Postgres, SQLite, libSQL.
  MongoDB is removed — its multi-tenant path was fail-open, working on the whole database with no isolation.
- **Tenant isolation by construction.** A container is chosen by qualifying the tables, not by `SET
  search_path` on a pooled connection: nothing is left on the session, so nothing has to be reset. That closes
  the class of defect where a tenant's `search_path` survived in the pool and a control-plane route listed
  another customer's users.
- **No global connection.** `global.connection`, `global.entity`, `global.repository`, `req.db` and
  `req.runner` are gone. A request is handed `req.control` and `req.tenant`, two distinct types, and a call
  with neither **throws** instead of reading whichever container the pool held.
- **The tenant comes from the token**, and the header only where there is no token. The `resolver` option is
  read for the first time; the `query` resolver is removed.
- **Versioned migrations.** Committed SQL applied in order, recorded inside each container.
  `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` and the whole `/tool` group are gone. A fleet migrator brings every
  tenant forward, refuses to run without a `--snapshot`, and names the containers that failed.
- **One container per tenant**, optionally: a schema, a database or a file each, with an LRU bound checked
  against `max_connections` before the first connection is handed out, and Litestream replication behind a port.
- **Platform identities.** `/system/auth` and `/system/users`: a platform administrator is a `system_user` in
  the control plane, not a row in the `user` table of `public` that only a resolved schema separated from a
  tenant's admin. Impersonation leaves a revocable record instead of a claim in a token.
- **Magic Query v5.** Underscore-prefixed reserved parameters, `_sort=-field`, the `s` suffix dropped and `i`
  added, ranges with `..`, `:raw` removed, and 400 wherever v4 degraded in silence.
- **Uniform authentication answers.** Four distinct login refusals become one `401 AUTH_INVALID_CREDENTIALS`;
  registration on an address already registered answers like a successful one. Those messages were a
  directory of which addresses have accounts here.
- **The session in a cookie, by default.** `AUTH_MODE` defaults to `COOKIE` and requires `COOKIE_SECRET`;
  the header keeps working for integration tokens, the session renews from an httpOnly refresh cookie, and
  the access token lasts `1h` instead of `15d`.
- **Sessions are rows, and the refresh credential rotates.** The refresh token stops being a JWT: it is an
  opaque secret, `vs1.<routing>.<sid>.<secret>`, whose only meaning is a row in the new `session` table of the
  subject's container. Every renewal mints a new one; a spent credential presented outside a short grace
  window closes the whole session (`401 SESSION_REUSE_DETECTED`); `logout` revokes the row instead of clearing
  a cookie; `JWT_REFRESH_SECRET` and `JWT_REFRESH_EXPIRES_IN` are ignored, and the lifetimes are the
  `sessions` block. Refresh tokens issued by v4, or by an earlier 5.0 alpha, no longer renew.
- **The login is a flow.** The one-shot login route, the separate MFA verification route, their `/system`
  twins and the five-minute temporary token are gone: `/auth/flow/*` runs an identify stage and then the stages the subject's roles
  owe, with password, TOTP, an email code and OIDC as built-in methods and a contract for a project's own. The
  MFA policy is a floor the flow engine applies, the platform login answers `401` like the tenant one, and a
  JWT carrying a `role` claim is refused everywhere. Identity providers per deployment or per tenant, links
  on issuer and subject and never on the address alone, and an access log per container
  ([docs/AUTH_FLOW_V5.md](docs/AUTH_FLOW_V5.md), MIGRATION §29).
- **Registration is closed by default.** Who may create an account is decided per tenant inside a set the
  platform allows: `invite` (the default), `approval` or `open` (MIGRATION §28).
- **Defaults that changed on purpose.** CORS reads an allowlist and refuses the insecure pair at boot;
  `HIDE_ERROR_DETAILS` is honoured by every error path; a failed audit write fails the request;
  `req.data()` merges the query string and the body instead of discarding one.

### 4.0.1

**Authorization redesign (breaking).** Full model in [docs/AUTHORIZATION_MODEL.md](docs/AUTHORIZATION_MODEL.md).

- **Roles.** Two protected built-ins remain — `public` and `admin`; **`backoffice` is removed**. A consumer's
  `config/roles.ts` may override only the *labels* of `admin`/`public` (their code and capabilities are locked)
  and add its own roles freely.
- **Capabilities.** Roles may declare `capabilities: string[]`; a route gates with `requireCapability: 'X'`
  instead of a role list. At boot the allowed set becomes `admin` plus every role that declares the capability.
  The framework reserves **`users`**, **`tokens`** and **`manifest`**, and the native surfaces (`/users/*`,
  `/token/*`, `/admin/manifest`) are re-gated to them — so a non-admin operator can be granted user/token
  management or console access without being `admin`.
- **Admin apex.** Only an `admin` may grant the `admin` role (to a user *or* a token), and only with
  `options.allow_multiple_admin`; no capability holder may act on an existing admin subject; the **last admin
  cannot be deleted, demoted or blocked** (never-zero-admin).
- **Boot fail-fast.** A route gated on a role absent from `config/roles.ts` now **aborts startup** (previously it
  was silently disabled).
- **Sovereign founder & genesis.** `/auth/register` **never** creates an admin. Single-tenant instances provision
  the founder at boot from **`ADMIN_EMAIL`** (create / promote / no-op); with no admin and no `ADMIN_EMAIL`,
  startup fails fast. The founder is undeletable/undemotable/unblockable, its email is immutable via the API, and
  its credentials are self-service only. A generated password is written to stdout only, never the logger.

**Migration.** Consumers referencing `backoffice` must re-declare it in `config/roles.ts` (with the capabilities
they need); stop bootstrapping an admin via `/auth/register` and set `ADMIN_EMAIL`; ensure a single-tenant instance
has an admin or `ADMIN_EMAIL` at boot.

### 3.5.0

- **Per-route response cache (OOTB).** Opt in per endpoint with a `cache` prop in `routes.ts`
  (`cache: true` | `<ttlSeconds>` | `{ enabled?, ttl?, keyGroup?, invalidates? }`), also settable at the
  file-level `config.cache` (inherited by every route, overridable per route). Only **GET** responses with a
  **2xx** status are cached; the read runs as a `preHandler` (after auth/roles) and short-circuits on a hit,
  the write as an `onSend` (captures the serialized body + `v-*` headers). The cache key is **scope-safe** —
  isolated by tenant, authenticated subject and role set — so a cached response is never served across
  tenants/users/privileges. Backed by an in-memory **LRU + TTL** store (no external dependency); global
  defaults `options.cache = { enabled, ttl: 3600, maxEntries: 1000 }`. Invalidation is by **key-group**
  (default = the api folder): declaratively via `cache.invalidates: [...]` on a mutating route, or
  imperatively via the exported `invalidateCache(keyGroup?)` / `global.cache` (`invalidate`, `flushAll`,
  `del`, `stats`). The effective config is logged at startup.

### 3.1.0

- **Embedded database (PGlite)** — opt-in `type: 'pglite'` engine: zero-setup, in-process Postgres for
  dev/test/demos, with optional `pgvector`. A real Postgres server stays the production choice. See
  [docs/PGLITE.md](docs/PGLITE.md).
- **Magic Query — case-insensitive by default.** Base text operators (`eq`, `contains`, `starts`, `ends`, `like`
  and negations) now match **case-insensitively** on strings (`?name=mario` finds "Mario"). Convention: base =
  insensitive, `*s` = strict/sensitive, `*i` = insensitive alias. `eq`/`neq` stay type-aware (numbers/booleans/null
  match exactly). Restore the legacy behavior with `caseInsensitiveByDefault: false` (or
  `VOLCANIC_CASE_INSENSITIVE_DEFAULT=false`). _Behavioral change — labeled 3.1.0, no breaking major since v3 is new._
- **New operators**: completed negations (`nstarts`, `nends`, `nlike` + `s`/`i` variants), `nbetween`, `isEmpty` /
  `isNotEmpty`, array `arrayContains` (`@>`) / `arrayContainedBy` (`<@`), and JSONB `jsonHasKey` (`?`) /
  `jsonHasAnyKey` (`?|`) / `jsonHasAllKeys` (`?&`).
- **Operator names are case-insensitive**: `:isEmpty`, `:isempty`, `:ISEMPTY` are equivalent.
- **Security — `forgot-password` is non-enumerable.** `POST /auth/forgot-password` now always answers `200`
  `{ ok: true }` regardless of whether the account exists, is invalid or is blocked (only a missing/invalid
  identifier still returns `400`). Previously a `403` distinguished "not found / invalid / blocked" from a valid
  account, allowing account enumeration. Clients should show a generic "if the account exists, a reset link was
  sent" message. _Behavioral change — a residual timing side-channel remains (the valid path performs a DB write)._
- **Unified error body**: HTTP errors now serialize as `{ statusCode, error, code?, message? }`, and the status is
  preserved across the async error path (previously some `reply.status(4xx).send(new Error())` collapsed to `500`).
  `401` is returned for anonymous callers and `403` for an authenticated subject lacking the role.
- **Security — rate limiting on auth endpoints.** `POST /auth/login`, `/register`, `/forgot-password` and
  `/reset-password` are now throttled per IP to blunt brute-force / credential-stuffing / password-spray (OWASP
  API2/API4). Defaults to 10 requests / 60s, configurable via `AUTH_RATELIMIT_MAX` and `AUTH_RATELIMIT_WINDOW`.
- **Security — Magic Query page-size cap.** A request can no longer pull unbounded rows (`?take=10000000`): `take`/
  `pageSize` are clamped to a maximum (default **100**, OWASP API4). Configure via the data-layer option
  `maxPageSize`, the env `VOLCANIC_MAX_PAGE_SIZE`, or `configureMaxPageSize()`. Set `<= 0` to disable (not advised).
- **Security — no plaintext password via admin update.** `PUT /users/:id` (and any caller of `updateUserById`) can
  no longer set `password`: it was stored in plaintext, bypassing bcrypt and breaking login. `updateUserById` now
  drops `password`; credential changes must go through change-password / reset-password (which hash). `userBodySchema`
  is also `additionalProperties: false` now (drops unexpected fields like `externalId`/`mfaSecret`); `password` is
  still accepted on **create** (hashed by `createUser`).
- **Security — privilege-escalation / mass-assignment fix on `PUT /users/me`.** `currentUserBodySchema` allowed
  extra properties and the controller spread the whole body into the update, so a normal user could send
  `roles: ['admin']` (or `blocked`, `confirmed`, `password`, `externalId`, `mfa*`) and **escalate to admin** /
  overwrite their credential. The schema is now `additionalProperties: false` and the controller whitelists only
  self-editable fields (`username` only in v5: the `user` table has no name columns, and names belong to a
  table of the project's own). (OWASP API3:2023.)
- **`/auth/refresh-token` robustness**: when refresh tokens are disabled (`JWT_REFRESH=false`) the endpoint now
  returns a clean `404` (`code: NOT_FOUND`) instead of throwing an unhandled `500`; it also validates that both
  `token` and `refreshToken` are present (`400`).
- **Security — multi-tenant isolation fix on `/users` and `/token`.** The native user controllers (`find`, `count`,
  `findOne`, `create`, `update`, `remove`, `updateCurrentUser`, admin password reset) and the API-token controllers
  (`find`, `count`, `findOne`, `create`, `update`, `remove`, `block`, `unblock`) did not forward `req.runner`, so in
  multi-tenant mode they queried the global/public schema instead of the resolved tenant schema (cross-tenant
  exposure). They now pass `req.runner` (a no-op in single-tenant mode). `create` (users) also no longer double-saves
  via the active-record `entity.User.save()` (which always hit the global connection). See `npm run test:e2e:mt:pglite`.
- **Router — duplicate-route detection fixed.** The startup check compared a key without a leading slash
  (`GETusers`) against the stored path (`GET/users`), so duplicate `method`+`path`+`version` routes were never
  flagged. They are now detected and reported at load time.
- Internal: the operator catalog moved to `lib/database/typeorm/query/operators.ts`.

## Documentation & Guides

**`llms.txt`** is the exhaustive self-contained guide for humans and LLM agents, written for v5. The focused
documents below go deeper on each subject; where anything disagrees with the package source code, the code
wins.

- **[Tuning](docs/TUNING.md)**: `npm run tune` measures the work factor, the key derivation, the connection budget and the page cost **on the machine that will run them**, and writes the answers down with their provenance.
- **[Migrating from v4](docs/MIGRATION_V4_V5.md)**: every break, why it exists, and the new form beside the old one. Read §1 to §4 before touching a port, and keep §18 and §29 open while porting the login: the routes and the status code changed.
- **[Authentication flows](docs/AUTH_FLOW_V5.md)**: the login as a flow of stages on both planes, the authenticator contract, identity providers, linking, the access log and every refusal code.
- **[Magic Query](docs/MAGIC_QUERY_V5.md)**: the URL-to-SQL grammar, the operator catalogue, and the v4 → v5 correspondence table.
- **[Schema](docs/SCHEMA_V5.md)**: the framework's own tables, what a consuming project must declare, and the one thing it must never redefine.
- **[Configuration](docs/CONFIGURATION_V5.md)**: the `control` and `tenants` blocks, the four supported combinations, and the defaults that changed on purpose.
- **[Managers](docs/MANAGERS_V5.md)** and **[Authorization](docs/AUTHORIZATION_V5.md)**: the injectable contracts, and the capability model with its control/tenant split.
- **[Advanced Architecture](docs/ADVANCED_ARCHITECTURE.md)**: Service Layer pattern, BaseService abstraction, and dependency injection.
- **[Per-route Cache](docs/CACHE.md)**: Opt-in in-memory response cache (LRU + TTL) with a `cache` route prop, scope-safe keys (tenant/subject/roles), and key-group invalidation (`invalidates` + `invalidateCache`).
- **[Schema Customization](docs/SCHEMA_OVERRIDING.md)**: How to extend core schemas (like Login Response) without forking the framework.
- **[Security & MFA](docs/SECURITY_MFA.md)**: the second factor's policy on three levels, how the login asks for it, and the recovery paths.
- **[TypeScript Guide](docs/TYPESCRIPT_GUIDE.md)**: How to properly extend Request types, global scopes, and inject User Contexts.

## Based on

**Volcanic Backend** is a powerful, opinionated, and extensible Node.js framework for creating robust and scalable RESTful APIs. It's built on modern, high-performance libraries like [Fastify](https://www.fastify.io).

The framework provides a comprehensive set of built-in features including a filesystem-based router, JWT authentication, role-based access control, task scheduling, and seamless database integration, allowing developers to focus on business logic rather than boilerplate.

And, what you see in [package.json](package.json).

## Core Philosophy

- **Convention over Configuration**: A clear and consistent project structure for APIs, controllers, and routes simplifies development and reduces boilerplate.
- **Extensibility**: Easily extendable with custom plugins, hooks, and middleware to fit any project's needs.
- **Database Agnostic**: the data layer lives behind `@volcanicminds/backend/db` and the ORM is not part of the API. Postgres, SQLite and libSQL; MongoDB is gone, because a driver that could not be isolated per tenant was a promise the framework could not keep.
- **Failures are visible**: v5 has no silent fallbacks. A query with no container throws instead of reading whichever one the pool held; an audit write that fails fails the request; a filter the engine cannot honour answers 400 instead of quietly returning something else.
- **Feature-Rich**: Out-of-the-box support for JWT authentication, role-based access control (RBAC), automatic Swagger/OpenAPI documentation, and much more.

## Project sample

[Volcanic Backend Sample - GitHub](https://github.com/volcanicminds/volcanic-backend-sample)

## Quick Start

### Installation

The 5 line is a prerelease on the `next` dist-tag; `latest` is still 4.x:

```sh
npm install @volcanicminds/backend@next
```

For database interactions, the data layer is the subpath `@volcanicminds/backend/db`. Install its
optional **peer dependencies**, and only the ones your engine needs:

```sh
npm install drizzle-orm bcrypt pg           # Postgres
npm install drizzle-orm bcrypt better-sqlite3   # SQLite
npm install drizzle-orm bcrypt @libsql/client   # libSQL
```

`drizzle-kit` goes in `devDependencies`: it generates migrations, it does not run them.

### Minimal Working Example

This example demonstrates how to set up a basic server with a single endpoint.

**1. Create your server entrypoint (`index.ts`):**

```typescript
// index.ts
import { preload, start as startServer } from '@volcanicminds/backend'
import { start as startDataLayer } from '@volcanicminds/backend/db'

async function main() {
  // 1. Read config/general.ts into global.config. NOT optional, and forgetting it raises
  //    nothing: the data layer would find no configuration and fall back to its own
  //    defaults — a different database, reached without an error.
  await preload()

  // 2. Open the data layer. It returns the managers; they are values you own, not
  //    singletons imported from a subpath, which is what makes a different implementation
  //    a parameter instead of a patch.
  const layer = await startDataLayer()

  // 3. Bring the control plane to the schema this code expects. In production this is a
  //    deploy step (`npm run db:migrate`); here it makes a clean machine work.
  await layer.migrations.apply({ locator: 'public' })

  // 4. Start the server with those managers as its decorators.
  await startServer(layer)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

**Running with no database at all** is supported and is one line: `await startServer()`. The core falls back
to Null-Object managers, `/auth` answers that it is not implemented, and everything that does not need a row
keeps working.

**2. Define a route (`src/api/hello/routes.ts`):**

```typescript
// src/api/hello/routes.ts
export default {
  routes: [
    {
      method: 'GET',
      path: '/',
      handler: 'world.sayHello'
    }
  ]
}
```

**3. Create the controller (`src/api/hello/controller/world.ts`):**

```typescript
// src/api/hello/controller/world.ts
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'

export function sayHello(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ message: 'Hello, World!' })
}
```

**4. Run your server:**

```sh
npm run dev
```

Now you can visit `http://localhost:2230/hello` and you will see `{"message":"Hello, World!"}`.

## How to upgrade packages

```ts
npm run upgrade-deps
```

## Project Structure

A typical project using `volcanic-backend` follows a convention-based structure to keep your code organized and predictable.

```
.
├── src/
│   ├── api/
│   │   └── products/                  # A feature or resource module
│   │       ├── controller/
│   │       │   └── product.ts         # Business logic for products
│   │       └── routes.ts              # Route definitions for products
│   │
│   ├── config/
│   │   ├── general.ts                 # Settings, plus the `control` / `tenants` blocks
│   │   ├── plugins.ts                 # Configuration for Fastify plugins (CORS, Helmet, etc.)
│   │   ├── roles.ts                   # Custom role definitions
│   │   └── tracking.ts                # Auto tracking changes configuration (sperimental)
│   │
│   ├── schema/
│   │   ├── product.ts                 # Your Drizzle tables, built per container
│   │   └── entry/                     # Static modules drizzle-kit generates from
│   │
│   ├── hooks/
│   │   └── onRequest.ts               # Custom logic for the 'onRequest' lifecycle hook
│   │
│   ├── middleware/
│   │   └── myMiddleware.ts            # Custom middleware functions
│   │
│   ├── schedules/
│   │   └── example.job.ts             # Custom Job schedules (cron, interval)
│   │
│   └── schemas/
│       └── product.ts                 # JSON schemas for validation and Swagger
│
├── migrations/
│   ├── control/                       # Your migrations for the control plane
│   └── tenant/                        # Your migrations for a tenant container
│
├── drizzle.config.ts                  # How your migrations are generated
├── .env                               # Environment variables
└── index.ts                           # Server entrypoint
```

`config/database.ts` is gone: where the data lives is declared in `config/general.ts`, in two blocks that
cannot contradict each other. `src/entities/` is gone with TypeORM — tables are Drizzle now, and they are
built **per container**, because Drizzle prints the schema name into the SQL and that is what makes choosing
a tenant a choice of object rather than a mutation of a pooled connection.

Your migrations live beside the framework's, never merged with them: the runner reads its folder first and
yours after, so a failed container can say whose change broke it.

## Environment (example)

```ruby
NODE_ENV=development

HOST=0.0.0.0
PORT=2230

JWT_SECRET=yourSecret
JWT_EXPIRES_IN=1h

JWT_REFRESH=true
SESSION_IDLE_TTL=2592000
SESSION_ABSOLUTE_TTL=15552000
SESSION_GRACE_SECONDS=10

COOKIE_SECRET=yourCookieSecret

# LOG_LEVEL: trace, debug, info, warn, error, fatal
LOG_LEVEL=info
LOG_COLORIZE=true
LOG_TIMESTAMP=true
LOG_TIMESTAMP_READABLE=true
LOG_FASTIFY=false

SWAGGER=true
SWAGGER_HOST=myawesome.backend.com
SWAGGER_TITLE=API Documentation
SWAGGER_DESCRIPTION=List of available APIs and schemas to use
SWAGGER_VERSION=0.1.0

# MFA
MFA_POLICY=OPTIONAL
MFA_DB_SECRET=aThirdSecretAtLeast32CharactersLong

# Where the data lives. DATABASE_URL wins over the discrete DB_* variables.
DATABASE_URL=postgres://user:password@127.0.0.1:5432/mydb

# Required in production: the origins allowed to call this API.
CORS_ORIGINS=https://app.example.com,https://admin.example.com

# Seeds the FIRST identity, at boot and at no other time.
ADMIN_EMAIL=admin@example.com
```

For docker may be useful set HOST as 0.0.0.0 (instead 127.0.0.1).

## How to run

```ts
npm run dev
npm run start
npm run prod
```

When you execute `npm run dev` the server is restarted whenever a .js/.ts file is changed (thanks to [nodemon](https://www.npmjs.com/package/nodemon))

## How to test (logic)

```sh
npm test                  # every suite: core, data layer, migrations
npm run test:lib          # the core alone
npm run test:db           # the data layer, on SQLite in memory
npm run test:migrations   # the migration runner
npm run test:e2e:mt:pg    # the isolation bench, against a real Postgres
npm run coverage          # measures, and fails under the floor (runs in CI, in the `test` job)
npm run check-all         # lint, types, layer boundary, session state, migration sets, refusals
```

### Every refusal has a test that fires it

`npm run check:refusals` reads every error code the source can answer with — `QUERY_*`,
`TENANT_*`, `SCOPE_*`, `AUTH_*`, `MIGRATION_*`, the boot refusals — and fails when one of them
is named by no test. It is part of `check-all`, so a new refusal arrives with a test or it does
not arrive.

The reason it exists rather than a coverage number: v5 refuses a great deal on purpose, and a
refusal nobody has watched fire is a refusal whose intent is known and whose behaviour is not.
Defect D-03 was exactly that — an anti-spoofing check comparing a field the entity did not
have, in a hook that ran before the one that would have populated it. It never fired, nothing
failed, and the tenant came from a header for two years. Writing this check found one more of
the same kind: `QUERY_DUPLICATE_CONDITION` compared keys of an object, which are unique by
definition, so it could never fire — and a repeated query parameter went through as a joined
string, which is v4's "silently keep the last one" wearing a different hat.

Coverage is measured too (`npm run coverage`) and the thresholds are a **floor against
regression**, not a target: statements 82, lines 82, branches 88, functions 80, against a suite
that reaches 85.15%, 85.06%, 91.49% and 83.23%. It is measured with the monocart backend of `c8`,
because the default one reads a module compiled twice under `tsx` (once as CommonJS, once as ESM)
as two coverages and keeps the last: the same file measured 94.98% alone and 42.58% in the full
suite. What is excluded from the measurement, why, and how the floors are enforced is written
down in [COVERAGE.md](COVERAGE.md).

### The suites that need a real database say so

`test/db` runs on SQLite in memory and needs nothing. The suites that want Postgres **skip** instead of failing
when `DATABASE_URL` is absent, so a green run without that variable does not mean what it looks like. To run
everything:

```sh
docker run -d --name vm-pg -e POSTGRES_USER=volcanic -e POSTGRES_PASSWORD=volcanic \
  -e POSTGRES_DB=volcanic -p 55432:5432 postgres:16-alpine

DATABASE_URL=postgres://volcanic:volcanic@127.0.0.1:55432/volcanic npm test
DATABASE_URL=postgres://volcanic:volcanic@127.0.0.1:55432/volcanic npm run test:e2e:mt:pg
```

The libSQL suite runs offline against a local file. Its **remote** half — a Turso database —
skips unless `LIBSQL_TEST_URL` (and `LIBSQL_TEST_TOKEN`) are set, and says so when it does: a
suite reporting green for something it never reached is worse than one that is honestly
incomplete.

### The isolation bench

`test/e2e-mt-pg` is not a normal suite. It was written **before** any v5 code, against a real Postgres with a
real pool, to state the properties tenant isolation must have: four of its eight tests failed on v4 and pass on
v5. From here on it is a regression gate — if it goes red, something that worked has broken. PGlite cannot host
it, because it exposes a single connection and the whole class of defect it exists to catch is invisible
without a pool.

## Configuration Reference

### Environment Variables

The framework is configured via `.env` variables. Below is a comprehensive list:

| Variable                       | Description                                                             | Required | Default             |
| ------------------------------ | ----------------------------------------------------------------------- | :------: | ------------------- |
| `NODE_ENV`                     | The application environment.                                            |    No    | `development`       |
| `HOST`                         | The host address for the server to listen on. Use `0.0.0.0` for Docker. |    No    | `0.0.0.0`           |
| `PORT`                         | The port for the server to listen on.                                   |    No    | `2230`              |
| `JWT_SECRET`                   | Secret key for signing JWTs.                                            | **Yes**  |                     |
| `JWT_EXPIRES_IN`               | Lifetime of the access token (e.g. `1h`, `15m`). In cookie mode it is also the cookie's `Max-Age`. |    No    | `1h`                |
| `JWT_REFRESH`                  | Enable session renewal.¹ `false` ends the session with the access token. |    No    | `true`              |
| `SESSION_IDLE_TTL`             | Seconds without a renewal before a session ends.                        |    No    | `2592000` (30 d)    |
| `SESSION_ABSOLUTE_TTL`         | Seconds a session may live, however often it renews.                    |    No    | `15552000` (180 d)  |
| `SESSION_GRACE_SECONDS`        | Seconds the just-rotated credential stays acceptable, for tabs that renew together. `0` means no tolerance. |    No    | `10`                |
| `AUTH_FLOW_TTL`                | Seconds a login in progress lives, never extended. Wins over `limits` of `config/authFlows.ts`, as do the three below. |    No    | `600`               |
| `AUTH_OTP_TTL`                 | Seconds a sent sign-in code stays valid.                                |    No    | `300`               |
| `AUTH_OTP_MAX_ATTEMPTS`        | Wrong codes before a login ends. The account is never locked by them.   |    No    | `5`                 |
| `AUTH_OTP_MAX_SENDS`           | Codes sent within one login.                                            |    No    | `3`                 |
| `LOG_LEVEL`                    | Logging verbosity (`trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`). Unset or unknown falls back to the default, which follows `NODE_ENV`. |    No    | `info` in production, `debug` otherwise |
| `LOG_COLORIZE`                 | Enable colorized log output.                                            |    No    | `true`              |
| `LOG_TIMESTAMP`                | Enable timestamps in logs.                                              |    No    | `true`              |
| `LOG_TIMESTAMP_READABLE`       | Use a human-readable timestamp format.                                  |    No    | `true`              |
| `LOG_FASTIFY`                  | Enable Fastify's built-in logger.                                       |    No    | `false`             |
| `BODY_LIMIT`                   | Largest request body Fastify parses, in bytes; also the default `fileSize` of a multipart upload. |    No    | `1048576`           |
| `SWAGGER`                      | Enable Swagger/OpenAPI documentation.                                   |    No    | `false`             |
| `SWAGGER_HOST`                 | The base URL for the API, used in Swagger docs.                         |    No    | `localhost:2230`    |
| `SWAGGER_TITLE`                | The title of the API documentation.                                     |    No    | `Volcanic API Documentation` |
| `SWAGGER_DESCRIPTION`          | The description for the API documentation.                              |    No    |                     |
| `SWAGGER_VERSION`              | The version of the API.                                                 |    No    | `0.0.1`             |
| `SWAGGER_PREFIX_URL`           | The path where Swagger UI is available.                                 |    No    | `/api-docs`         |
| `MFA_POLICY`                   | MFA policy of the deployment, and the **floor** under the others: `OFF` (no new enrolments, whoever has a factor keeps being asked), `OPTIONAL`, `ONE_WAY` (no self-service removal), `MANDATORY` (login forces enrolment, and needs an injected MFA manager or the boot refuses). A value that is not one of the four refuses the boot. |    No    | `OPTIONAL`          |
| `SYSTEM_MFA_POLICY`            | The control plane's own policy, for the operators who administer the platform. It may only tighten `MFA_POLICY`, never loosen it. A tenant does the same in the `config` of its registry row. |    No    | `MFA_POLICY`        |
| `AUTH_CODE_SIZE`               | Length of the generated authorization codes (nanoid).                   |    No    | `10`                |
| `MFA_APP_NAME`                 | Name of the application displayed in Authenticator apps.                |    No    | `VolcanicApp`       |
| `MFA_ADMIN_FORCED_RESET_EMAIL` | Admin email for emergency MFA reset                                     |    No    |                     |
| `MFA_ADMIN_FORCED_RESET_UNTIL` | ISO Date string until which the reset is active                         |    No    |                     |
| `AUTH_MODE`                    | Where the session travels: `COOKIE` (httpOnly cookies, the header for integration tokens only) or `BEARER` (everything in the header and the body). Any other value refuses the boot. |    No    | `COOKIE`            |
| `COOKIE_SECRET`                | Secret for signing the session cookies.                                 | **Yes**² |                     |
| `COOKIE_PATH_PREFIX`           | The path under which a proxy publishes the API when it strips it before forwarding (e.g. `/api`). The refresh cookie is limited to the renewal route as the browser sees it. |    No    |                     |
| `ADMIN_EMAIL`                  | Seeds the first identity at boot, and is read at no other time (see below). | **Yes**³ |          |
| `ADMIN_PASSWORD`               | Password for the founder created from `ADMIN_EMAIL`; if unset, a strong one is generated and printed to stdout. | No |    |
| `HIDE_ERROR_DETAILS`           | Prevent error details (message) from being sent in response. Honoured by every error path, the `onError` hook included. |    No    | `true` (prod)       |
| `CORS_ORIGINS`                 | Comma-separated allowlist of origins allowed to call the API. Credentials are granted only against a real allowlist. | **Yes**⁴ |          |
| `CONTROL_ENGINE`               | Engine of the control plane (`postgres`, `sqlite`, `libsql`, `pglite`). Feeds `control.engine`. |    No    | `postgres`          |
| `DATABASE_URL`                 | Control-plane connection. Wins over the discrete `DB_*` variables. Feeds `control.url`. |    No    |                     |
| `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_PASSWORD` `DB_NAME` | Discrete form of the above.          |    No    | `127.0.0.1` `5432` `vminds` ×3 |
| `DB_POOL_MAX`                  | Control-plane pool size. Feeds `control.pool.max`.                      |    No    | `10`                |
| `DB_POOL_IDLE_MS`              | Milliseconds an idle control-plane connection is kept. Feeds `control.pool.idleTimeoutMs`. |    No    | `30000`             |
| `DB_SCHEMA`                    | Postgres schema of the control plane. Feeds `control.schema`.           |    No    | `public`            |
| `MFA_DB_SECRET`                | Key the MFA secrets are encrypted with. Falls back to `JWT_SECRET`.     |    No    |                     |
| `BCRYPT_COST`                  | Password work factor. **Never below 12**, whatever is written; measure it with `npm run tune`. |    No    | `12`                |
| `TENANT_CONTAINERS_MAX_OPEN`   | LRU bound on live tenant containers.                                    |    No    | `20`                |
| `TENANT_CONTAINERS_DIR`        | Where per-tenant files live (file-per-container engines).               |    No    | `./data/tenants`    |
| `VOLCANIC_MAX_PAGE_SIZE`       | Upper clamp on `_pageSize`.                                             |    No    | `100`               |
| `DESTRUCTION_TOKEN_TTL`        | Seconds a container-destruction request stays valid.                    |    No    | `600`               |
| `IMPERSONATION_TTL`            | Seconds an impersonation token lasts. Hard maximum 14400.               |    No    | `1800`              |
| `RESET_PASSWORD_TOKEN_TTL`     | Seconds a `/auth/forgot-password` token stays usable.                   |    No    | `3600`              |
| `PASSWORD_EXPIRATION_DAYS`     | Days after which a password must be changed. Unset means never. A value that is not a positive number makes every login fail rather than read as "never". |    No    |                     |
| `MANIFEST_DUMP`                | Path: writes the admin manifest there at boot (a CI snapshot, no live backend needed). |    No    |                     |
| `MANIFEST_DUMP_EXIT`           | With `MANIFEST_DUMP`, exit after writing instead of listening.          |    No    | `false`             |
| `MANIFEST_DUMP_PLANE`          | Which console's manifest `MANIFEST_DUMP` writes: `tenant` (`/admin/manifest`) or `control` (`/system/manifest`, only with tenants). |    No    | `tenant`            |

Four of the variables above — `VOLCANIC_MAX_PAGE_SIZE`, `TENANT_CONTAINERS_MAX_OPEN`,
`TENANT_CONTAINERS_DIR`, `DESTRUCTION_TOKEN_TTL` — were documented from the start of v5 and read
by **nobody** until T-9.4 found it. That is defect D-11 in another shape, and the invariant it
breaks is explicit: the declared default is what the code does, and no field is typed,
documented and never read. They are wired now, each through one helper that falls back loudly
rather than silently.

**Removed in v5**, and not renamed: `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` (incompatible with a versioned schema),
`VOLCANIC_CUSTOM_QUERY_OPERATORS` (the `:raw` operator is gone), `VOLCANIC_CASE_INSENSITIVE_DEFAULT` (case
sensitivity is a property of the operator now, so the same URL cannot mean two things on two servers).

² Required in cookie mode, which is the default: unset `AUTH_MODE` and no `COOKIE_SECRET` refuses the boot.

³ Read **only at boot**, to seed the first identity: the application's sovereign founder on a single-tenant
instance, the first platform administrator where a `tenants` block is declared. If one already exists it may be
omitted; with no identity and no `ADMIN_EMAIL`, startup **fails fast**.

⁴ Required in production. v4 shipped `origin: '*'` together with `credentials: true`, which browsers refuse to
honour — so cookie mode never worked cross-origin — and which in bearer mode left the API callable from any page
the user happened to visit. In production a wildcard that arrived by omission **refuses the boot**, and so does
the wildcard-with-credentials pair however it was written; off production both are a warning. A deployment that
really wants a public API writes `CORS_ORIGINS=*`, and gets no credentials with it.

After that first write the variable is never read again. Being the founder is the `is_founder` column of the
user row, inside its own container, so two tenants each have their own and neither inherits the other's
protections. In v4 the check compared the address against this variable at request time, which made the same
address sovereign inside **every** tenant (defect D-27). Changing `ADMIN_EMAIL` afterwards does not move the
sovereignty: a container that already has a founder keeps it, and the boot log says so.
See [docs/AUTHORIZATION_MODEL.md](docs/AUTHORIZATION_MODEL.md).

¹ Renewal also needs a data layer, because the refresh credential is an opaque secret and its meaning is a row
in the `session` table. Without one the renewal routes answer `404` rather than issuing a credential nothing can
consume or revoke. `JWT_REFRESH_SECRET` and `JWT_REFRESH_EXPIRES_IN` are **ignored** since 5.0, and setting
either one logs a warning at boot: the refresh token is no longer a JWT, and its two deadlines live in the row.
See [docs/AUTHORIZATION_V5.md](docs/AUTHORIZATION_V5.md) §9.

## Logging levels

In the .env file you can change log settings in this way:

```ruby
# LOG_LEVEL: trace, debug, info, warn, error, fatal
LOG_LEVEL=debug
LOG_TIMESTAMP=true
LOG_TIMESTAMP_READABLE=false
LOG_COLORIZE=true
```

Log levels:

- **trace**: useful and useless messages, verbose mode
- **debug**: well, for debugging purposes.. you know what I mean
- **info**: minimal logs necessary for understand that everything is working fine
- **warn**: useful warnings if the environment is controlled
- **error**: print out errors even if not blocking/fatal errors
- **fatal**: ok you are dead now, but you want to know why?

a bit of code:

```ts
log.trace('Annoying message')
log.debug('Where is my bug?')
log.info('Useful information')
log.warn(`Hey pay attention: ${message}`)
log.error(`Catch an exception: ${message}`)
log.fatal(`Catch an exception: ${message} even if it's too late, sorry.`)

// use the proper flag to check if the level log is active (to minimize phantom loads)
log.i && log.info('Total commissions -> %d', aHugeCalculation())

// f.e.
log.t && log.trace('print a message')
log.d && log.debug('print a message')
log.i && log.info('print a message')
log.w && log.warn('print a message')
log.e && log.error('print a message')
log.f && log.fatal('print a message')
```

Other settings:

- **LOG_TIMESTAMP** (bool): add timestamp in each line
- **LOG_TIMESTAMP_READABLE** (bool): if timestamp is enabled this specify a human-readable format (worst performance)
- **LOG_COLORIZE** (bool): add a bit of colors

Defaults, see [logger.ts](./lib/util/logger.ts):

```ts
const logColorize = yn(LOG_COLORIZE, true)
const logTimestamp = yn(LOG_TIMESTAMP, true)
const logTimestampReadable = yn(LOG_TIMESTAMP_READABLE, true)
```

## Tokens and secrets

```ruby
JWT_SECRET=yourSecret
JWT_EXPIRES_IN=1h

# Renewal and the session registry (see below)
JWT_REFRESH=true
SESSION_IDLE_TTL=2592000
SESSION_ABSOLUTE_TTL=15552000
SESSION_GRACE_SECONDS=10

# Where the session travels: COOKIE (default) or BEARER
AUTH_MODE=COOKIE
COOKIE_SECRET=super_secret_cookie_key_change_me
```

## Authentication modes: cookie and bearer

`AUTH_MODE` decides where a **session** travels. Integration tokens (`/token`) always travel in the
`Authorization` header, in both modes.

### 1. Cookie mode (`AUTH_MODE=COOKIE`), the default

- Login sets two `HttpOnly`, `SameSite=Strict`, signed cookies (`Secure` in production): the access token,
  `Path=/`, and the refresh token, limited to the renewal route. The body answers `token: null` and
  `refreshToken: null`: no script of the page can read the session, so an XSS cannot carry it away.
- The access cookie lives exactly as long as the token inside it, `Max-Age` read from its `exp`, so
  `JWT_EXPIRES_IN` is the only setting. The refresh cookie carries no token and no `exp`: its `Max-Age` is the
  earlier of the session's two deadlines, read from the row, so the browser never keeps a credential the
  server would already refuse.
- Renewal reads the refresh cookie alone: `POST /auth/refresh-token` with an empty body answers a new access
  cookie **and a new refresh cookie**, because the credential rotates at every renewal. Without a refresh
  cookie it answers `401 REFRESH_REQUIRED`, which is the client's cue to log in.
- The two planes have separate cookies: `auth_token` and `refresh_token` for the tenant plane,
  `control_token` and `control_refresh_token` for the platform (`/system/auth/*`). An operator who
  impersonates a user keeps the platform session that can end the impersonation.
- A login in progress has its own cookie, `auth_flow` (or `control_flow`), signed, `SameSite=Strict` and
  limited to the flow routes, and the 202 body answers `flow: null`. The impersonation token travels in the
  cookie as well (`token: null` in the body).
- The `Authorization` header is read, and accepts **integration tokens only**: a session token presented
  there is refused with `401 CREDENTIAL_CHANNEL`. When a request carries both, the header is the credential.
- **Deployment constraint.** `SameSite=Strict` means the admin and the API must be on the same site, that is
  the same registrable domain (`admin.example.com` and `api.example.com` are; `admin.example.com` and
  `example-api.net` are not), with CORS granting credentials to the admin's origin (`CORS_ORIGINS`). Across
  sites the cookie would need `SameSite=None`, `Secure` and an explicit CSRF defence, which the framework does
  not provide.
- **Best for:** browser applications, the admin included.

### 2. Bearer mode (`AUTH_MODE=BEARER`)

- Login returns `token` and `refreshToken` in the body; every request sends `Authorization: Bearer <token>`.
  A login that owes a further stage answers 202 with `flow`, the flow credential, which the client sends back
  as the `flow` field of the next step's body and never in `Authorization`.
- Renewal sends the refresh credential alone: `{ refreshToken }`. The answer carries a new `token` **and a new
  `refreshToken`**, which the client must store in place of the old one.
- **Best for:** clients that cannot hold a cookie, such as mobile apps and server-to-server sessions. A
  deployment that serves both a browser and such a client picks bearer, or the client keeps a cookie jar.

### The session behind both modes

In both modes the refresh credential is **opaque**, `vs1.<routing>.<sid>.<secret>`, and it is not a token that
verifies: it names a row in the `session` table of the subject's container, and only the SHA-256 of its secret
is stored there. That is what makes a renewal something the server can *consume*. Every renewal writes a new
secret and keeps the spent one for `SESSION_GRACE_SECONDS`, so two browser tabs renewing in the same instant
are both served; the same spent credential presented later is a stolen copy by definition, and the answer is
`401 SESSION_REUSE_DETECTED` with the whole session revoked. A session ends by inactivity (`SESSION_IDLE_TTL`)
or when it reaches its absolute lifetime (`SESSION_ABSOLUTE_TTL`), whichever comes first, and the second one
never moves.

Revocation has three levels, from the everyday to the emergency: `/auth/logout` revokes the session the caller
is holding; `/auth/invalidate-tokens` revokes **every** session of that user and then rotates their
`externalId`, which also invalidates the access tokens already signed. The rotation stays available because a
compromised account needs it, but it is no longer the only way to end a session, and it is no longer the
routine: `externalId` is a public identifier that integrations store.

A caller manages its own sessions: `GET /auth/sessions` answers where the account is logged in, one row each
with `sid`, `current`, the two deadlines, `ip` and `userAgent` and no credential of any kind, and
`DELETE /auth/sessions/:id` closes one of them. A `sid` that belongs to somebody else answers the same `404`
as one that does not exist, because telling the two apart would make the identifier an oracle, and closing the
session you are speaking from is simply a logout. The platform has the same pair under `/system/auth/sessions`.
Where there is no registry, both answer `404`.

Expiry refuses a session; it does not delete its row. That is housekeeping, and it runs by hand or by itself:

```sh
npx volcanic sessions --purge             # the control plane
npx volcanic sessions --purge --tenants   # and every active container
npx volcanic access-log --purge --tenants # the access log, past 90 days (tenant) and 180 (platform)
```

The command refuses to do anything without `--purge`, since removing rows is all it does, and the renewal
purges opportunistically on about one call in fifty so that an unattended deployment does not grow the table
for ever. A revoked session is not removed by the revocation: it goes when its own clocks run out, so the
record of when it ended, and why, outlives it.

Without a data layer there is no registry, and therefore no renewal at all: the routes answer `404` instead of
issuing a credential nobody could ever revoke. The mechanism in full is in
[docs/AUTHORIZATION_V5.md](docs/AUTHORIZATION_V5.md) §9.

**Example**: `JWT_SECRET` can be generated with a command like `openssl rand -base64 64`

## Swagger

In the .env file you can change swagger settings in this way:

```ruby
SWAGGER=true
SWAGGER_HOST=localhost:2230
SWAGGER_TITLE=Volcanic API Documentation
SWAGGER_DESCRIPTION=List of available APIs and schemes to use
SWAGGER_VERSION=0.1.0
SWAGGER_PREFIX_URL=/documentation
```

## Fastify modules

Under the folder `src/config` is possible add a file `plugin.ts` where you can activate/customize some modules in this way:

```ts
// src/config/plugins.ts
export default [
  {
    name: 'cors',
    enable: false,
    options: {}
  },
  {
    name: 'rateLimit',
    enable: false,
    options: {}
  },
  {
    name: 'helmet',
    enable: false,
    options: {}
  },
  {
    name: 'compress',
    enable: false,
    options: {}
  },
  {
    name: 'multipart',
    enable: false,
    options: {}
  },
  {
    name: 'rawBody',
    enable: false,
    options: {}
  }
]
```

Here the plugins used:

```js
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import compress from '@fastify/compress'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import rawBody from 'fastify-raw-body'
```

When `multipart` is enabled, the framework applies ceilings under whatever `options` says:
`limits: { fileSize: BODY_LIMIT, files: 10, fields: 50, parts: 60 }`. Any of them set in
`options.limits` wins.

## The container of a request (`req.control`, `req.tenant`)

A request is **handed** the container it works on. It never reaches for one.

| | |
|---|---|
| `req.control` | the control plane: the tenant registry and the platform identities. Present whenever a data layer is loaded |
| `req.tenant` | this request's tenant container. Absent on a single-tenant deployment |
| `req.tenantInfo` | the registry row of that tenant. A record, never a connection |

They are **two different types**, so passing a tenant handle where the control plane is required does not
compile. Application code wants one line:

```typescript
import { dataContext } from '@volcanicminds/backend'

const container = dataContext(req)   // the tenant container, or the control plane where that is the answer
const { headers, records } = await myService.on(container).findAll(...)
```

`dataContext` is the framework's own choice, exported so an application makes it the same way. Do **not**
write it out as `req.tenant ?? req.control`: that expression looks equivalent and is not. It gives a tenant
route that lost its container the control plane instead of an error, which is the defect below with a newer
spelling. `dataContext` gives the control plane to a route that declared `scope: 'control'` and to every
route of a deployment with no `tenants` block, and throws `NoDataContextError` in the one case that remains.

**And there is no third answer.** In v4 this was `req.db`, an `EntityManager` that code could do without: a
call with no context fell back to `global.connection`, which meant reading whichever container the pool
happened to hold. That fallback is defect D-01, and it did not read the wrong rows in theory — the tenant's
`search_path` survived in the pool, so a route on the control plane could list another customer's users. In v5
there is no global to fall back to: a manager called with nothing **throws**.

Reaching inside a handle — for your own tables, or for the query an ORM has no business expressing — goes
through one door:

```typescript
import { access } from '@volcanicminds/backend/db'

const { db, dialect, locator, execute, transaction } = access(container)
```

`locator` is the load-bearing field: it is the schema (or the file) this handle addresses, and it is what your
own table objects must be built for.

---

## Core Concepts: Routes and Controllers

The routing system is one of the core strengths of the framework. It's file-system based, meaning the framework automatically discovers and registers any `routes.ts` file within the `src/api/` directory.

## Routes

At its simplest, a route needs only a `method`, `path`, and `handler`. The handler is a string that points to a function in a controller file.

Minimal setup (routes.ts):

```ts
export default {
  routes: [
    {
      method: 'GET',
      path: '/',
      handler: 'myController.test'
    }
  ]
}
```

Some notes:

- It's possible define a generic **config** (optional).
- It's possible define a **config** for a specific route (optional).
- It's possible define a list of **roles** (optional).
- It's possible define a list of **middleware** (optional).

```ts
// src/api/example/routes.ts
export default {
  config: {
    title: 'Example of routes.ts',
    description: 'Example of routes.ts',
    controller: 'controller',
    tags: ['user', 'code'], // swagger
    enable: true,
    deprecated: false, // swagger
    version: false // swagger
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [],
      handler: 'demo.user',
      middlewares: ['global.isAuthenticated'],
      config: {
        enable: true,
        title: 'Demo title', // swagger summary
        description: 'Demo description', // swagger
        tags: ['user', 'code'], // swagger
        deprecated: false, // swagger
        version: false, // swagger
        response: {
          200: {
            $description: 'Successful response',
            type: 'object',
            properties: {
              id: { type: 'number' }
            }$
          }
        } // swagger
      }
    }
  ]
}
```

**Securing a Route with Roles:**
You can easily protect routes using Role-Based Access Control (RBAC). The framework includes built-in roles (`public`, `admin`) and allows you to define your own.

```typescript
{
  method: 'POST',
  path: '/',
  handler: 'product.create',
  roles: [roles.admin] // Only users with the 'admin' role can access this
}
```

Alternatively, gate by **capability**: the allowed set becomes `admin` plus every role that declares it. The
framework reserves `users`, `tokens` and `manifest`; a consumer grants its own capabilities to its roles in
`config/roles.ts`.

```typescript
{
  method: 'GET',
  path: '/',
  handler: 'product.find',
  requireCapability: 'catalog' // admin, or any role that declares the `catalog` capability
}
```

**Declaring which plane a route acts on:**
By default a route runs **inside the tenant**, which is the safe default. A route that acts on the platform
itself says so:

```typescript
{
  method: 'GET',
  path: '/',
  handler: 'tenant.list',
  scope: 'control'          // the control plane: the registry, the platform identities
}
```

v4 spelled this `config: { tenantContext: false }`, and v5 does not translate it: the router collects it with
the other integrity errors and **the process fails to start**, naming the replacement. Translating silently
would not produce an error, it would produce an answer from the wrong container.

**Adding Middleware:**
Apply custom logic before your controller is executed using middleware. The framework comes with `global.isAuthenticated` to ensure a user is logged in.

```typescript
{
  method: 'GET',
  path: '/:id',
  handler: 'product.findOne',
  middlewares: ['global.isAuthenticated'] // Requires a valid JWT, accessible to any role
}
```

**Documenting with Swagger (`config`):**
The `config` object allows you to enrich your route with information for the automatically generated Swagger/OpenAPI documentation.

```typescript
{
  method: 'GET',
  path: '/:id',
  handler: 'product.findOne',
  middlewares: ['global.isAuthenticated'],
  config: {
    title: 'Find a Product',
    description: 'Retrieves a single product by its unique ID.',
    params: { $ref: 'onlyIdSchema#' }, // References a JSON schema for validation
    response: {
      200: {
        description: 'Successful response',
        $ref: 'productSchema#'
      }
    }
  }
}
```

## Controllers

Controllers contain the functions that handle requests. The `req` object is enriched with helpers to simplify data access.

```ts
// src/api/example/controller/demo.ts
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'

export function user(req: FastifyRequest, reply: FastifyReply) {
  reply.send(req.user || {})
}
```

Useful methods / objects:

- `req.user` to grab **user** data (validated and linked by JWT).
- `req.data()` to grab **query and body** parameters merged, the body winning on a key present
  in both. In v4 it returned one source *or* the other, so an unrelated query parameter made
  the whole body disappear (defect D-29).
- `req.queryData()` / `req.bodyData()` to read one source alone, for a handler that must not be
  steerable from the URL.
- `req.parameters()` to grab **params** data.
- `req.roles()` to grab **Roles** (as `string[]`) from `req.user` if compiled.
- `req.hasRole(role:Role)` to check if the **Role** is appliable for `req.user`.

### Advanced data access: `req.data()` and your own tables

`req.data()` gives a controller the caller's whole query, merged from the query string and the body. Handed to
the data layer it becomes a real SQL query with filters, sorting and pagination — that is the Magic Query, and
its grammar is in [docs/MAGIC_QUERY_V5.md](docs/MAGIC_QUERY_V5.md).

```typescript
// src/api/products/controller/product.ts
import { FastifyReply, FastifyRequest, dataContext } from '@volcanicminds/backend'
import { access, executeFind } from '@volcanicminds/backend/db'
import { tablesFor } from '../../../tables/index.js'

export async function find(req: FastifyRequest, reply: FastifyReply) {
  // The container this request works on. There is no fallback: a route that arrives here
  // without one has lost its context, and reading "whichever container the pool last
  // touched" is the defect v5 exists to remove. `dataContext` throws in that case, which is
  // why it is a call and not `req.tenant ?? req.control` written out.
  const container = dataContext(req)

  const { db, dialect } = access(container)

  // Your table, built FOR THIS CONTAINER: Drizzle prints the schema name into the SQL, so a
  // table object is the choice of container. Cache them keyed by locator — two tenants
  // differ in nothing else, and a cache that ignores it hands tenant B tenant A's schema.
  const { product } = tablesFor(container)

  const { headers, records } = await executeFind({ db }, product, req.data(), {
    dialect,
    // Never returned, and never filterable either: filtering a hash is an oracle.
    sensitiveFields: ['secret'],
    // A restriction the caller cannot relax. It is AND-ed after everything the URL asked
    // for, `_logic` included, so no expression a client can write reaches around it.
    extraWhere: onlyMine(req)
  })

  // v-total, v-count, v-page, v-pageSize, v-pageCount
  return reply.headers(headers).send(records)
}
```

That one function answers a wide variety of requests with no extra code:

- `GET /products?_pageSize=10`
- `GET /products?_sort=-price,name`
- `GET /products?name:containsi=widget&price:ge=100`
- `GET /products?status:eq[a]=active&price:ge[b]=100&_logic=a OR b`

**What changed from v4, and it is not a rename.** The reserved parameters carry an underscore
(`_page`, `_pageSize`, `_sort`), so a column named `page` is a column and not a directive. Sorting is
`_sort=-price` and not `sort=price:desc`, which reused the colon that separates a field from its operator.
Operator names lost the `s` suffix and gained `i` for case-insensitivity — in v4 the base form was
case-sensitive or not depending on a server environment variable, so the same URL answered differently on two
installations of the same product. Ranges are `from..to`, because `:` collided with every ISO timestamp and
the malformed condition was silently dropped. `:raw` is gone: behind an environment flag it was SQL injection.

The full v4 → v5 table is in [docs/MAGIC_QUERY_V5.md](docs/MAGIC_QUERY_V5.md) §9.

**Nothing degrades in silence.** An unknown field, an unknown operator, a malformed range, an empty value, a
filter on a sensitive field, a `_logic` that does not parse, an operator the engine cannot honour: each one is
a **400 with a code**, where v4 skipped the condition, or fell back to an AND of everything, or searched for
the literal string `notFound`. Answering a different question than the one asked is worse than answering with
an error.

## Roles

By default, there are two built-in roles:

- **public** — the implicit anonymous role; routes with `roles: []` are open to everyone.
- **admin** — **global superuser**: `admin` is implicitly added to every route's allowed roles, so an admin can
  access any endpoint (even those restricted to other roles). This is by design.

Roles may also carry **capabilities** — the framework reserves `users`, `tokens` and `manifest` — so a
consumer-defined role can be granted a native surface (user or token management, or loading the admin console)
without being `admin`. Gate a route with `requireCapability` instead of a role list; at boot the allowed set
becomes `admin` plus every role that declares the capability. The `admin` apex is protected: only an admin can
grant the `admin` role (and only with `allow_multiple_admin`), no capability holder can act on an admin subject,
and the instance never boots with zero admins. The sovereign founder is provisioned at boot from `ADMIN_EMAIL`,
and from then on it is the `is_founder` column of that row, not a comparison against the environment.
See `docs/AUTHORIZATION_MODEL.md`.

> **Authorization responses:** a request with no authenticated subject gets **401** (must log in); an
> authenticated user lacking the required role gets **403**. Error bodies follow a single shape:
> `{ statusCode, error, code?, message? }`.

In this way you can add custom roles:

```ts
// src/config/roles.ts
import { Role } from '@volcanicminds/backend'

export const roles: Role[] = [
  {
    code: 'customer',
    name: 'Customer',
    description: 'Customer role'
  }
]
```

You can use something like this to specify which roles (routes.ts) can recall some routes:

```ts
roles: [roles.admin, roles.public]
```

## Database (data layer)

The data layer is the subpath **`@volcanicminds/backend/db`**. It turns an HTTP query string into a real SQL
query, owns the framework's own tables, and opens the container a request works on.

The subpath names no engine on purpose. In v4 it was `/typeorm`, so the ORM was part of the public API and
replacing it broke every consumer. What lives behind it is Drizzle today and is nobody's business tomorrow.

```ts
import { start, access, executeFind, executeCount, uuidv7 } from '@volcanicminds/backend/db'
```

Install its optional **peer dependencies**, only the ones your engine needs:

```sh
npm install drizzle-orm bcrypt pg                # Postgres
npm install drizzle-orm bcrypt better-sqlite3    # SQLite
npm install drizzle-orm bcrypt @libsql/client    # libSQL
```

The full options are in [docs/CONFIGURATION_V5.md](docs/CONFIGURATION_V5.md), the tables in
[docs/SCHEMA_V5.md](docs/SCHEMA_V5.md), the query grammar in
[docs/MAGIC_QUERY_V5.md](docs/MAGIC_QUERY_V5.md). The essentials are below.

### Where the data lives

Two declared blocks, and no flag. `control` says where the platform's own data is; **declaring `tenants` is
what turns tenancy on**, so a flag and a strategy can no longer contradict each other.

```ts
// src/config/general.ts
export default {
  name: 'general',
  options: {
    control: {
      engine: 'postgres',            // 'postgres' | 'sqlite' | 'libsql'
      url: process.env.DATABASE_URL,
      schema: 'public',              // Postgres only: explicit, never inferred
      pool: { max: 10 }
    },

    // Absent = single tenant. This is most projects.
    tenants: {
      strategy: 'schema',            // 'schema' | 'container'
      engine: 'postgres',
      resolver: 'header',            // 'header' | 'subdomain'
      headerKey: 'x-tenant-id',
      containers: { maxOpen: 20, idleTimeoutMs: 300_000, poolMax: 2 }
    }
  }
}
```

The merge over the framework defaults is **deep**: declaring one key inside `tenants` no longer erases its
siblings, which in v4 is how `multi_tenant: { enabled: true }` silently discarded the resolver.

**Four supported combinations**, checked at boot by the capability matrix. Anything else logs fatal and exits:
a deployment the framework cannot isolate must not start, because the alternative is starting and mixing two
customers' rows.

| `control.engine` | `tenants` | Meaning |
|---|---|---|
| `postgres` | absent | single tenant |
| `postgres` | `strategy: 'schema'`, `engine: 'postgres'` | many tenants, one database, a schema each |
| `postgres` | `strategy: 'container'`, `engine: 'postgres'` | one database per tenant |
| `postgres` | `strategy: 'container'`, `engine: 'sqlite'` / `libsql` | one file per tenant |
| `sqlite` / `libsql` | absent, or `strategy: 'container'` | serverless processes: CLI, agents, desktop |

MongoDB is gone. Its multi-tenant path was fail-open — the context switch logged a warning and returned, and
the caller worked on the whole database with no isolation at all.

### Your own tables

The framework declares its tables and knows nothing about yours. You declare them in your own schema module,
and you build them **for the container the request is on**:

```ts
// src/tables/pg.ts
import { pgSchema, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { uuidv7 } from '@volcanicminds/backend/db'

const tableFactory = (schemaName: string) =>
  (schemaName && schemaName !== 'public' ? pgSchema(schemaName).table : pgTable)

export function appTables(schemaName: string) {
  const table = tableFactory(schemaName)
  return {
    product: table('product', {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      name: text('name'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      deletedAt: timestamp('deleted_at', { withTimezone: true })
    })
  }
}
```

```ts
// src/tables/index.ts — one cache, keyed by locator
const cache = new Map<string, ReturnType<typeof appTables>>()

export function tablesFor(handle: DataHandle) {
  const { locator } = access(handle, 'tablesFor')
  const key = locator || 'public'
  if (!cache.has(key)) cache.set(key, appTables(key))
  return cache.get(key)!
}
```

**Why a factory and not a module of constants.** Drizzle prints the schema name into the SQL it builds —
`select … from "tenant_acme"."product"` — so choosing a container is choosing a **table object**, not mutating
a connection. Nothing is left on the session, so nothing has to be reset before the connection goes back to
the pool. That is the whole of defect D-01, designed out rather than patched.

**And the cache key must be the locator.** Two tenants differ in nothing else; a cache that ignores it hands
tenant B the object naming tenant A's schema, which is the same defect rebuilt in application code.

**Never redefine a framework table.** If `user` lacks a field your application needs, add your own table keyed
by `user.id`. Subclassing the framework's entity was the v4 way and it collides with every future framework
migration — at upgrade time, on a deployment already in production.

### Query string guide

**Reserved parameters** carry an underscore, so a column called `page` is a column:

| | |
|---|---|
| `_page` | 1-based. `_page=0` answers 400 |
| `_pageSize` | default 25, clamped to `VOLCANIC_MAX_PAGE_SIZE` (100). The applied value comes back in `v-pageSize` |
| `_sort` | comma-separated, a leading `-` is descending: `_sort=-createdAt,name`. An unknown field answers 400 |
| `_fields` | projection: `_fields=id,name` |
| `_relations` | relations to join, dot notation for depth |
| `_logic` | boolean expression over aliased conditions |
| `_withDeleted` | only where the route declares `allowWithDeleted` |

**Filtering** is `field[:operator][alias]=value`; omitting the operator means `:eq`.

**The naming rule has no exceptions**: the base form is **case-sensitive**, the suffix `i` makes it
insensitive, the prefix `n` negates it. `:contains` / `:containsi` / `:ncontains` / `:ncontainsi`. In v4 the
base form was insensitive or not depending on a server environment variable, so one URL returned different
results on two installations of the same product; that switch is removed, and case sensitivity is now visible
in the URL.

| Operator | Meaning |
|---|---|
| `:eq` `:neq` `:eqi` `:neqi` | equality, sensitive and insensitive |
| `:in` `:nin` | set membership, comma-separated |
| `:gt` `:ge` `:lt` `:le` | comparison |
| `:between` `:nbetween` | inclusive range, written `from..to` |
| `:contains` `:starts` `:ends` `:like` (+ `i` / `n` variants) | text matching |
| `:null` | `:null=true` / `:null=false` |
| `:empty` | `= ''` / `<> ''`, text columns |
| `:arrayContains` `:arrayContainedBy` `:arrayOverlaps` | Postgres arrays |
| `:jsonHasKey` `:jsonHasAnyKey` `:jsonHasAllKeys` | Postgres JSONB |

**Escaping is mandatory and automatic.** For `contains`, `starts` and `ends` the value is user data: `%`, `_`
and the escape character are escaped before the pattern is built. In v4 they were not, so
`amount:contains=50%` quietly searched for anything starting with `50`. For `:like` the wildcards are the
caller's intent and stay.

**Complex boolean logic** with `_logic`, over aliased conditions:

```text
# active OR expensive
?status:eq[a]=active&price:ge[b]=100&_logic=a OR b

# (active from Italy) OR (pending from Germany)
?status:eq[s1]=active&country:eq[c1]=IT&status:eq[s2]=pending&country:eq[c2]=DE&_logic=(s1 AND c1) OR (s2 AND c2)
```

When `_logic` is present **every** condition must carry an alias and appear in the expression. The framework
refuses a half-aliased query rather than guessing which conditions it meant.

**Nothing degrades in silence.** Each of these answers **400 with a code**, where v4 answered a different
question: an unparseable `_logic` (v4 fell back to an AND of everything), a range written with `:`
(v4 split it into five parts and dropped the condition), an unknown sort field (v4 skipped it), an empty
value (v4 searched for the literal `notFound`), a filter on a password hash (v4 allowed it, and it was an
oracle), an operator the engine cannot honour (400 `QUERY_OPERATOR_NOT_SUPPORTED_BY_ENGINE`, named, never
emulated with a slower approximation).

**`:raw` is removed, with no replacement by design.** It interpolated a caller-supplied SQL fragment into the
query; with a tenant container in reach that is a way across the boundary. The environment flag that gated it
is gone too.

### Multi-tenancy

**The tenant comes from the token.** The header or the subdomain resolves a tenant only for requests that
carry no token — login and public routes — and only one of the two is consulted: the configured one. In v4 the
`resolver` option was typed, documented and never read: the header decided, always, and the anti-spoofing check
meant to catch a mismatch was dead code comparing a field the entity did not have.

| Situation | Answer |
|---|---|
| nothing names a tenant, and tenancy is on | 400 `TENANT_REQUIRED` |
| the tenant is unknown **or suspended** | 404 — the same answer for both, so the registry cannot be probed from outside |
| the token's `tid` disagrees with the resolved tenant | 403 `TENANT_MISMATCH` |
| a control token used inside a tenant, or the reverse | 403 `SCOPE_MISMATCH` |
| the container is behind its schema version | 503 `SCHEMA_BEHIND`, for that tenant alone |

A tenant identifier in a query string is gone: it ends up in access logs, `Referer` headers and browser
history.

**There is no context to switch.** `switchContext` and `runInTenantContext` do not exist, because choosing a
container is no longer a session change: a background job **declares its plane** and receives the matching
handle. See [Where a job runs](#where-a-job-runs).

### Sensitive fields

`password`, `mfaSecret`, `resetPasswordToken` and `confirmationToken` are never returned and — new in v5 —
**never filterable either**. Filtering a hash is an oracle: it answers questions about a value nobody is
allowed to read. Pass `sensitiveFields` in the query options to extend the list for your own tables.

### API reference

| | |
|---|---|
| `start(options?)` | opens the data layer; returns the managers, the provider, `migrations` and `migrateTenants`. Reads `global.config.options` when called with nothing |
| `access(handle)` | the inside of a handle: `db`, `dialect`, `tenantId`, `locator`, `execute`, `transaction` |
| `executeFind(handle, table, params, options)` | find and count in one call: `{ records, headers }` |
| `executeCount(handle, table, params, options)` | how many rows match, ignoring the page |
| `parseQuery(table, params, options)` | the translation alone, for a query you assemble yourself |
| `uuidv7()` | a time-ordered identifier, minted in process: no round trip to find a free one |
| `encrypt` / `decrypt` | AES-256-GCM with per-record derivation. **Async** in v5: the v4 pair blocked the event loop for 82 ms per call, on the MFA login path |

`QueryOptions` carries `dialect`, `sensitiveFields`, `maxPageSize`, `defaultPageSize`, `allowWithDeleted`,
`allowedRelations`, `logicLimits` and **`extraWhere`** — a condition AND-ed after everything the URL asked for,
`_logic` included, for row-level security a caller cannot argue with.

### Useful scripts

- `node generate-hash.js <my-string>` — generate a bcrypt hash for a given string (passwords / seeding / testing).

## Migrations

The schema of every container is versioned. There is no synchronise-at-startup and no
`POST /tool/synchronize-schemas`: both are incompatible with a schema that has a version, and
both are gone in v5.

```sh
npm run db:generate                 # control, Postgres: registry, platform identities, app tables
npm run db:generate:tenant          # tenant, Postgres: what lives inside a customer's container
npm run db:generate:sqlite          # the same control set, in SQLite's language
npm run db:generate:tenant:sqlite   # the same tenant set, in SQLite's language
```

`drizzle-kit` emits **plain SQL** into `lib/database/migrations/<set>/<dialect>/`, and it is
committed and reviewed like any other code: what runs against a customer's database is what a
reviewer reads, in the language the database speaks. Your own tables' migrations go in
`./migrations/<set>/<dialect>/` in your project; the framework applies both, its own folder
first.

### Two dialects, because the SQL is genuinely different

`pg` and `sqlite` (libSQL reads the `sqlite` set — it speaks the same language). A
`timestamp with time zone` is an integer of epoch milliseconds there, a `boolean` is 0/1, an
array is JSON text, and `USING btree` is nothing at all. Translating one into the other on the
way to the database would put a statement **nobody has read** in front of a customer's data,
which is the whole reason migrations are committed SQL rather than a description of a change.

The two dialects of a set carry the **same migration names**, so a review pairs them up and
`npm run check:migration-sets` fails when one gains a migration the other does not. That check
is the point: a migration added to Postgres and forgotten on SQLite breaks nothing at all until
someone deploys the serverless combination, and then it breaks on the first query against a
table that was never created.

A set that does not exist for the engine in use is **fatal**, never an empty set applied
successfully. "This container has nothing pending" and "no migrations exist for this engine"
are different facts, and answering the second with the first reports success to a deployment
whose tables were never created.

### Two sets, because they have different lives

| Set | Contains | Applied |
|---|---|---|
| `control` | the tenant registry, the platform identities, the impersonation log, **and** the application tables (they live here when there is no `tenants` block) | **once**, `npm run db:migrate` |
| `tenant` | the application tables and the container's own audit trail. Nothing about the platform | **once per container**, by provisioning and by the fleet migrator |

The tables that exist in both (`user`, `token`, `change`, `session`, `migration`) are **duplicated**, on
purpose: the two sets never share a file. A shared migration would make "two sets" a naming
convention, and one edit would move a customer's container and the registry together whether
or not that was the intent. `npm run check:migration-sets` enforces it in CI, including that
no tenant container ever gains a copy of the registry.

```sh
npm run db:migrate           # the control plane, once
npm run db:migrate -- --dry  # list what would be applied, touch nothing
```

### The fleet migrator

Tenant containers are migrated N times, so they get their own command:

```sh
npx volcanic migrate --tenants --snapshot rds:prod-2026-09-08T10:00Z --dry-run
npx volcanic migrate --tenants --snapshot rds:prod-2026-09-08T10:00Z --concurrency 4
npx volcanic migrate --tenants --snapshot ... --only acme,globex   # retry, or a staged rollout
npx volcanic migrate --tenants --snapshot ... --target 0002_add_tags
```

The same thing from a script or a job of your own, because the command is a thin wrapper
around it:

```ts
const layer = await start(config.options)
const result = await layer.migrateTenants({ snapshot: 'rds:...', dryRun: true, concurrency: 4 })
```

**`--snapshot` is required, and the run refuses to start without it.** It is the reference you
would restore from, it is recorded in the run log, and a fleet migration without one is an
irreversible operation performed hopefully.

What the run guarantees, and why each one is there:

| | |
|---|---|
| **Run `--dry-run` first** | it is the only step that costs nothing |
| **Failures are named** | the exit code is non-zero and the output lists *which* containers failed and what the database said. "3 of 100 failed" is never the end of the question |
| **One failure does not stop the run** | the other 97 are migrated |
| **Interrupting is supported** | Ctrl-C finishes the containers in flight and reports what it did not reach |
| **Resuming is just running it again** | the applied migrations are recorded inside each container, so a second run picks up where the first stopped |
| **A container being migrated elsewhere is skipped** | an advisory lock per container, tried and not waited on: blocking would turn two operators into a deadlock with a queue |
| **Concurrency defaults to 2** | a hundred parallel migrations saturate the database they are migrating. The maximum is 16 |

The applied version is recorded in a `migration` table **inside each container**, never in a
central one: when a tenant is restored from a backup its schema version has to travel back
with it.

### Forward only, and why

There is no `down`. `drizzle-kit` does not generate one, and a `down` on a destructive
migration restores the shape and not the data, which is a promise that fails exactly when it
is called on.

Reversibility lives in the release, and the rule is **expand / contract**:

1. the migration that ships with a release is **additive**: a new column, a new table, a
   double write. The old code still works against it;
2. the destructive half (dropping the old column, removing the old table) ships in a **later**
   release, once the new code is running everywhere.

So rolling back means deploying the previous code, with the data untouched. A release that
adds and drops in one step is a release that cannot be rolled back, whatever the migration
tool claims.

### The instance refuses to serve a schema it does not match

At boot the framework compares the version the code expects with the one recorded in the
control plane. If they differ it **does not start**, and the message says what to run. This is
not a warning by design: a process that boots against an older schema does not crash, it
answers requests and writes rows into columns that mean something else, and it is found out
later by the data.

A tenant container is treated differently on purpose. It is checked when the tenant is
resolved, and a container that is behind answers **503 `SCHEMA_BEHIND`** for that tenant only:
one customer left behind must not take the other nine hundred down with it, and the operator
finds out from a request that names the tenant. A container is asked once and then remembered
as current; a container that is behind is asked again every time, so migrating it takes effect
on the next request rather than after a deploy.

Both are on by default. For a staged rollout:

```ts
tenants: {
  migrations: {
    checkOnResolve: false,            // serve a tenant container that is behind
    refuseStartIfControlBehind: false // boot with the control plane behind
  }
}
```

A deployment with no `tenants` block has nowhere to declare them, and that is the answer
rather than a gap: with one container and one schema, running new code against old tables has
no staged-rollout reading. Migrate first.

### Editing a migration that already ran

You cannot. The framework stores each file's checksum next to its name and refuses to touch a
container whose applied migration no longer matches the repository: the two disagree about
what happened to that schema, and guessing which one is right is how a schema becomes
unreadable. Add a new migration instead.

## One container per tenant

`tenants.strategy` decides what a container is:

| Strategy | A container is | Isolation | Cost |
|---|---|---|---|
| `schema` (default) | a schema of one database | the framework qualifies every table | one shared pool |
| `container` | a **database of its own** | the connection is attached to it | a pool per live container |

Under `container` the connections are opened **on demand** and kept in an LRU with an explicit
bound (`tenants.containers.maxOpen`, default 20), well below what the server allows. A container
nobody has touched for `idleTimeoutMs` is closed. Twenty live containers serving three hundred
tenants is the shape; one pool per tenant is the shape that stops working on the day there are
enough tenants to matter.

**The framework refuses to start when that arithmetic does not fit.** `maxOpen` times the pool
of each container, plus the control pool, has to leave room under the server's
`max_connections` for everything else that talks to it: superuser slots, replication, the
monitoring agent, the operator's own `psql`. The measured constraint is the connection and not
the ORM (`EVO_FRAMEWORK.md` appendix A.3): at `max_connections = 100`, 150 containers each
holding one connection fail with *sorry, too many clients already*. Discovering that at the
two-hundredth tenant means discovering it in production.

On **SQLite and libSQL** a container is a file, and the same two limits apply for the same
reason with a different resource: the bound is on open descriptors, and a container nobody has
touched for `idleTimeoutMs` is closed. Creation policy, permissions, names and confinement are
the ones of the file engine (a file per container, `0600`, always resolved inside the
configured directory). The Magic Query operators that Postgres has and SQLite does not answer
**400** rather than degrading quietly: `docs/MAGIC_QUERY_V5.md` lists which.

Reference sizing: **50 to 300 tenants per instance**. Above about a hundred, put **PgBouncer in
transaction mode** in front of it. The framework holds no session state on a connection (T-3.1),
so it is already compatible with that mode: nothing has to survive between transactions.

### Continuous replication

A file container can be replicated continuously, to S3 or anywhere else Litestream accepts:

```ts
tenants: { containers: { directory: './data/tenants', replica: { url: 's3://backups/tenants' } } }
```

The framework does not replicate anything itself: it supervises **Litestream**, which has been
shipping WAL frames, tracking generations and getting restores right for years. Writing that
again would mean getting it wrong on the day it matters. What the framework owns is the port,
so a deployment that needs something else replaces an adapter and not a design.

- replication starts when a container is created and stops before it is destroyed;
- **a missing binary is fatal.** A container the deployment believes is being copied, and is
  not, is worse than one nobody promised to copy;
- a replicator that dies is reported as stopped, not as running;
- a restore refuses to write over an existing container: that is not a restore, it is a
  destruction with an extra step.

Page-encrypted containers are out of scope: Litestream cannot do it, and a port that pretended
otherwise would be a promise the adapter cannot keep.

## Exporting a container

```
POST /tenants/:id/export        capability `tenants:export`
```

Writes one customer's container to a file: `pg_dump --schema` on Postgres, a WAL checkpoint
followed by a copy on SQLite and libSQL. The response says where it landed, how big it is, and
**which schema version it was taken at**, read from the container itself rather than from the
registry row.

Three things it will not do:

- **produce a partial export.** If `pg_dump` is missing, or too old for the server, or exits
  non-zero, the operation fails and any half-written file is removed. An export that "mostly
  worked" is worse than none: it is a backup somebody will trust;
- **let the caller choose a path.** The directory is `options.export_directory`
  (`EXPORT_DIRECTORY`, default `./data/exports`) and the file name is generated from the slug,
  the version and the instant. A destination taken from a request is a path traversal with
  extra steps;
- **include anybody else.** A Postgres export is limited to that tenant's schema.

## Destroying a container

The only operation the framework cannot undo, and the only one where every step is a
deliberate obstacle.

```
POST   /tenants/:id/destruction-request     capability `tenants:destroy`   phase 1
DELETE /tenants/:id/data                    capability `tenants:destroy`   phase 2
```

**Phase 1** reports exactly what would be lost: the container, its size, the row count of every
table. It returns a one-time token, **shown once**, good for ten minutes and for a single use.
Only its SHA-256 is stored, so a control plane that leaks its own tables leaks nothing that can
destroy anything.

**Phase 2** takes three things, all **in the body and never in the URL**, because a token in a
path lands in proxy access logs, browser history and tracing systems:

```jsonc
{
  "token": "...",      // from phase 1, unspent and unexpired, belonging to this operator
  "slug": "acme",      // the tenant's slug, typed again by hand
  "otp": "123456"      // the operator's TOTP code
}
```

Then, in this order: the second factor is verified and its step spent, **the container is
exported** and the file must be real, the event is recorded with the export reference, and only
then is the data dropped. If the export fails there is no destruction. Calling it again on a
tenant that is already gone answers 200 with `alreadyDestroyed: true`.

`tenants:destroy` is deliberately not part of `tenants`: creating a tenant and destroying its
data are not the same job.

### The second factor

The operator must be enrolled in MFA (`POST /system/auth/mfa/setup`, then `/enable`). An
operator without it is refused, with the route to call in the message.

This is stricter than `docs/API_V5.md` §6.2, which also allowed a one-time code emailed to an
operator without MFA. The framework has no email pipeline of its own, and inventing one on the
path of its only irreversible operation would make the second factor exactly as strong as an
SMTP configuration nobody reviewed.

### What it cannot promise

**The data is still in your backups.** Destroying a container removes it from the database; every
backup taken before that moment still contains it, until that backup expires. The response says
so, and so does this paragraph, because it is the one part of "destroyed" that is not true.

## Change tracking (audit trail)

Declare which routes are tracked in `src/config/tracking.ts`. Every tracked write appends a row
to the `change` table **inside the container the request worked in**, so a tenant's audit trail
lives next to the data it describes.

```ts
// src/config/tracking.ts
export default {
  config: {
    enableAll: true,
    primaryKey: 'id',
    strict: true // the deployment-wide default; see below
  },
  changes: [{ method: 'PUT', path: '/users/:id', entity: 'user', fields: { excludes: ['password'] } }]
}
```

### When the trail cannot be written

**The default is strict: the request fails**, with HTTP 500 and the code `TRACKING_FAILED`. A
system that promises an audit trail and silently keeps none is worse than one that fails
visibly, and in v4 that is exactly what happened: in multi-tenant the write was refused, the
refusal was swallowed into a log line, and the response was still a 200.

Where the trail is genuinely accessory, a route opts out:

```ts
{ method: 'PUT', path: '/preferences/:id', handler: 'prefs.update', config: { tracking: { strict: false } } }
```

Precedence is route, then `config.strict` in `src/config/tracking.ts`, then strict.

Two things worth knowing before choosing:

- the change is written **after** the handler wrote its own row, and the two are not in one
  transaction. Strict mode therefore answers 500 on a request whose data change did happen;
- the **previous values** of a diff are read automatically only for tables the framework knows
  (`user`, `token`). A consumer's own entity is registered nowhere, so set `req.trackingData`
  in a `preHandler` of your own if you want a real before/after. Without a baseline the change
  is still recorded, with each entry carrying only what the field became: an entry with no
  `old` key means "not captured", which is a different statement from `old: null`.

## Hooks

It's possible add hook to application or request/reply lifecycles. More info on [Fastify Hooks](https://www.fastify.io/docs/latest/Reference/Hooks/).

Available hooks are:

```ts
const hooks = [
  'onRequest',
  'onError',
  'onSend',
  'onResponse',
  'onTimeout',
  'onReady',
  'onClose',
  'onRoute',
  'onRegistry',
  'preParsing',
  'preValidation',
  'preSeralization',
  'preHandler'
]
```

Under `src` create the `hooks` folder and inside add the hook as shown in the fastify docs, for example:

```ts
// src/hooks/onRequest.ts

async function hook(req, reply) {
  log.debug('onRequest called')
}

export { hook }
```

## Schemas

It's possible add schemas referenceable by `$ref`. More info on [Fastify Validation & Serialization](https://www.fastify.io/docs/latest/Reference/Validation-and-Serialization/).

Under `src` create the `schemas` folder and inside add the schema as shown in the fastify docs, for example:

```ts
// src/schemas/commonSchemas.ts

export const commonSchema = {
  $id: 'commonSchema',
  type: 'object',
  properties: {
    hello: { type: 'string' }
  }
}

export const commonSchemaAlt = {
  $id: 'commonSchemaAlt',
  type: 'object',
  properties: {
    world: { type: 'string' }
  }
}
```

So, in your `routes.ts` (under the section `config`) you'll can use something like this:

```ts
  params: { $ref: 'commonSchema#' },
  query: { $ref: 'commonSchema#' },
  body: { $ref: 'commonSchema#' },
  headers: { $ref: 'commonSchema#' }
```

## Reset tokens on login

It's possible to specify that all JWT tokens belonging to the user who logs in are reset at each login. To enable this feature, it's necessary to add or change the property `reset_external_id_on_login` to `true` (the default is `false`).

```ts
// src/config/general.ts
'use strict'

export default {
  name: 'general',
  options: {
    reset_external_id_on_login: true
  }
}
```

## Login flows and multi-factor authentication

A login is a flow: one identify stage (`password`, `email-otp`, `oidc`, or a project's method), then the stages
the subject's roles owe, then the session. The framework's default, on both planes, is the password and, for
whoever has one, a TOTP code:

```text
POST /auth/flow/start { method: 'password', email, password }  -> 200 session, or 202 { flow, stage }
POST /auth/flow/step  { method: 'totp', code }                  -> 200 session
```

A project changes the stages in `src/config/authFlows.ts`, whose plane blocks replace the framework's instead
of merging with them, and adds its own methods with `start({ authenticators })`. Everything a flow needs that
the build lacks (a delivery for email codes, the `openid-client` library, a flow store) refuses the boot. The
full specification is **[docs/AUTH_FLOW_V5.md](docs/AUTH_FLOW_V5.md)**.

The second factor is governed by a policy on three levels, `MFA_POLICY` for the deployment (the floor),
`SYSTEM_MFA_POLICY` for the platform's operators and `config.mfa_policy` per tenant, each allowed only to
tighten the one below:

- **`OFF`**: no new enrolments; whoever already has a factor keeps being asked for it.
- **`OPTIONAL`** (default): users enable and disable their factor themselves.
- **`ONE_WAY`**: optional to start with; once enabled, only an administrator can remove it.
- **`MANDATORY`**: every login needs a second factor. The flow engine applies it whatever the flow
  configuration says, and a user without a factor enrols inside the login.

An administrator can always reset a user's factor. Policies, enrolment and recovery are in the
**[Security & MFA Guide](docs/SECURITY_MFA.md)**.

## Disable embedded authorization

Out-of-the-box, the framework automatically secures all routes by checking for a valid (Bearer) JWT token if roles are defined for that route. However, if you want to disable this automatic authorization check and handle it manually within your controllers or middleware, you can do so by setting the `embedded_auth` option to `false`.

```ts
// src/config/general.ts
'use strict'

export default {
  name: 'general',
  options: {
    embedded_auth: false
  }
}
```

## Job Scheduler

It's possible to add a job scheduler. For more information, go to [Fastify Schedule](https://github.com/fastify/fastify-schedule). To enable this feature, it's necessary to add or change the property `scheduler` to `true` (the default is `false`).

```ts
// src/config/general.ts
'use strict'

export default {
  name: 'general',
  options: {
    scheduler: true
  }
}
```

All jobs are to be created and placed in appropriate files under the /src/schedules/ folder.
Each file name must follow the pattern \*.job.ts (for example, test.job.ts).

Inside each job, both the configuration part and the job to be executed must be included using this syntax:

```ts
// src/schedules/test.job.ts
import { DataHandle, JobRun, JobSchedule } from '@volcanicminds/backend'

export const schedule: JobSchedule = {
  active: true,
  scope: 'control',
  interval: {
    seconds: 2
  }
}

export async function job(ctx: DataHandle, run: JobRun) {
  log.info(`tick job ${run.jobName} every 2 seconds`)
}
```

### Where a job runs

A job **declares** its plane and **receives** its handle. It never looks a connection up, and
that is the whole difference from v4, where a job was called with no arguments and everything
it read went through a global connection: in a multi-tenant deployment it therefore ran inside
whichever customer's schema the pool happened to hold.

| `scope` | Runs | Receives |
|---|---|---|
| `'control'` (default) | once, on the platform | a `ControlHandle` |
| `'tenant'` | once, inside the container named by `tenant: '<slug>'` | that tenant's handle, and its registry row in `run.tenant` |
| `'every-tenant'` | once per **active** tenant | each tenant's handle in turn |

The default is `control` on purpose: a job that says nothing must not end up inside a
customer's data. A job that names a plane the deployment does not have (`tenant` without a
slug, `every-tenant` with no `tenants` block, an unknown scope) is refused at load, with the
reason on the error log, rather than failing at its first tick.

`every-tenant` walks the fleet with `concurrency` containers at a time (default 1, maximum
16). One tenant's failure does not cancel the others: they all run, each failure is logged
with its tenant, and the job then fails once with the whole list. `run.signal` is aborted when
the server closes, so a long sweep stops instead of running on against a closing pool.

```ts
export const schedule: JobSchedule = {
  active: true,
  scope: 'every-tenant',
  concurrency: 4,
  cron: { expression: '0 3 * * *' }
}

export async function job(ctx: DataHandle, run: JobRun) {
  if (run.signal.aborted) return
  log.info(`nightly cleanup for ${run.tenant?.slug}`)
}
```

The job scheduling can have this configuration:

```ts
export interface JobSchedule {
  active: boolean // boolean (required)
  type?: string // cron|interval, default: interval
  async?: boolean // boolean, default: true
  preventOverrun?: boolean // boolean, default: true

  scope?: 'control' | 'tenant' | 'every-tenant' // default: 'control'
  tenant?: string // required with scope 'tenant': the tenant slug
  concurrency?: number // scope 'every-tenant' only, default 1, max 16

  cron?: {
    expression?: string // required if type = 'cron', use cron syntax (if not specified, cron will be disabled)
    timezone?: string // optional, like "Europe/Rome" (to test)
  }

  interval?: {
    days?: number // number, default 0
    hours?: number // number, default 0
    minutes?: number // number, default 0
    seconds?: number // number, default 0
    milliseconds?: number // number, default 0
    runImmediately?: boolean // boolean, default: false
  }
}
```

The active property is a boolean and is mandatory.
The `type` property can have values of `cron` or `interval` (default).
If the type is **cron**, the properties defined under `cron` are also considered.
If the type is **interval**, the properties defined under `interval` are also considered.

For cron type, the `cron.expression` property is mandatory and indicates the scheduling to be executed.
The `timezone` property is considered experimental and should be defined, for example, as `"Europe/Rome"`.

Below an example:

```ts
// src/schedules/test.job.ts
import { JobSchedule } from '@volcanicminds/backend'

export const schedule: JobSchedule = {
  active: true,
  type: 'cron',

  // Run a task every 2 seconds
  cron: {
    expression: '*/2 * * * * *'
  }
}
```

Below the cron schema:

```
┌──────────────── (optional) second (0 - 59)
│ ┌────────────── minute (0 - 59)
│ │ ┌──────────── hour (0 - 23)
│ │ │ ┌────────── day of month (1 - 31)
│ │ │ │ ┌──────── month (1 - 12, January - December)
│ │ │ │ │ ┌────── day of week (0 - 6, Sunday-Monday, Sunday is equal 0 or 7)
│ │ │ │ │ │
│ │ │ │ │ │
* * * * * *

// f.e. for every 2 seconds
const expression = '*/2 * * * * *'

```

A useful site that can be used to check a cron configuration is [crontab.guru](https://crontab.guru/)

For interval type, the sum of the properties `days, hours, minutes, seconds, milliseconds` (properly converted) must be equal to or greater than 1 second, otherwise the job will not be executed.

The `runImmediately` property indicates that the **interval** task will be executed for the first time immediately and not after the defined wait time.

Below an example:

```ts
// src/schedules/test.job.ts
import { JobSchedule } from '@volcanicminds/backend'

export const schedule: JobSchedule = {
  active: true,
  type: 'interval',

  // Run a task every 1h 5m 30s
  interval: {
    days: 0,
    hours: 1,
    minutes: 5,
    seconds: 30,
    milliseconds: 0,
    runImmediately: false
  }
}
```

Other properties common to both types of jobs are:

- The **async** property, if true, indicates that a task will be executed as an async function.
- The **preventOverrun** property, if true, prevents the second instance of a task from being started while the first one is still running.

## Raw Body

Sometimes, it’s useful to have the original raw body of the incoming request. For this purpose, the `rawBody` plugin is available out-of-the-box.

Under `config/plugins.ts`, modify your plugin configuration as follows to activate it:

```js
  {
    name: 'rawBody',
    enable: true,
    options: {}
  }
```

Fot the options refers to (fastify-raw-body - github)[https://github.com/Eomm/fastify-raw-body] but for common use, you can configure it in this way:

```js
{
  name: 'rawBody',
  enable: true,
  options: {
    global: false, // adds the rawBody to every request. **Default is true**. If false, you need to enable it for specific routes.
    runFirst: true, // get the body before any preParsing hook change/uncompress it. **Default false**
  }
}
```

Normally, it's a good choice set **global** to `false`and **runFirst** to `true`.

Please, do not change the `field` value in the options above. The default is `rawBody`, and this field name will be used in each request.

### Warning

Setting `global: false` and then the route configuration { config: { rawBody: true } } will _save memory_ and _imporove perfromance_ of your server since the rawBody is a copy of the body and it will double the memory usage.
So use it only for the routes that you need to.

## Rate Limit

It is possible to enable rate limiting either globally or at the individual route level. All configuration and functionality are managed by the [Fastify Rate Limit](https://github.com/fastify/fastify-rate-limit) plugin.

At the global configuration level, you can set something like:

```js
// config/plugin.ts
{
    name: 'rateLimit',
    enable: true,
    options: {
      global: true, // default true
      max: 40, // default 1000
      timeWindow: 3000, // default 1000 * 60
      cache: 10000, // default 5000
      nameSpace: 'your-application-ratelimit-', // default is 'fastify-rate-limit-'
      skipOnError: true // default false
    }
  },
```

While at the route level, if necessary, you can redefine or set different rate limits:

```js
// f.e. /api/example/routes.ts
{
      method: 'GET',
      path: '/test',
      roles: [],
      handler: 'example.test',
      middlewares: [],
      rateLimit: {
        max: 10,
        timeWindows: 20000 // milliseconds
      },
      config: {
        title: 'Rate limit example',
        description: 'Rate limit example',
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }

```

## rawBody on specific route

If you set **global** to `false`, you can enable the rawBody for a specific route (common use, hooks to validate Stripe signature). Alternatively, if you set **global** to `true` or leave global not specified/undefined, it will enable rawBody on all routes, and you can disable it for single route in the following way.

A simple note: in the example below, you can see rawBody enabled on the `/example` endpoint. You can also disable rawBody by setting it to `false` instead of `true`.

```js
// f.e. /api/example/routes.ts
{
  method: 'GET',
  path: '/',
  roles: [],
  handler: 'example.test',
  middlewares: [],
  config: {
    title: 'How to use req.rawBody',
    description: 'How to use req.rawBody',
    rawBody: true,
    response: {
      200: { $ref: 'defaultResponse#' }
    }
  }
}
```
