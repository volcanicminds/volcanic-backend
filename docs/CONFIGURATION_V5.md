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

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — | control plane connection; wins over the discrete variables |
| `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_PASSWORD` `DB_NAME` | `127.0.0.1` `5432` `vminds` `vminds` `vminds` | discrete form |
| `DB_POOL_MAX` | `10` | control plane pool size |
| `TENANT_CONTAINERS_MAX_OPEN` | `20` | LRU limit |
| `TENANT_CONTAINERS_DIR` | `./data/tenants` | where per-tenant files live |
| `VOLCANIC_MAX_PAGE_SIZE` | `100` | Magic Query page-size clamp |
| `CORS_ORIGINS` | — | **required in production**: comma-separated allowlist |
| `HIDE_ERROR_DETAILS` | `true` in production | honoured by every error path, `onError` included |
| `JWT_SECRET` `JWT_REFRESH_SECRET` `MFA_DB_SECRET` | — | minimum 32 characters; a weak or missing secret refuses the boot |
| `ADMIN_EMAIL` | — | seeds the **first system user** on an empty control plane, and is read only then |
| `DESTRUCTION_TOKEN_TTL` | `600` | seconds a destruction request stays valid |
| `IMPERSONATION_TTL` | `1800` | seconds an impersonation token lasts; hard maximum 14400 |

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
