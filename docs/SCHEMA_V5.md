# Base schema (v5)

> **Status: specification. Implement exactly this.**
> Target: `@volcanicminds/backend` v5, Drizzle data layer. Task **T-2.1** of `EVO_FRAMEWORK.md`.
> Nothing here is a suggestion: if a column, a type or an index is missing from your
> implementation, the task is not done. If something here turns out to be wrong **in practice**,
> stop, report it, and fix this document first.

The framework owns fourteen tables. Nine live **inside every tenant container** (schema, dedicated
database, or file), and the control plane carries them too, for its own identities. Five live
**only in the control plane**. A consumer adds its own tables to either side; the framework never
touches them.

| Table | Lives in | Purpose |
|---|---|---|
| `user` | tenant container (and control plane when tenancy is `none`) | end users of the application |
| `token` | tenant container | machine credentials (API tokens) |
| `change` | tenant container | audit trail of tracked writes |
| `session` | every container | live login sessions, and the refresh credential that renews them |
| `migration` | every container | applied migration log (managed by drizzle-kit) |
| `setting` | every container | settings of the container, one JSON value per key |
| `auth_flow` | every container | logins in progress (docs/AUTH_FLOW_V5.md) |
| `external_identity` | every container | identities at a provider linked to a subject |
| `access_log` | every container | the access log: logins, factors, logouts, revocations |
| `tenant` | control plane only | the tenant registry |
| `system_user` | control plane only | people who administer the platform |
| `impersonation` | control plane only | audit of impersonation sessions |
| `destruction_request` | control plane only | two-phase tenant data destruction |
| `identity_provider` | control plane only | a tenant's own identity providers, with the client secret encrypted |

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
| `approved` | boolean | no | `true` | `false` while an account created under the `approval` mode waits for an administrator (F49, docs/API_V5.md §2.5). True by default, so existing rows and accounts an administrator creates wait for nobody |
| `approved_at` | timestamp | yes | | when an administrator approved it; null for an account that never waited |
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
| `impersonation_id` | text | yes | **added in T-4.2**: which impersonation session wrote, when one did. A column rather than a key inside `contents`, because an audit trail whose actor cannot be indexed or joined is half an audit trail. `docs/AUTHORIZATION_V5.md` §6 required the fact to be recorded and this table had nowhere to put it |
| `status` | text | no | `create` / `update` / `delete` (this table first said `created`/`updated`/`deleted`; the code has always written the short forms, and the document was the side that was wrong) |
| `entity_name` | text | no | |
| `entity_id` | text | no | |
| `contents` | jsonb / json text | no | the change payload, with sensitive fields already stripped (§5) |

**Indexes**: `(entity_name, entity_id)`, `created_at`.

**No `updated_at`**: a change record is immutable. The v4 column is dropped.

### 2.4 `migration`

One table **per container**, never a central registry: when a tenant is restored from a backup
its schema version must travel back with it, and a central table would keep claiming a version
the tables no longer have. Do not hand-write rows.

| Column | Type | Null | Notes |
|---|---|:---:|---|
| `id` | uuid / text | no | |
| `set` | text | no | `control` or `tenant`. The control plane applies both sets: its own, and the application one, which lives there when the deployment has no tenants |
| `name` | text | no | the migration file's name, which is also its order |
| `hash` | text | no | SHA-256 of the file. A migration that changed after it ran is refused, not skipped |
| `applied_at` | timestamp | no | |

**Unique**: `(set, name)`.

**Correction, made in T-5.1.** This section first said the table was "managed by
`drizzle-kit`". `drizzle-kit` **generates** the SQL and the framework **applies** it, and the
distinction is not pedantic: the generated files are deliberately unqualified, because the
same file has to land in `tenant_acme` one minute and `tenant_globex` the next, and
`drizzle-kit`'s runtime migrator has no argument for that. The framework's runner puts each
migration inside its container with `SET LOCAL search_path` in a transaction, which is the one
use of a search_path T-3.1 sanctions and the reason that door was left open.

### 2.5 `session`

One row per live login, and the only thing that makes a refresh credential worth anything. Added
in T-11.1; the mechanism it serves is `docs/AUTHORIZATION_V5.md` §9.

It is declared with the application tables, so it exists **in every container**: a tenant user's
session inside that tenant's container, a platform identity's inside the control plane. A session
belongs where its subject lives, which is also what makes exporting or destroying a tenant carry
its sessions with it, and what stops the destruction of a customer from logging out the operator
who ordered it.

| Column | Type | Null | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid / text | no | generated | |
| `sid` | text | no | generated | the session's name, **stable for its whole life**, carried by every access token it issues (claim `sid`) and by the refresh credential |
| `subject_id` | text | no | | the subject's `external_id`: the same value the access token carries in `sub` |
| `scope` | text | no | `tenant` | `tenant` or `control`. Both kinds of row sit in the same container in a deployment without tenants, and a renewal refuses a session opened on the other plane |
| `secret_hash` | text | no | | SHA-256 of the current refresh secret. **The secret is never stored**, exactly as for `destruction_request.token_hash` |
| `generation` | integer | no | `1` | how many times the secret has rotated. It is also the optimistic lock of the rotation: the update names the generation it is spending, so two simultaneous renewals produce one winner instead of two live secrets |
| `previous_secret_hash` | text | yes | | the generation just replaced. Accepted for a few seconds after `rotated_at`, and presented later it is the signal of a theft |
| `rotated_at` | timestamp | yes | | when the current generation was written. The grace window is measured from here, strictly |
| `last_used_at` | timestamp | no | now | moved by a renewal and by nothing else: verifying an access token never reads this row |
| `idle_expires_at` | timestamp | no | | pushed forward at every renewal, never beyond `absolute_expires_at` |
| `absolute_expires_at` | timestamp | no | | never moves |
| `revoked_at` | timestamp | yes | | |
| `revoked_reason` | text | yes | | why it ended: `logout`, `reuse detected`, `subject is no longer valid`, and so on. A revocation nobody can explain afterwards is half a revocation |
| `ip` | text | yes | | of the request that opened the session |
| `user_agent` | text | yes | | what a device list shows |
| `impersonation_id` | text | yes | | set when the session is an impersonation (§3.3), so ending the impersonation ends the session it authorised |
| `auth_methods` | text[] / json text | yes | | the methods the login satisfied, e.g. `{password,totp}` or `{oidc,idp-mfa}`. Null on sessions opened before the flow engine: what is not known is not written as an empty list. Whether a session was born without a second factor cannot be reconstructed later, and a step-up will ask it |
| `created_at` | timestamp | no | now | |

**Indexes**: unique on `sid`, index on `secret_hash`, index on `previous_secret_hash`, index on
`(subject_id, revoked_at)`, index on `absolute_expires_at`. The first two carry the renewal: a
presented secret is hashed and looked up, once against the current generation and, failing that,
once against the previous one.

**Why two expiries.** A single deadline pushed forward at every renewal produces sessions that
never end, because a client that renews on a timer renews for ever; a single fixed deadline
throws out someone who is working. So inactivity (`idle_expires_at`) closes a session nobody is
using, the absolute lifetime (`absolute_expires_at`) closes a session that renews for ever, and a
row is dead as soon as either one is past. Both are set at login from the `sessions` block
(`docs/CONFIGURATION_V5.md` §4), and the renewal moves only the first.

**Why the hash and not the secret.** The stored value is useless to whoever reads the table: it
cannot be presented, and it cannot be reversed. A container that leaks its rows leaks the shape of
a user's sessions, never a credential that renews one.

**No `version`, no `updated_at`, no `deleted_at`.** A session is not edited by a user and is not
soft-deleted: it is revoked, with a moment and a reason, and a revocation that clearing a column
could undo is not a revocation. Expiry does not delete anything either: a row goes when
`purgeExpired` reaches it, and that is once the **first** of its two clocks has run out, whether or
not it was revoked before then. So "when did this session end, and why" keeps an answer for as long
as the row would have been usable had nobody closed it, and not one day longer.

### 2.6 `setting`

Settings of the container, one JSON value per key (F49, `SettingManagement` in
docs/MANAGERS_V5.md §12). In every container, because each plane writes where it owns the data: the
platform's rules for every tenant in the control container, a tenant's own choices in its container.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `key` | text | no | | primary key |
| `value` | jsonb (Postgres) / JSON text (SQLite) | no | | never a secret |
| `updated_by` | text | yes | | the `externalId` of whoever wrote it |
| `updated_at` | timestamp | no | now | |

### 2.7 `auth_flow`

A login in progress (docs/AUTH_FLOW_V5.md §5), added by the `0002_auth_flow_*` migrations. In every
container, like `session`, because a flow lives where its subject lives; `scope` tells a platform
identity from a tenant user where both share a container.

| Column | Type | Null | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid / text | no | generated | |
| `flow_id` | text | no | | the name the flow credential carries (`vf1.<routing>.<flow_id>.<secret>`) |
| `scope` | text | no | `tenant` | `tenant` or `control` |
| `subject_id` | text | yes | | the subject's `external_id`, set once the first stage passed. Only then does the flow hold the subject's slot |
| `candidate_subject_id` | text | yes | | the subject an unproven `email-otp` flow sends codes to, so its sends count against that subject |
| `secret_hash` | text | no | | SHA-256 of the flow secret. Emptied when the flow is retired, so no credential finds it again |
| `flow_name` | text | yes | | the index of the configured flow chosen for the subject |
| `stage_index` | integer | no | `0` | |
| `satisfied` | jsonb / json text | no | `[]` | the methods proven so far |
| `challenge_method` | text | yes | | the method of the code last sent |
| `challenge_hash` | text | yes | | the code as `HMAC-SHA256(flow secret, code)`: the key is not in this table, so a copy of it does not let anyone try the codes offline |
| `challenge_expires_at` | timestamp | yes | | |
| `challenge_attempts` | integer | no | `0` | wrong codes, TOTP included |
| `challenge_sends` | integer | no | `0` | codes sent by this flow |
| `last_sent_at` | timestamp | yes | | what the per-subject windows count |
| `state_hash` | text | yes | | SHA-256 of the `state` of a round trip to a provider |
| `external` | text | yes | | ciphertext written by the manager: the PKCE verifier, the `nonce`, the provider, the `returnTo` path, the secret of an in-flow enrolment |
| `external_result` | jsonb / json text | yes | | what a return left for the next step: the validated claims (provider, issuer, subject, email, `amr`, `acr`), or `{ failure: { method, code } }` when it failed. Written once, with `state_hash` cleared in the same statement |
| `version` | integer | no | `1` | every change is conditional on it |
| `ip` | text | yes | | |
| `user_agent` | text | yes | | |
| `created_at` | timestamp | no | now | |
| `expires_at` | timestamp | no | | absolute, never extended |

**Indexes**: unique on `flow_id`; unique on `(subject_id, scope)` where `subject_id` is not null,
which is what makes a new proven flow evict the previous one; index on `state_hash`, on
`(candidate_subject_id, last_sent_at)` and on `expires_at`.

**A retired flow keeps its row** (completed, cancelled or evicted), with every secret cleared and
its subject slot released, until its sends leave the 24-hour window: deleting it would reset the
count a restart of the login must not reset. `purgeExpired` removes it after that.

### 2.8 `external_identity`

An identity at a provider linked to a subject (docs/AUTH_FLOW_V5.md §7). `sub` is unique per issuer
only, and an address is never a key.

| Column | Type | Null | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid / text | no | generated | |
| `scope` | text | no | `tenant` | |
| `subject_id` | text | no | | the subject's `external_id` |
| `provider` | text | no | | the provider key |
| `issuer` | text | no | | the `iss` of the ID token |
| `subject` | text | no | | the `sub` of the ID token |
| `email_at_link` | text | yes | | the address when the link was made, for a person reading the list |
| `created_at` | timestamp | no | now | |
| `last_used_at` | timestamp | yes | | moved by each login through the link |

**Indexes**: unique on `(scope, provider, issuer, subject)`, index on `(subject_id, scope)`.

### 2.9 `access_log`

The access log (docs/AUTH_FLOW_V5.md §9). Append-only like `change`: no `updated_at`, no
`deleted_at`; rows leave by retention only.

| Column | Type | Null | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid / text | no | generated | UUID v7, so time-ordered |
| `occurred_at` | timestamp | no | now | |
| `scope` | text | no | `tenant` | |
| `event` | text | no | | one of a closed list, enforced by the manager |
| `outcome` | text | no | | `success` or `failure` |
| `code` | text | yes | | the refusal or outcome code, e.g. `AUTH_INVALID_CREDENTIALS` |
| `subject_id` | text | yes | | the `external_id`; null when the subject is not known. The address tried is never written |
| `methods` | text[] / json text | yes | | the methods involved |
| `provider` | text | yes | | the provider key, if any |
| `flow_id` | text | yes | | |
| `sid` | text | yes | | the session, if any |
| `ip` | text | yes | | truncated to /24 or /48 before it gets here, or absent with `ACCESS_LOG_IP=none` |

**Indexes**: `occurred_at`, `(subject_id, occurred_at)`.

Never a password, a code, a secret, a token or a claim, and no user agent: the `session` row keeps
that for the sessions that are alive.

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

### 3.5 `identity_provider`

A tenant's own identity provider (docs/AUTH_FLOW_V5.md §6.1), written by a platform operator with
the `tenants` capability. **Never in `tenant.config`**, which is serialised to whoever reads the
tenant.

| Column | Type | Null | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid / text | no | generated | |
| `tenant_id` | text | no | | |
| `key` | text | no | | lowercase letters, digits, `-`, `_`; what a login names |
| `type` | text | no | `oidc` | the only value today; ready for `saml` |
| `status` | text | no | `active` | `active` or `disabled`. A disabled row also hides the deployment's provider of the same key for that tenant |
| `config` | jsonb / json text | no | `{}` | the settings that are not secret: issuer, client id, redirect URI, scopes, linking, JIT, MFA trust |
| `secret_enc` | text | yes | | the client secret, encrypted with `MFA_DB_SECRET` (falling back to `JWT_SECRET`) |
| `created_at` | timestamp | no | now | |
| `updated_at` | timestamp | no | now | |

**Indexes**: unique on `(tenant_id, key)`. Deleted for real, not soft-deleted: a key must be reusable
after a removal.

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
