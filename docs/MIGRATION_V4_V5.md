# Migrating from v4 to v5

> **Status: complete for the v5 surface.** This file was written one line at a time, as each
> break landed, and not reconstructed at the end (task T-8.3); it was then read through in
> full, once, with the API stable. Everything below is true of the code on the `v5` branch.
>
> Twenty-seven sections, in the order a port meets them: the data layer and the configuration
> first, because nothing else compiles until they are right; then what changed inside a
> request; then the routes, the answers and the two core defaults. If you are porting a
> project, read §1 to §4 before touching anything, and keep §18 open while you test the
> login: the status code changed.
>
> The last three sections (§21 to §23) were written **by** a port rather than for one:
> `volcanic-backend-sample` was carried to v5 and every place the guide fell short became a
> row here.
>
> §24 came later, with the decision to keep the browser session out of the page (phase 10):
> it is the break an upgrade meets first, because an instance without `COOKIE_SECRET` no
> longer starts. §27 is later still (phase 11) and is the one break that also hits whoever
> already runs a 5.0 alpha: the refresh token is no longer a JWT.

v5 is breaking on purpose. There is no compatibility branch, no deprecated alias and no
automatic translation of a v4 configuration: invariant 9 of `EVO_FRAMEWORK.md` says the
compatibility is a document, and this is the document. Where the framework can tell that a
v4 spelling was used, it **refuses to start** and names the replacement, because the failure
mode of translating silently is not an error, it is an answer from the wrong container.

---

## 1. The data layer

| | v4 | v5 |
|---|---|---|
| Subpath | `@volcanicminds/backend/typeorm` | `@volcanicminds/backend/db` |
| ORM | TypeORM 0.3.x | an implementation detail, not part of the API |
| Engines | Postgres, PGlite, Mongo (declared) | Postgres, SQLite, libSQL |
| Encryption | `encrypt` / `decrypt`, synchronous | the same functions, `async` |

The subpath carries no engine name any more: in v4 the ORM was part of the public API, so
changing it was a breaking change for every consumer. PGlite stays for development and unit
tests, never for isolation tests: it has no pool, so it cannot show the class of defects the
rewrite exists to remove.

**The framework's `user` has no name any more.** v4 projects added `firstName` and `lastName` by
subclassing the `User` entity; v5 forbids redefining a framework table (docs/SCHEMA_V5.md §6),
so names live in a table of the project's own, keyed by `user.id` (the sample's `user_profile`
is the pattern). Until T-10.22 the framework's JSON schemas still accepted the two fields and
`PUT /users/me` still listed them as self-editable: the request answered 200 and stored nothing.
They are gone from `userBodySchema`, `currentUserBodySchema` and the self-edit whitelist, and the
console titles a user by `email`. A client that still sends them sees them stripped, as before,
because Fastify removes properties a schema does not declare.

## 2. Configuration

```js
// v4
options: { multi_tenant: { enabled: true, resolver: 'header', header_key: 'x-tenant-id' } }

// v5 (docs/CONFIGURATION_V5.md §1)
options: {
  control: { engine: 'postgres', schema: 'public', pool: { max: 10 } },
  tenants: { strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: 'x-tenant-id' }
}
```

There is no `enabled` flag: **declaring the `tenants` block is what enables tenancy**, so the
flag and the strategy can no longer contradict each other. A deployment without tenants omits
the block entirely. The merge is deep, so declaring one key inside a block no longer erases
its siblings (defect D-21).

## 3. The context of a request

| v4 | v5 |
|---|---|
| `req.db`, `req.runner` | `req.control`, `req.tenant`, `req.tenantInfo` |
| `global.connection`, `global.entity`, `global.repository` | removed, including the ambient declarations |
| `manager.method(args)` | `manager.method(ctx, args)`, context first |

`ControlHandle` and `TenantHandle` are two different types, so passing a tenant handle where
the control plane is required does not compile. A call with no context does not fall back to
a global connection: it throws `NO_DATA_CONTEXT`. That fallback was how a request that lost
its context read whatever the pool happened to hold (defects D-01 and D-06).

## 4. Route declarations

```js
// v4
config: { tenantContext: false }

// v5 (docs/AUTHORIZATION_V5.md §2)
config: { scope: 'control' }
```

`tenantContext` is **refused at boot**, not translated: the router collects it with the other
integrity errors and the process fails to start, naming the `scope` to write. The default is
unchanged and still the safe one, a route without `scope` runs inside the tenant.

## 5. Tenant resolution

| v4 | v5 |
|---|---|
| the header decided, always | **the token decides whenever there is one** |
| `resolver` typed and documented, never read | `header` and `subdomain`, both implemented |
| `query` resolver typed | removed |
| token / header disagreement | 403 `TENANT_MISMATCH` |

The tenant comes from the token's `tid` claim. The header or the subdomain resolves the
tenant only for requests that carry no token, which is login and public routes, and only one
of the two is consulted: the configured one. A tenant identifier in a query string ends up in
access logs, `Referer` headers and browser history, so it is gone (decision 9).

New answers a v4 client did not get: 400 `TENANT_REQUIRED` when nothing names a tenant, 404
when the named tenant is unknown **or suspended** (the same answer, so the registry cannot be
probed from outside), 403 `SCOPE_MISMATCH` for a control token used inside a tenant.

## 6. Magic Query

The syntax changed, and the full v4 → v5 correspondence table is in
`docs/MAGIC_QUERY_V5.md` §9. The headline: `:raw` is **removed** (behind an environment
variable it was SQL injection), ranges are written with `..`, wildcards are escaped, and an
operator an engine cannot honour answers 400 instead of degrading in silence.

## 7. Scheduled jobs

```js
// v4: no arguments, and whatever it read came from the global connection
export async function job() { ... }

// v5
export const schedule = { active: true, scope: 'every-tenant', concurrency: 4, cron: { expression: '0 3 * * *' } }
export async function job(ctx, run) { ... }
```

A job declares its plane (`control` by default, `tenant` with a slug, or `every-tenant`) and
receives the matching handle. A job that names a plane the deployment does not have is
refused at load rather than at its first tick. `every-tenant` is bounded in concurrency,
stops when the server closes, and reports the tenants that failed without skipping the rest.

## 8. Change tracking

| v4 | v5 |
|---|---|
| in multi-tenant the trail was **silently empty** | the change is written inside the tenant's container |
| a failed write became a log line, the response stayed 200 | the request fails with 500 `TRACKING_FAILED`, unless the route declares `tracking: { strict: false }` |
| `changeEntity` chose the table to write into | one `change` table per container; the option is gone |
| the previous state came from `global.entity` | read automatically for framework tables, otherwise supplied by the consumer through `req.trackingData` |

An entry of `contents` without an `old` key means the previous value was not captured. It is
not the same statement as `old: null`, and reading it as such would overstate what the trail
knows.

## 9. Response cache

| v4 | v5 |
|---|---|
| key `keyGroup :: tenant\|subject\|roles :: METHOD url` | `keyGroup :: container :: subject\|roles :: METHOD url`, with `control` / `tenant:<id>` spelled out |
| a declarative `invalidates` swept every tenant | it sweeps the container the request ran in |
| default `ttl` 3600s | 3600s without tenants, **60s** when a `tenants` block is declared |

The store is still per process and an invalidation still does not reach the other instances.
That is now a written decision rather than an undocumented behaviour, and the lower default
TTL is what bounds it: see `docs/CACHE.md` §6.

## 10. Platform identities

New in v5, and it is the reason `/system/*` exists at all. In v4 the "super admin" was a row
in the `user` table of the `public` schema, and the only thing separating it from a tenant's
admin was which schema the connection happened to resolve. That is defect D-01, which means
every administrative operation was one defect away from a privilege escalation.

| | v4 | v5 |
|---|---|---|
| Where a platform admin lives | `user` in `public` | `system_user`, control plane only |
| Its roles | `admin`, the same code a tenant admin holds | `system:*`, a separate catalogue in `config/systemRoles.ts` |
| Its token | indistinguishable from a tenant token | `scp: 'control'` and **no** `tid` |
| Its routes | none | `/system/auth/*`, `/system/users/*` |
| Registry routes `/tenants/*` | `roles: [roles.admin]` | control capabilities (`tenants:read`, `tenants`, …) |

Both directions are refused at runtime: a control token inside a tenant answers 403
`SCOPE_MISMATCH` (during tenant resolution), and a tenant token on a platform route answers
403 `SCOPE_MISMATCH` (during authentication). A route that mixes the two catalogues does not
start: the router collects it with the other integrity errors and the boot fails.

**Only where the split is real.** A deployment with no `tenants` block has one container and
one identity space, so its control-scope routes keep authenticating the application's own
users and `/system/*` is not mounted. Demanding a platform identity there would demand a
system user the deployment never creates.

`ADMIN_EMAIL` still bootstraps the first identity, and on a deployment with tenants that
identity is now a **system user** carrying `system:admin`, not an application admin.

## 11. Impersonation

| v4 | v5 |
|---|---|
| a claim in a token, and nothing else | a row in the control plane, written **before** the token exists |
| no reason recorded | `reason` is required, and refused with 400 when missing |
| 24 hours | 30 minutes by default, four hours maximum whatever the configuration says |
| no way to stop a session | `POST /tenants/impersonate/end`, and the next request is refused |
| guarded by `req.user?.tenantId === 'system'`, a field the entity did not have | a control token plus the `tenants:impersonate` capability |

The issued token is a **tenant** token carrying `imp`: inside the container the session is an
ordinary user with that user's roles. Every request checks the record, not the signature, so
revoking takes effect immediately rather than when the JWT expires. Tracked writes record the
session in `change.impersonation_id`.

In cookie mode, the default (§24), the token is not in the body: it is written into the tenant
cookie, while the operator's own session stays in the control cookie, so opening an
impersonation never costs the session that can end it. Ending it clears the tenant cookie when
that cookie holds the session being ended.

## 12. The sovereign founder

| v4 | v5 |
|---|---|
| `isFounderEmail(email)`, compared against `process.env.ADMIN_EMAIL` on every check | `isFounder(user)`, the `is_founder` column of the row |
| the same address was sovereign inside **every** tenant | each container has its own founder, or none |
| changing `ADMIN_EMAIL` moved the sovereignty | it does not: a container that has a founder keeps it |
| `ADMIN_EMAIL` read at request time | read at boot only, to seed the first identity |

A container that predates the column has no founder, and the next boot with `ADMIN_EMAIL` set
gives it one. Moving sovereignty is now a deliberate write, not a redeploy.

## 13. Migrations

| v4 | v5 |
|---|---|
| `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` | gone: incompatible with a versioned schema |
| `POST /tool/synchronize-schemas` | gone, with the whole `/tool` group |
| the schema was whatever the entities said at boot | committed SQL, generated by `drizzle-kit`, applied in order |
| no version anywhere | a `migration` table **inside each container** |

Forward only: there is no `down`. Reversibility comes from shipping additive migrations first
and the destructive half in a later release (expand/contract, see the README), so a rollback
is a code deploy and never a data restore.

**New refusals.** The instance does not start when the control plane is behind the code, and a
tenant container that is behind answers 503 `SCHEMA_BEHIND` for that tenant alone. Both are on
by default (`tenants.migrations.refuseStartIfControlBehind`, `tenants.migrations.checkOnResolve`).
A v4 deployment that relied on the schema being synchronised at boot has to run
`npm run db:migrate` as a deploy step instead.

## 14. Provisioning a tenant

```js
// v4
POST /tenants { name, slug, dbSchema }

// v5 (docs/API_V5.md §6.1)
POST /tenants { name, slug, strategy?, engine?, locator?, config?, admin: { email, password, adminConfirmed? } }
```

- `dbSchema` is now `locator`, and it is **optional**: absent, it is derived from the slug.
  A value that changes under sanitisation is refused with 400 rather than accepted under a
  different name (defect D-20).
- `admin` is part of the request, and `adminConfirmed` defaults to **true** on this route. In
  v4 the seeded administrator was created unconfirmed, login refused unconfirmed users, and no
  API could confirm one: a tenant that could not be used (defect D-08). `POST /auth/register`
  still creates unconfirmed users, because self-registration is a different path.
- The container is created, **migrated**, and the version recorded on the registry row. If any
  step fails the container is dropped and **no registry row is written**: v4 wrote the row
  first, so a failed provisioning left a tenant pointing at a container that does not work.

## 15. Two things that were shaped like the ORM

| v4 | v5 |
|---|---|
| `req.user.getId()`, `req.token.getId()` | `req.user.id`, `req.token.id` |
| `scope` read only inside `config` | read on the route, in `config`, or on the file config |

`getId()` was an ORM entity method that had leaked into the public surface. v5 hands back
plain rows: the ORM is not part of the API, and a data row that answers method calls is the
ORM pretending otherwise.

`public` is plane-neutral. It is not a tenant identity, it is the absence of one, so a
control-scope route uses the same `public` code for "answer before anyone is authenticated".
A control route that declares nothing is superuser-only: being public is opted into, never
inherited.

## 16. Destroying a tenant

In v4 `DELETE /tenants/:id` was a soft delete of the registry row and the data stayed where it
was (defect D-09). In v5 that route still only removes the row, and **says so in its response**;
destroying the data is a separate, two-phase operation:

| | |
|---|---|
| `POST /tenants/:id/destruction-request` | reports what would be lost, returns a one-time token shown once, good for ten minutes |
| `DELETE /tenants/:id/data` | body: `token`, `slug` typed again, `otp`. Exports first, records the event, then drops |

The operator needs `tenants:destroy` (not part of `tenants`) and must be enrolled in MFA. The
data remains in any backup taken before the destruction, and the response says so.

## 17. Routes that no longer exist

| Route | Why |
|---|---|
| `POST /tool/synchronize-schemas`, `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` | schemas are versioned migrations now |
| `POST /tenants/impersonate` | it left no record and its privilege check was dead code; it returns with a persisted, revocable record |
| `switchContext` on the tenant manager | choosing a container is not a session change any more |

## 18. Authentication answers (defect D-17)

| Situation | v4 | v5 |
|---|---|---|
| unknown address at login | 403 `Wrong credentials` | **401** `AUTH_INVALID_CREDENTIALS` |
| wrong password | 403 `Wrong credentials` | **401** `AUTH_INVALID_CREDENTIALS` |
| unconfirmed account | 403 `User email unconfirmed` | **401** `AUTH_INVALID_CREDENTIALS` |
| blocked account | 403 `User blocked` | **401** `AUTH_INVALID_CREDENTIALS` |
| expired password | 403 `PASSWORD_TO_BE_CHANGED` | unchanged: 403 `PASSWORD_TO_BE_CHANGED` |
| `POST /auth/register` on an address already registered | 400 `Email already registered` | **200**, the body of a successful registration, and nothing created |

Four distinct messages are a directory: fed a list of addresses they say which ones have an
account here, and for those that do, whether the account is merely unconfirmed or has been
shut off. The client now gets one code; the real cause is written to the log with a distinct
internal code (`AUTH_UNKNOWN_EMAIL`, `AUTH_BAD_PASSWORD`, `AUTH_UNCONFIRMED`, `AUTH_BLOCKED`),
where the operator answering the support call can read it and the internet cannot.

The expired password stays distinct because it is reached **after** the password verified: it
tells the caller nothing they had not already proved they knew. It is also now checked after
the blocked flag rather than before it, so a blocked account never receives it.

**What a client has to change.** Any code branching on the four v4 message strings, and any
HTTP layer that treats 401 as "the session expired, redirect to the login screen": on the
login route itself that reading turns a wrong password into a redirect loop. Branch on
`code`, which is what it is there for. Registration no longer reports a duplicate address, so
a form that showed «that email is taken» has nothing to show; the account confirmation email
is the channel that tells the real owner, and the one that does not answer to a stranger.

## 19. `req.data()` merges (defect D-29)

| v4 | v5 |
|---|---|
| the query string **or** the body, never both | both, merged, with the **body winning** on a shared key |
| one non-null query value dropped the whole body | nothing is dropped |
| — | `req.queryData()` and `req.bodyData()` read one source alone |

In v4 a single unrelated query parameter — a `utm_source` added by a mail client, a
cache-buster — made the body vanish, so `POST /auth/login?utm=x` with the credentials in the
body answered «Email not valid». The precedence is now declared: the body is the payload of
the request, the query string is addressing, and when a caller sends both the one they meant
is the body. A `null` in the body survives the merge, because there it is a value ("clear this
field") and not an absence; an `undefined` never overrides.

**What a client has to change.** Nothing, unless it relied on the query string shadowing the
body, which no documented call did. A handler that must not be steerable from the URL now says
so with `req.bodyData()`.

## 20. Two defaults of the core

| | v4 | v5 |
|---|---|---|
| CORS | `origin: '*'` with `credentials: true`, compiled in | allowlist from `CORS_ORIGINS`; `credentials` only against a real allowlist; the wildcard pair **refuses to boot in production**, and so does a wildcard that arrived by omission |
| `onError` | echoed the exception on a 500 whatever `HIDE_ERROR_DETAILS` said | honours it, like every other error path |
| cron `timezone` | read from a misspelt property, so it was always ignored | honoured (defect D-24) |

The v4 CORS pair was not a lax setting, it was a broken one: browsers refuse to honour
credentials against a wildcard, so cookie mode never worked cross-origin, and in bearer mode
the wildcard left the API callable from any page the user happened to visit. **Set
`CORS_ORIGINS`** to the comma-separated list of origins allowed to call the API before
deploying; a deployment that really wants a public API writes `CORS_ORIGINS=*` and gets no
credentials with it.

The cron fix moves jobs that declared a timezone: they ran on the host's zone, which on a UTC
container is an hour or two away from `Europe/Rome` and drifts twice a year. Check any cron
expression whose hour matters.

## 21. Bootstrapping, in an order that matters

```ts
// v4
import { start as startServer } from '@volcanicminds/backend'
import { start as startDatabase, userManager } from '@volcanicminds/backend/typeorm'
await startDatabase(myDbConfig)
await startServer({ userManager })

// v5
import { preload, start as startServer } from '@volcanicminds/backend'
import { start as startDataLayer } from '@volcanicminds/backend/db'

await preload()                                   // reads config/general.ts into global.config
const layer = await startDataLayer()              // reads the control/tenants blocks from it
await layer.migrations.apply({ locator: 'public' })
await startServer(layer)                          // the managers become the server's decorators
```

**`preload()` is not optional, and forgetting it does not raise.** It is what loads
`config/general.ts`, and the data layer reads the `control` and `tenants` blocks from there.
Called out of order, `startDataLayer()` finds no configuration and falls back to its own
defaults — a different database, reached without an error. `startServer()` calls `preload()`
too, but by then the data layer has already opened its pool against the wrong host.

The managers are no longer module-level singletons imported from a subpath: they are values
`startDataLayer()` returns and the caller hands to the server. That is what makes a different
implementation a parameter rather than a patch.

## 22. Your own tables, in the right container

A consuming project declares its tables in its own schema files and never redefines a
framework one (`docs/SCHEMA_V5.md` §6). Three things it needs, and where they are:

| | |
|---|---|
| The handle types | `ControlHandle`, `TenantHandle`, `DataHandle` from `@volcanicminds/backend`. Typing that seam `any` makes the control plane and a container interchangeable, which is what the two brands exist to prevent |
| The inside of a handle | `access(handle)` from `@volcanicminds/backend/db`: `db`, `dialect`, `locator`, `execute`, `transaction`. Reaching into `lib/` instead couples the project to an internal path |
| A restriction the URL cannot relax | `QueryOptions.extraWhere`, AND-ed after everything the caller asked for, `_logic` included. This is v4's fourth argument of `executeFindQuery` under a name |

**Build the table objects per locator.** Drizzle prints the schema name into the SQL, so a
table object *is* the choice of container: that is what makes tenancy work without touching
`search_path` on a pooled connection, and it is why a cache of those objects must be keyed by
`locator`. A cache that ignores it hands tenant B the object naming tenant A's schema —
defect D-01, rebuilt in application code.

**Extending the framework's `user` is the one thing not to do.** v4 subclassed the `User`
entity to add columns. In v5 those fields go in a table of the project's own, keyed by
`user.id`: a framework table redefined by a consumer collides with every future framework
migration, and the collision surfaces at upgrade time on a deployment already in production.

## 23. Developing against a local checkout

`drizzle-orm`, `pg` and `bcrypt` are **peer** dependencies: one instance, shared. Installed
from the registry that is what happens, because the package brings no `node_modules` of its
own.

A `file:` dependency is a symlink to a working checkout that *does* have one, and Node
resolves through the realpath: the framework finds its copy, the project finds its own, and a
table object built by one is a foreign object to the other. The symptom is a type error naming
two identical-looking paths, or a runtime that disagrees silently. Collapse the duplicates onto
the checkout's copies — `volcanic-backend-sample/scripts/link-peers.mjs` does it on
`postinstall` and is a development convenience production never sees.

## 24. The session in a cookie, by default (T-10.37, T-10.38, T-10.39)

| | v4 | v5 |
|---|---|---|
| `AUTH_MODE` unset | `BEARER` | **`COOKIE`** |
| `AUTH_MODE=cookie`, `AUTH_MODE=Cookie`, a typo | read as `BEARER`, in silence | the case is ignored; anything that is not `COOKIE` or `BEARER` **refuses the boot** |
| cookie mode and the `Authorization` header | the header was not read at all | read, for **integration tokens only**; a session token there is `401 CREDENTIAL_CHANNEL` |
| cookie mode and renewal | none: login answered `refreshToken: null` and the session ended with the cookie | a refresh cookie limited to the renewal route; `POST /auth/refresh-token` with an empty body |
| cookie lifetime | `maxAge: 86400` written by hand, next to a 15-day JWT | `Max-Age` read from the token's own `exp` |
| `JWT_EXPIRES_IN` default | `15d` | **`1h`** |
| platform session in cookie mode | written into `auth_token`, the tenant cookie, with the refresh token in the body | its own pair, `control_token` and `control_refresh_token` |
| MFA in cookie mode | `tempToken` in the body, verification read the header by hand: MFA users could not log in | the pre-auth token in the cookie, `tempToken: null` |
| impersonation in cookie mode | the token in the body | the tenant cookie, `token: null`; ending it clears that cookie |
| refresh token claims | the same as the access token's | none: the refresh token stopped being a JWT, see §27 |

**Why.** A token in `localStorage` is readable by every script of the page, so an XSS takes the session
with it; an httpOnly cookie is not readable at all. v4 had the cookie mode but made it exclusive, so
switching it on broke every integration, and it had no renewal, so a short token meant a short
session. v5 gives each channel one kind of credential: the cookie carries the browser's session, the
header carries the integration tokens, which are issued to programs.

**What a deployment has to do.**

- Set `COOKIE_SECRET` (32 characters at least, as the other secrets). Without it, and without
  `AUTH_MODE`, the instance **refuses to start**: that is the first thing an upgrade meets.
- Or set `AUTH_MODE=BEARER` explicitly, which keeps the v4 behaviour of the header and the body. That
  is the choice for mobile apps and any client that cannot hold a cookie; a deployment that serves such
  a client and a browser picks bearer, or gives the client a cookie jar.
- A project whose `config/plugins.ts` disables the `cookie` plugin is refused at boot in cookie mode.
- The admin and the API on the same site (`SameSite=Strict`): the same registrable domain, and
  `CORS_ORIGINS` listing the admin's origin so that credentials are granted. Cross-site deployments are
  not supported by the cookie mode.
- Behind a proxy that publishes the API under a path and strips it (`/api/*` → `/*`), set
  `COOKIE_PATH_PREFIX=/api`: the refresh cookie is limited to the renewal route **as the browser sees
  it**, and without the prefix the browser never sends it back.

**What a client has to change.**

- A browser client in cookie mode sends `credentials: 'include'` and stores nothing: `token`,
  `refreshToken` and `tempToken` come back `null`. On a `401` it calls the renewal once and repeats the
  request; `401 REFRESH_REQUIRED` from the renewal means the session is over.
- A bearer client renews with `{ refreshToken }` alone, and stores the new one that comes back: the body
  of the request changed again in §27. With `JWT_EXPIRES_IN` at `1h` instead of `15d`, a client that never
  renewed now meets a `401` within the hour: renewing is no longer optional, and a deployment that wants
  the old lifetime sets `JWT_EXPIRES_IN=15d` explicitly.
- **Refresh tokens issued by v4 no longer renew.** Users log in once after the upgrade, and §27 says why.
- An expired or forged refresh token is a refusal with a code, never a `500`.

**Behaviour of the renewal in cookie mode.** The refresh credential is the whole credential: the access
cookie is gone by the time it is needed, because it lives exactly as long as its token. The tenant is
checked against the credential's routing segment (`TENANT_MISMATCH` otherwise), and the subject and its
account state are loaded from the session row. Both deadlines of the session live in that row, so the
cookie is written with the earlier of the two and a browser never holds a credential the server would
already refuse. `/auth/invalidate-tokens` ends every session of the user in both modes.

## 25. One console per plane (T-10.12, T-10.14, T-10.15)

| | before (5.0.0-alpha, until T-10.14) | now |
|---|---|---|
| `GET /admin/manifest` | control scope: with tenants, a platform identity only | **tenant scope**, the tenant routes only when tenants are declared |
| the platform console's manifest | the same route | `GET /system/manifest`, control scope, only with tenants |
| who a platform session is | no route: `/users/me` refuses a control token | `GET /system/auth/me` |
| `manifest.auth` | `mode`, `endpoints` of the tenant plane | also `plane`; the endpoints of that plane |
| `manifest.tenancy` | `switchable: true`, `listEndpoint: '/tenants'` under the header resolver | `switchable: false`, no `listEndpoint`; `header` only on the tenant plane |
| CORS preflight | `x-tenant-id` not allowed: a browser on another origin could not send a login | the tenant header is added to `allowedHeaders` wherever the backend reads it |
| `requireCapability: 'manifest'` on a tenant route | refused at boot | allowed: the name is reserved by both catalogues |

**Why.** With tenants the two planes are distinct identity spaces, and one manifest for both handed a
customer's users the platform's route map and role codes while drawing screens they could never call.
The token binds the tenant from the login on, so a switcher under a session could only produce
`TENANT_MISMATCH`, and the list it read is a control route.

**What a deployment has to do.** Nothing, if it runs without tenants. With tenants: grant `manifest` in
`config/roles.ts` to the tenant roles that operate a customer's console, and in the control catalogue to
the operators of the platform console (`system:auditor` holds it; `system:operator` does not). A pinned
platform manifest comes from `MANIFEST_DUMP` with `MANIFEST_DUMP_PLANE=control`: in cookie mode the header
accepts integration tokens only, and the control plane has none. A project that writes its own `cors`
block in `config/plugins.ts` does not need to list the tenant header: it is added to the effective options.

**What a console has to change.** `@volcanicminds/admin` takes `plane="control"` for the platform console
and asks for the tenant on the login screen of a customer's console (or takes it from `tenant`). A custom
client reads the platform identity from `/system/auth/me`, sends the tenant header on the login and on
every call before the session exists, and stops expecting `tenancy.listEndpoint`.

## 26. The second factor, per plane and per tenant (T-10.19)

| | before (v4 and 5.0.0-alpha until T-10.19) | now |
|---|---|---|
| `MFA_POLICY` | one value for the deployment, read only by `/auth/*` | the **floor**: the control plane and each tenant may tighten it, never loosen it |
| the platform's operators | no policy at all: `MANDATORY` did not oblige them | `SYSTEM_MFA_POLICY`, which defaults to `MFA_POLICY` |
| a single tenant | nothing of its own | `config.mfa_policy` in its registry row; a value weaker than the floor is refused with `MFA_POLICY_WEAKER`, an unknown one with `MFA_POLICY_INVALID` |
| values | `OPTIONAL`, `MANDATORY`, `ONE_WAY` | the same, plus `OFF`: no new enrolments, while whoever already has a factor keeps being asked for it |
| enrolment on the control plane | superuser only (`roles: []` on a control route) | every platform identity, for itself (T-10.24) |
| an operator who lost the device | nothing: `POST /system/users/:id/mfa/reset` was in this documentation and the route did not exist | it exists, and belongs to whoever holds `system-users` |
| `securityPolicy.mfaPolicy` | the deployment value | the policy actually enforced for that caller, on both planes |
| a policy nothing can honour | accepted, and the first login found out: `MANDATORY` answered «enrol first» and the enrolment answered `500` | refused. The boot stops when `MANDATORY` meets a build with no MFA manager, a tenant that asks for it is refused with `MFA_NOT_AVAILABLE`, and an enrolment attempt answers `503` with the same code |

**Why.** A policy that only the tenant routes read is a policy that stops exactly where the damage
starts: an operator can destroy a customer's container, and `MANDATORY` did not ask them for a
second factor. And one value for everybody meant a customer who wanted more could not have it.

**What a deployment has to do.** Nothing to keep today's behaviour: unset, both new settings follow
`MFA_POLICY`. To tighten the platform alone, set `SYSTEM_MFA_POLICY=MANDATORY`, and give the
operators a way back by granting `system-users` to whoever answers the support call. A value that is
not one of the four now refuses the boot instead of being read as the default, and `MANDATORY` needs
a build that can actually issue a second factor: without an MFA manager the boot refuses, because
the alternative is an instance where the first login locks everybody out.

## 27. The refresh token is a session, not a JWT (T-11.6 to T-11.10)

| | v4, and 5.0.0-alpha until T-11.6 | now |
|---|---|---|
| what a refresh token is | a second JWT, signed with `JWT_REFRESH_SECRET` or, unset, with `JWT_SECRET` | an opaque credential, `vs1.<routing>.<sid>.<secret>`, whose SHA-256 is a row in the new `session` table |
| what renewing does to it | nothing: the same string worked until its own expiry | it is spent. Every renewal mints a new secret and increments the generation |
| presenting a spent one | indistinguishable from a legitimate renewal | inside a few seconds it is two tabs and is served; later it is `401 SESSION_REUSE_DETECTED` and the **whole session is revoked** |
| `logout` | cleared the browser's cookies | revokes the session row, then clears the cookies |
| `/auth/invalidate-tokens` | rotated `external_id`, and that was the only revocation | revokes every session of the user **first**, then rotates `external_id` |
| bearer renewal body | `{ token, refreshToken }` | `{ refreshToken }`, answered with a **new** `refreshToken` every time |
| where the lifetime is written | `JWT_REFRESH_EXPIRES_IN`, in the token | two columns of the row: inactivity and an absolute maximum (`SESSION_IDLE_TTL`, `SESSION_ABSOLUTE_TTL`) |
| `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN` | required and read | **ignored**, and the boot warns when either is set |
| renewal without a data layer | worked, and protected nothing | the routes answer `404` |
| the access token | `sub`, `tid` or `scp`, `roles` | the same, plus `sid`: an action is attributable to a session and not only to a subject |

**Why.** A JWT is verified, not consumed, so "this generation has already been spent" is a fact that
exists nowhere. Everything else followed from that: a stolen refresh token was invisible until it
expired, the logout was a belief rather than a state, and the only real revocation was rotating
`external_id`, a public identifier that is serialised in responses and that integrations store. The
rotation does not prevent the theft; it makes a stolen copy stop working as soon as the owner renews,
and it makes the theft an event somebody can count. The full reasoning is `docs/AUTHORIZATION_V5.md` §9.

**What a deployment has to do.**

- **Apply the new migrations.** Four of them, `0001_sessions_control` and `0001_sessions_tenant` for
  each dialect. The control plane takes both sets, every tenant container takes the tenant one
  (`npm run db:migrate`, then `npx volcanic migrate --tenants`). Without the table there is no
  registry, and without a registry there is no renewal at all.
- **Drop `JWT_REFRESH_SECRET` and `JWT_REFRESH_EXPIRES_IN`** from the environment, and set the
  lifetimes instead: `SESSION_IDLE_TTL` (30 days by default), `SESSION_ABSOLUTE_TTL` (180 days),
  `SESSION_GRACE_SECONDS` (10). The same three keys exist as the `sessions` block of
  `config/general.ts`, where the environment wins over the file.
- **Check that a data layer is injected**, which is the real switch. A deployment that runs the core
  alone now has no renewal instead of a renewal that protects nothing (decision F28).
- Nothing to do to keep renewal off: `JWT_REFRESH=false` still means exactly that.

**What a client has to change.**

- **Every refresh token in circulation stops working**, whether it was issued by v4 or by an earlier
  5.0 alpha: it is a JWT, and a JWT is not four segments of the new format. Everybody logs in once.
  There is no window in which both formats are accepted, because accepting the old one would mean
  accepting a credential nothing can revoke.
- A bearer client sends `{ refreshToken }` and **must store the `refreshToken` it gets back**. A client
  that keeps presenting the one from the login gets one grace window and then closes its own session
  with `SESSION_REUSE_DETECTED`, which is the mechanism working as designed, not a regression.
- A browser client in cookie mode changes nothing: the cookies are rewritten by the renewal as before.
- Two tabs renewing at the same instant are fine, and that is what `SESSION_GRACE_SECONDS` is for. A
  client that renews from several processes with a clock further apart than the window needs a longer
  one, not a retry.
