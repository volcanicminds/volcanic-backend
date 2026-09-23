# Configuration (v5)

> **Status: specification. Implement exactly this.**
> Target: `@volcanicminds/backend` v5. Tasks **T-1.1** and **T-1.4** of `EVO_FRAMEWORK.md`.
> Replaces `docs/CONFIGURATION.md`, which describes the v4 data layer.

## 1. Shape

The v4 flag `options.multi_tenant` is replaced by **two declared blocks**. The first says where
the platform's own data lives, the second whether tenants exist and how they are contained.

```ts
// config/general.ts of the consumer
export default {
  name: 'general',
  options: {
    control: {
      engine: 'postgres',                 // 'postgres' | 'sqlite' | 'libsql'
      url: process.env.DATABASE_URL,      // or the discrete DB_* variables
      schema: 'public',                   // Postgres only: explicit, never inferred
      pool: { max: 10, idleTimeoutMs: 30_000 }
    },

    // Absent = single tenant. This is the configuration of most projects.
    tenants: {
      strategy: 'schema',                 // 'schema' | 'container'
      engine: 'postgres',                 // 'postgres' | 'sqlite' | 'libsql'
      resolver: 'header',                 // 'header' | 'subdomain'
      headerKey: 'x-tenant-id',           // used when resolver = 'header'
      subdomainLevel: 1,                  // used when resolver = 'subdomain': which label to read
      containers: {
        maxOpen: 20,                      // LRU limit of live containers
        idleTimeoutMs: 300_000,           // close a container idle for this long
        poolMax: 2,                       // pool size per container
        directory: './data/tenants'       // 'container' + sqlite/libsql only
      },
      migrations: {
        checkOnResolve: true,             // a container behind its version answers with an error
        refuseStartIfControlBehind: true  // the control plane behind its version refuses to boot
      }
    },

    // The session registry, which is what a refresh credential means (T-11.13). On wherever a
    // data layer is injected; `enabled: false` gives up renewal altogether.
    sessions: {
      idleTtl: 2_592_000,                 // seconds without a renewal before the session ends
      absoluteTtl: 15_552_000,            // seconds it may live, however often it renews
      graceSeconds: 10                    // the just-rotated secret still answers, for tabs renewing together
    },

    // Who may create an account in a tenant (F49, docs/API_V5.md §2.5): the modes a tenant may
    // choose from, and the one that applies until its administrator chooses. The platform can
    // replace both at runtime (`PUT /system/account-creation`) and the set of one tenant
    // (`config.account_creation`). A rule that is not one refuses the boot.
    accountCreation: {
      allowed: ['invite', 'approval', 'open'], // or a comma-separated string
      default: 'invite'                   // closed: accounts are made by an administrator
    }
  }
}
```

**Absent means `none`.** No `tenants` block, no tenancy: the application data lives in the
control plane and `req.tenant` is never set.

**The declared default is what the code does.** No field is typed, documented and never read.
That was defect D-11 (`resolver: 'subdomain'` as the default of a resolver nobody read), and it
must not reappear in another shape.

---

## 2. The four supported combinations

Checked at boot by the capability matrix (T-1.4). Anything else logs fatal and exits 1.

| `control.engine` | `tenants` | Meaning |
|---|---|---|
| `postgres` | absent | single tenant |
| `postgres` | `strategy: 'schema'`, `engine: 'postgres'` | many tenants, one database, one schema each |
| `postgres` | `strategy: 'container'`, `engine: 'postgres'` | one database per tenant |
| `postgres` | `strategy: 'container'`, `engine: 'sqlite' \| 'libsql'` | one file per tenant |
| `sqlite` / `libsql` | absent, or `strategy: 'container'` | serverless processes: CLI, agents, desktop |

Every combination above has a **migration set in its own dialect** (`migrations/<set>/pg` and
`migrations/<set>/sqlite`, T-9.1). Until those existed, the two serverless rows were engines the
framework could open and could not prepare: the adapter worked, the containers opened, and the
only committed SQL said `timestamp with time zone`.

| Combination | Refused because |
|---|---|
| any engine + `strategy: 'schema'` on SQLite or libSQL | schemas do not exist there, and faking them with table prefixes is the `row` strategy under another name, which decision 5 forbids |
| `pglite` + any `tenants` block in production | one connection only: no isolation under concurrency |
| MongoDB, anywhere | the adapter is removed in v5 |

---

## 3. Configuration merge

The consumer's configuration is merged **deeply** over the framework defaults: objects are merged
recursively, arrays are **replaced**, `null` explicitly clears a value.

In v4 the merge was shallow (`lib/loader/general.ts:40-43`), so writing
`multi_tenant: { enabled: true }` erased `resolver`, `header_key` and `query_key` (defect D-21).
There must be a test that declares a single key inside `tenants` and asserts the siblings kept
their defaults.

---

## 4. Environment variables

The variables that shape the data layer. The rest of the environment (JWT, logging, Swagger,
MFA) is in the README table. The last column says where each value lands, because a variable
can do three different things: fill a configuration key, act as the fallback of one, or be read
where it is used without passing through the configuration at all.

| Variable | Default | Meaning | Lands in |
|---|---|---|---|
| `CONTROL_ENGINE` | `postgres` | engine of the control plane | `control.engine` |
| `DATABASE_URL` | — | control plane connection; wins over the discrete variables | `control.url` |
| `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_PASSWORD` `DB_NAME` | `127.0.0.1` `5432` `vminds` `vminds` `vminds` | discrete form, Postgres only | no key: read by the Postgres adapter, and only when `control.url` is empty |
| `DB_SCHEMA` | `public` | Postgres schema of the control plane | `control.schema` |
| `DB_POOL_MAX` | `10` | control plane pool size | `control.pool.max` |
| `DB_POOL_IDLE_MS` | `30000` | how long an idle control plane connection is kept | `control.pool.idleTimeoutMs` |
| `TENANT_CONTAINERS_MAX_OPEN` | `20` | LRU limit of live containers | fallback of `tenants.containers.maxOpen` |
| `TENANT_CONTAINERS_DIR` | `./data/tenants` | where per-tenant files live | fallback of `tenants.containers.directory` |
| `EXPORT_DIRECTORY` | `./data/exports` | where container exports are written | `export_directory` |
| `VOLCANIC_MAX_PAGE_SIZE` | `100` | Magic Query page-size clamp | no key: read by the query layer |
| `CORS_ORIGINS` | — | **required in production**: comma-separated allowlist | `origin` of the `cors` entry in `config/plugins.ts` |
| `HIDE_ERROR_DETAILS` | `true` in production | honoured by every error path, `onError` included | no key |
| `JWT_SECRET` `MFA_DB_SECRET` | — | minimum 32 characters; a weak or missing secret refuses the boot | no key |
| `AUTH_MODE` | `COOKIE` | where the session travels: `COOKIE` (httpOnly cookies; the header for integration tokens only) or `BEARER`. Any other value refuses the boot | no key |
| `COOKIE_SECRET` | — | signs the session cookies; **required in cookie mode**, so required by default, with the same strength rule as the other secrets | `secret` of the `cookie` entry in `config/plugins.ts` |
| `COOKIE_PATH_PREFIX` | — | the path a prefix-stripping proxy publishes the API under; the refresh cookie's `Path` starts with it | no key |
| `JWT_EXPIRES_IN` | `1h` | lifetime of the access token, and of its cookie in cookie mode | no key |
| `JWT_REFRESH` | `true` | `false` turns renewal off: the session ends when the access token does, and the renewal routes answer 404 | no key |
| `SESSION_IDLE_TTL` | `2592000` | seconds without a renewal before a session ends | `sessions.idleTtl`, and it **wins** over the configured value |
| `SESSION_ABSOLUTE_TTL` | `15552000` | seconds a session may live, however often it renews | `sessions.absoluteTtl`, same rule |
| `SESSION_GRACE_SECONDS` | `10` | seconds the just-rotated secret stays acceptable, for tabs renewing together. `0` is a legitimate value and means no tolerance | `sessions.graceSeconds`, same rule |
| `ACCESS_LOG_IP` | `truncate` | `truncate` keeps an IPv4 /24 or an IPv6 /48 in the access log, `none` stores no address | `accessLog.ip`, and it **wins** over the configured value |
| `ACCESS_LOG_RETENTION_DAYS` | `90` | days a tenant-plane row of the access log is kept | `accessLog.retentionDays`, same rule |
| `ACCESS_LOG_CONTROL_RETENTION_DAYS` | `180` | days a platform row of the access log is kept | `accessLog.controlRetentionDays`, same rule |
| `ACCOUNT_CREATION_ALLOWED` | `invite,approval,open` | the modes a tenant may choose from, when neither the platform nor the tenant's registry row says otherwise | `accountCreation.allowed`; a configured value replaces it |
| `ACCOUNT_CREATION_DEFAULT` | `invite` | the mode that applies until a tenant's administrator chooses; must be among the allowed ones, or the boot is refused | `accountCreation.default`, same rule |
| `ADMIN_EMAIL` | — | seeds the **first system user** on an empty control plane, and is read only then | no key |
| `DESTRUCTION_TOKEN_TTL` | `600` | seconds a destruction request stays valid | no key |
| `IMPERSONATION_TTL` | `1800` | seconds an impersonation token lasts; hard maximum 14400 | `impersonation_ttl` |
| `AUTH_RATELIMIT_MAX` | `10` | requests per window, per address, on the credential routes (login, register, forgot and reset password) | no key: read by `lib/api/auth/routes.ts` |
| `AUTH_RATELIMIT_WINDOW` | `60000` | that window, in milliseconds | no key: same |

**The two rate limit numbers are measured, not guessed.** 10 requests per 60000 ms is the pair
`npm run tune` confirmed: the work behind a refused login is a bcrypt verification, so one address
buys 14,400 attempts a day and 4.7% of one core, and 22 addresses would saturate a core. The
figures and their provenance are in `docs/TUNING.md`. The 404 handler carries a separate limit of
30 per 30s, written in `index.ts`, and it guards a `reply.code(404).send()` rather than a hash.

**Fallback, not override.** For the two `TENANT_CONTAINERS_*` variables the configuration wins
and the environment is read only when the configuration is silent. That is why the loader does
**not** fill `containers.maxOpen` and `containers.directory` with defaults: until T-10.9 it did,
the configuration was never silent, and the two variables were ignored on every boot that
declared tenants.

**Override, and deliberately the other way round.** The three `SESSION_*` variables win over the
`sessions` block, unlike the two `TENANT_CONTAINERS_*` above. The lifetime of a session is the one
setting an incident makes you want to change on a running deployment, without cutting a release of
the consumer's `config/general.ts`. A value that is not a positive number falls back to the default
rather than being read as zero, with the single exception of `SESSION_GRACE_SECONDS`, where zero
means what it says.

**The lifetimes decide when a session stops working, not when its row goes away.** Nothing is
deleted at the instant it expires: a dead session is refused by comparison, and the rows are
cleared afterwards. `npx volcanic sessions --purge` clears the ones no renewal can use from the
control plane, and `npx volcanic sessions --purge --tenants` from every active container too. It
is a deliberate command, refusing to run without `--purge`, because removing rows is all it does.
The renewal also purges opportunistically on about one call in fifty, so a deployment that never
schedules the command still does not grow the table for ever. A revoked session is not removed by
its revocation: it goes when its own clocks run out, so the reason it ended survives it.

**The access log keeps its rows for a time, then removes them.** A tenant row lives 90 days, a
platform row 180: the first covers a quarterly review and the usual time an incident takes to be
noticed, the second follows the Italian DPA's rule on system administrators (27 November 2008),
which asks for at least six months of their logical accesses. That is a reading for the
consumer's privacy adviser to confirm, not legal advice. Without tenants both kinds of row share
one container and each keeps its own threshold. `npx volcanic access-log --purge` removes the rows
past retention from the control plane, `--tenants` from every active container too; a write purges
opportunistically on about one in fifty, as the renewal does for sessions. A value that is not a
positive number falls back to the default rather than meaning "keep nothing".

**Two variables that are now read only to be refused.** `JWT_REFRESH_SECRET` and
`JWT_REFRESH_EXPIRES_IN` do nothing since 5.0: the refresh credential is opaque, so there is no
second namespace to sign, and its deadlines live in the row rather than in a claim. A deployment
that still sets either one is describing a mechanism this version does not have, so the boot logs a
warning instead of staying silent and letting it believe the session lasts what that variable says.
`JWT_REFRESH=false` kept its meaning through the change and still turns renewal off.

**Two families for one connection.** `DATABASE_URL` and the five discrete `DB_*` variables both
describe the control plane connection, and only the first passes through the configuration.
Collapsing them into one would break every deployment that uses the discrete form, so both stay
and the rule is the one above: `control.url`, filled from `DATABASE_URL`, wins; the discrete
variables are read only when it is empty.

**Not in the environment.** `tenants.engine` has no variable: unlike `control.engine`, it can
only be chosen in `config/general.ts`. Whether it should have one is an open decision, not an
oversight to fill silently.

**Three levels, and one of them is not in the environment at all.** The MFA policy (T-10.19) is
`MFA_POLICY` for the deployment, `SYSTEM_MFA_POLICY` for the control plane, and, for one customer,
`mfa_policy` inside the `config` of its registry row (`{ "mfa_policy": "MANDATORY" }`). The
deployment value is the **floor**: a plane or a tenant may only tighten it. A weaker value is
refused where it is written, with `MFA_POLICY_WEAKER`, rather than stored and ignored when read,
and a value that is not one of the four (`OFF`, `OPTIONAL`, `ONE_WAY`, `MANDATORY`) refuses the
boot. The effective policy travels back in `securityPolicy.mfaPolicy` of `/users/me` and
`/system/auth/me`, because that is where a console decides what to offer. `MANDATORY` also needs an
MFA manager: without one the boot refuses, a tenant that asks for it is refused with
`MFA_NOT_AVAILABLE`, and an enrolment answers `503` instead of the `500` the Null Object used to
raise from three layers down.

**Removed in v5**: `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` (incompatible with versioned migrations),
`VOLCANIC_CUSTOM_QUERY_OPERATORS` (the `:raw` operator is gone),
`VOLCANIC_CASE_INSENSITIVE_DEFAULT` (case sensitivity is now a property of the operator, so the
same URL cannot mean two things on two servers).

---

## 5. Defaults that change behaviour, and are meant to

| Setting | v4 | v5 | Why |
|---|---|---|---|
| CORS | `origin: '*'` with `credentials: true` | allowlist from `CORS_ORIGINS`; `credentials: true` only when the allowlist is not `*`; the insecure pair **refuses to boot in production** | browsers reject that pair anyway, and in bearer mode it leaves the API callable from anywhere (defect D-16) |
| tracking failure | swallowed, audit silently empty | the request fails, unless the route declares `tracking: { strict: false }` | an untracked write on a system that promises audit is worse than a visible error (defect D-05) |
| unsupported engine/strategy | warning, boot continues without isolation | fatal, exit 1 | invariant 2 (defect D-04) |
| query without context in multi-tenant | falls back to the global connection | throws | invariant 3 (defect D-06) |
| `_logic` that does not parse | silently becomes `AND` of everything | 400 | defect D-13 |
| MFA policy | one value for the whole deployment, read only by the tenant routes | three levels (deployment floor, control plane, tenant), enforced on both planes | `MANDATORY` obliged every customer's users and none of the operators who can destroy a customer (T-10.19) |
| refresh token | a second JWT, verified and never consumed: one string from the login to its expiry | an opaque credential against the `session` registry, rotated at every renewal, with reuse detection | a credential that cannot be spent cannot be revoked: the theft of one was invisible, `logout` cleared cookies while the copy kept renewing, and rotating `external_id` was the only revocation there was (T-11.8) |
| renewal without a data layer | a refresh token that verified and renewed for ever | the renewal routes answer `404` | a refresh credential nobody can consume never expires; F28 prefers no renewal to one that only looks like a session |

---

## 6. Peer dependencies

Declared optional; install only what the chosen engines need.

| Subpath | Requires |
|---|---|
| `@volcanicminds/backend/db` with Postgres | `drizzle-orm`, `pg`, `bcrypt` |
| the same with SQLite | `drizzle-orm`, `better-sqlite3`, `bcrypt` |
| the same with libSQL | `drizzle-orm`, `@libsql/client`, `bcrypt` |
| development | `drizzle-kit` |

`typeorm`, `reflect-metadata` and `pluralize` are no longer peer dependencies of anything.
