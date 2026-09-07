# Migrating from v4 to v5

> **Status: accumulating.** This file is written one line at a time, as each break lands,
> and not reconstructed at the end (task T-8.3). Everything below is already true of the
> code on `develop`; the phases still open will add rows, never remove them.

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

## 13. Routes that no longer exist

| Route | Why |
|---|---|
| `POST /tool/synchronize-schemas`, `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` | schemas are versioned migrations now |
| `POST /tenants/impersonate` | it left no record and its privilege check was dead code; it returns with a persisted, revocable record |
| `switchContext` on the tenant manager | choosing a container is not a session change any more |
