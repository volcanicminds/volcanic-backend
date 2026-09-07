# Base schema (v5)

> **Status: specification. Implement exactly this.**
> Target: `@volcanicminds/backend` v5, Drizzle data layer. Task **T-2.1** of `EVO_FRAMEWORK.md`.
> Nothing here is a suggestion: if a column, a type or an index is missing from your
> implementation, the task is not done. If something here turns out to be wrong **in practice**,
> stop, report it, and fix this document first.

The framework owns eight tables. Four live **inside every tenant container** (schema, dedicated
database, or file). Four live **only in the control plane**. A consumer adds its own tables to
either side; the framework never touches them.

| Table | Lives in | Purpose |
|---|---|---|
| `user` | tenant container (and control plane when tenancy is `none`) | end users of the application |
| `token` | tenant container | machine credentials (API tokens) |
| `change` | tenant container | audit trail of tracked writes |
| `migration` | every container | applied migration log (managed by drizzle-kit) |
| `tenant` | control plane only | the tenant registry |
| `system_user` | control plane only | people who administer the platform |
| `impersonation` | control plane only | audit of impersonation sessions |
| `destruction_request` | control plane only | two-phase tenant data destruction |

**Rule that decides where a table goes** (invariant 7): outside the customer's container sits
only what you could publish. The control plane holds identifiers, counters, status and
configuration. Never customer content.

---

## 1. Conventions

These apply to every table below. They are not repeated in each definition.

| Concern | Postgres | SQLite / libSQL |
|---|---|---|
| Primary key | `id uuid PRIMARY KEY` | `id text PRIMARY KEY` |
| Id generation | **in process**, UUID v7 | same |
| Timestamps | `timestamptz` (`timestamp with time zone`) | `integer` = epoch **milliseconds**, UTC |
| Booleans | `boolean` | `integer` 0/1 |
| String arrays | `text[]` | `text` holding a JSON array |
| Free-form objects | `jsonb` | `text` holding JSON |
| Soft delete | `deleted_at` nullable; a row with `deleted_at` set is invisible to every default query | same |

**A container is chosen by qualifying its tables, never by a session setting.** The Postgres
factories take the schema name and produce `"tenant_acme"."user"`, which is what makes T-3.1
possible. One exception is forced by the driver: Drizzle refuses `pgSchema('public')`, because
Postgres resolves unqualified names there anyway, so a control plane living in `public` emits
unqualified SQL. Two answers, both applied: prefer a **named** schema for the control plane,
which is qualified like any other, and when it is `public` the adapter pins `search_path` on
the connection itself at connect time. A value identical on every connection, that no request
ever changes, is configuration and not session state.

**Column naming is `snake_case` in the database and `camelCase` in TypeScript.** Drizzle maps
the two explicitly in the table definition: never rely on an automatic conversion.

**Id generation.** The framework generates UUID **v7** in process. Never ask the database for a
free identifier with a `do/while` loop (that is defect D-28). v7 is time-ordered, so it keeps
b-tree inserts local and gives a free creation-time ordering. Implement it in
`lib/database/uuid.ts` (about twenty lines: 48-bit big-endian millisecond timestamp, 4-bit
version, 74 bits of `crypto.randomBytes`, variant bits set); do not add a dependency for it.

**Timestamps carry a zone.** Postgres columns are `timestamptz`, never naive `timestamp`. This
closes a decision that had been taken before and never migrated. On SQLite the equivalent is an
integer epoch in milliseconds, always UTC: no local time ever reaches the database.

**Optimistic locking.** `user` and `token` keep a `version` integer, incremented by the data
layer on every update. An update whose `version` does not match responds `409`.

---

## 2. Tables inside the tenant container

### 2.1 `user`

| Column | Type | Null | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid / text | no | generated | primary key |
| `external_id` | text | no | generated | **public** identifier: it is the JWT subject. Rotating it invalidates every token of that user (`resetExternalId`) |
| `username` | text | yes | | unique per container when present |
| `email` | text | no | | unique per container, stored lowercase, trimmed |
| `password` | text | no | | bcrypt hash, cost 12. Never selected by default (see §5) |
| `confirmed` | boolean | no | `false` | `POST /auth/register` always creates `false`; tenant provisioning may create `true` (T-6.1) |
| `confirmed_at` | timestamp | yes | | |
| `password_changed_at` | timestamp | yes | | drives password expiry |
| `blocked` | boolean | no | `false` | |
| `blocked_reason` | text | yes | | |
| `blocked_at` | timestamp | yes | | |
| `reset_password_token` | text | yes | | carries its own `<epochSeconds>.` expiry prefix. Never selected by default |
| `reset_password_token_at` | timestamp | yes | | |
| `confirmation_token` | text | yes | | never selected by default |
| `roles` | text[] / json text | no | `[]` | role **codes**, resolved against the role catalogue at boot |
| `is_founder` | boolean | no | `false` | **new in v5**: replaces the process-wide `ADMIN_EMAIL` comparison (defect D-27). Founder is a property of the row in its container, not of the environment |
| `mfa_enabled` | boolean | no | `false` | |
| `mfa_secret` | text | yes | | AES-256-GCM, format `v2:salt:iv:authTag:ciphertext`. Never selected by default |
| `mfa_type` | text | yes | | `totp` is the only value today |
| `mfa_recovery_codes` | text[] / json text | yes | | hashed, never plaintext |
| `mfa_last_used_counter` | integer | yes | | absolute TOTP step already consumed: rejects replay inside the validity window |
| `version` | integer | no | `1` | optimistic lock |
| `created_at` | timestamp | no | now | |
| `updated_at` | timestamp | no | now | |
| `deleted_at` | timestamp | yes | | soft delete |

**Indexes**: unique on `email`, unique on `external_id`, unique on `username` where not null,
index on `reset_password_token`, index on `confirmation_token`, index on `deleted_at`.

**Removed from v4**: nothing. Every v4 field survives; `is_founder` is added.

### 2.2 `token`

| Column | Type | Null | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid / text | no | generated | |
| `external_id` | text | no | generated | the credential presented by the client |
| `name` | text | no | | |
| `description` | text | yes | | |
| `blocked` | boolean | no | `false` | |
| `blocked_reason` | text | yes | | |
| `blocked_at` | timestamp | yes | | |
| `roles` | text[] / json text | no | `[]` | |
| `expires_at` | timestamp | yes | | **new in v5**: a machine credential without an expiry is a permanent secret. `null` means no expiry and must be an explicit choice |
| `version` | integer | no | `1` | |
| `created_at` | timestamp | no | now | |
| `updated_at` | timestamp | no | now | |
| `deleted_at` | timestamp | yes | | |

**Indexes**: unique on `external_id`, index on `deleted_at`.

### 2.3 `change`

The audit trail. **Append-only**: rows are never updated and never soft-deleted.

| Column | Type | Null | Notes |
|---|---|:---:|---|
| `id` | uuid / text | no | **new in v5**: v4 had no primary key |
| `created_at` | timestamp | no | |
| `user_id` | text | yes | `null` when the write came from a job or a machine token |
| `token_id` | text | yes | **new in v5**: which credential wrote, when it was not a user |
| `status` | text | no | `created` / `updated` / `deleted` |
| `entity_name` | text | no | |
| `entity_id` | text | no | |
| `contents` | jsonb / json text | no | the change payload, with sensitive fields already stripped (§5) |

**Indexes**: `(entity_name, entity_id)`, `created_at`.

**No `updated_at`**: a change record is immutable. The v4 column is dropped.

### 2.4 `migration`

Managed by `drizzle-kit`. One table **per container**, never a central registry: when a tenant
is restored from a backup its schema version must travel back with it. Do not hand-write rows.

---

## 3. Tables in the control plane

### 3.1 `tenant`

Replaces the v4 entity, whose `dbSchema` / `dbName` pair could not describe a container.

| Column | Type | Null | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid / text | no | generated | |
| `name` | text | no | | human label |
| `slug` | text | no | | unique, lowercase, `[a-z0-9-]{2,50}`. It is what an operator types to confirm destruction |
| `strategy` | text | no | | `schema` \| `container` |
| `engine` | text | no | | `postgres` \| `sqlite` \| `libsql` |
| `locator` | text | no | | **the one field that says where the data is**: the schema name for `schema`, the database name for a Postgres container, the file path for a SQLite/libSQL container. Sanitised **once, before saving** (§4) |
| `config` | jsonb / json text | no | `{}` | per-tenant options: connection overrides, limits, feature flags. Never customer content |
| `status` | text | no | `active` | `active` \| `suspended` \| `archived` |
| `schema_version` | text | yes | | last migration applied to this container, mirrored from its own `migration` table for read-only reporting. **Not** the source of truth |
| `created_at` | timestamp | no | now | |
| `updated_at` | timestamp | no | now | |
| `deleted_at` | timestamp | yes | | soft delete of the **registry row**. It does not remove data: that is `destruction_request` |

**Indexes**: unique on `slug`, unique on `(engine, locator)`, index on `status`.

### 3.2 `system_user`

The people who administer the platform. **A system user is not a tenant user**: it lives in
another table, in another container, with its own role namespace (see `docs/AUTHORIZATION_V5.md`).

Columns: same authentication surface as `user` (`id`, `external_id`, `email`, `password`,
`blocked*`, `mfa_*`, `version`, timestamps) plus:

| Column | Type | Null | Default | Notes |
|---|---|:---:|---|---|
| `roles` | text[] / json text | no | `[]` | **system role codes only**, all prefixed `system:` |
| `mfa_enabled` | boolean | no | `false` | strongly recommended: it is the second factor of tenant destruction (T-6.3) |

It carries **no** `confirmed` / `confirmation_token`: system users are provisioned, never
self-registered. There is no public registration route for them.

### 3.3 `impersonation`

Closes defect D-18: in v4 impersonation left no persisted trace.

| Column | Type | Null | Notes |
|---|---|:---:|---|
| `id` | uuid / text | no | referenced by the `imp` claim of the issued token |
| `system_user_id` | text | no | who |
| `tenant_id` | text | no | into which tenant |
| `target_user_id` | text | no | as whom |
| `reason` | text | no | free text, **required**: an impersonation without a stated reason is refused |
| `ip` | text | yes | |
| `user_agent` | text | yes | |
| `created_at` | timestamp | no | |
| `expires_at` | timestamp | no | |
| `revoked_at` | timestamp | yes | set when the session is ended early |

**Indexes**: `(tenant_id, created_at)`, `system_user_id`.

### 3.4 `destruction_request`

The first phase of T-6.3. A row is single-use.

| Column | Type | Null | Notes |
|---|---|:---:|---|
| `id` | uuid / text | no | |
| `tenant_id` | text | no | |
| `system_user_id` | text | no | who asked |
| `token_hash` | text | no | SHA-256 of the one-time token. **The token itself is never stored** |
| `preview` | jsonb / json text | no | what phase 1 reported: container size, row counts per table, last export |
| `created_at` | timestamp | no | |
| `expires_at` | timestamp | no | ten minutes after creation, configurable |
| `consumed_at` | timestamp | yes | set when phase 2 succeeds |
| `export_ref` | text | yes | reference to the mandatory export that preceded destruction |

**Indexes**: `tenant_id`, `expires_at`.

---

## 4. Locator sanitisation

`locator` is the only user-influenced value that reaches DDL. Rules, all mandatory:

1. Sanitise **once, before saving**. The stored value and the used value are the same string.
   In v4 they were not, and a registry row could name a schema that did not exist (defect D-20).
2. The sanitised form must match `^[a-z][a-z0-9_]{1,62}$` for a Postgres schema or database
   name; for a file path it must resolve **inside** the configured container directory, with no
   `..` segment and no symlink escape.
3. If the sanitised value differs from what the caller sent, respond **400** and name the
   difference. Never accept silently a name different from the one requested.
4. Never interpolate `locator` into SQL by string concatenation, even after sanitisation: use
   the quoting helper of the adapter.

---

## 5. Fields never returned

The data layer strips these from every result, at every depth, including nested relations:

```
password, mfaSecret, mfaRecoveryCodes, resetPasswordToken, confirmationToken
```

The list is overridable per application, additively only: an application may add fields, never
remove one of these five.

**New in v5 and not negotiable**: these fields are also **not filterable**. A query that
mentions one of them in a filter, a sort or `_fields` responds **400**. Filtering on a password
hash is an oracle, and v4 allowed it.

---

## 6. What a consumer must do

1. Declare its own tables in its own schema files, importing the framework tables when it needs
   a foreign key to `user`.
2. Generate migrations for **its** tables with its own drizzle-kit configuration (two sets:
   control plane and tenants, see T-5.2).
3. Never redefine a framework table. If a framework table lacks a field the application needs,
   the application adds its own table with a foreign key: extending a framework table breaks
   every future framework migration.
