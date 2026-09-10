# Migrating from v4 to v5

> **Status: complete for the v5 surface.** This file was written one line at a time, as each
> break landed, and not reconstructed at the end (task T-8.3); it was then read through in
> full, once, with the API stable. Everything below is true of the code on `develop`.
>
> Twenty sections, in the order a port meets them: the data layer and the configuration
> first, because nothing else compiles until they are right; then what changed inside a
> request; then the routes, the answers and the two core defaults. If you are porting a
> project, read §1 to §4 before touching anything, and keep §18 open while you test the
> login: the status code changed.

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
