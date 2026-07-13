# Authorization Model — Roles, Capabilities & Admin Governance

> **Status: DESIGN PROPOSAL (not yet implemented).** This document specifies the target
> authorization model for `@volcanicminds/backend`. It supersedes the ad-hoc `backoffice`
> role. Nothing here is coded yet — this is the spec to review before implementation.
> Complements `AUTH_COMPOSABLE_EVOLUTION.md` (login *flows*); this doc is about *authorization*.
>
> **Target release: `4.0.0`** — a major, matching the breaking changes in §9.

## 1. Motivation

Today the framework ships three built-in roles — `public`, `admin`, `backoffice` — but only two
are coherent. `admin` is a well-defined universal superuser; `public` is the anonymous role.
`backoffice`, instead, is an **accreted role**: it exists only as a scattered set of route grants
(`GET /admin/manifest`, the whole `/token` API, and `/users/:id/block|unblock`) with no designed
persona. It can block a user but not list users; it can fully CRUD integration tokens. It answers
no clear question ("limited operator *of what*?") because the framework has no domain resources of
its own.

An opinionated framework must be **coherent**. The target model keeps exactly two authority
primitives built in — **anonymous** and **superuser** — and expresses every "in-between" operator
as a **capability** grantable to a **consumer-defined role**.

## 2. Roles

### 2.1 Built-in roles

| Role | Meaning |
|---|---|
| `public` | Implicit anonymous role. Routes with `roles: []` are open to everyone. |
| `admin` | **Universal superuser.** Appended to every route's allowed roles at load (`lib/loader/router.ts`). Within a tenant, can do everything. |

`backoffice` is **removed** from the built-in catalog.

### 2.2 Consumer-defined roles

Any project that needs an operator role (e.g. `backoffice`, `editor`, `support`) **declares it in
its own `config/roles.ts`** and grants it the capabilities it needs. The framework never ships a
half-defined middle role again.

> **Breaking change.** Consumers currently referencing `backoffice` must re-declare it in
> `config/roles.ts`. Roles are merged from consumer config, so this is a one-line addition.

### 2.3 Overriding built-in roles (protected)

`admin` and `public` are **protected built-ins**. A consumer's `config/roles.ts` may override
**only their `name` and `description`** (labels); their `code` and `capabilities` are **locked**, and
any capabilities provided for them are ignored. This requires the role loader to move from
replace-by-`code` to a **protected merge**: a code matching a built-in → keep the built-in's `code`
and (empty) capability set, apply only the provided labels; any **new** code → added verbatim (full
freedom over `code`, labels, and `capabilities`).

Neither protected role can carry capabilities, by design:

- `admin` already satisfies every capability via the router append — listing capabilities on it is a
  no-op.
- `public` is the anonymous/base role. Access for `public` comes from routes declared `roles: []`,
  **not** from capabilities: since any route whose allowed roles include `public` is treated as fully
  public (open to everyone, incl. anonymous), granting a capability to `public` would collapse that
  capability's routes to anonymous-open — defeating the capability.

Capabilities therefore live **only on consumer-defined roles**.

> **"Any authenticated user" is not a capability.** That tier is the existing idiom `roles: []` + the
> `isAuthenticated` middleware (e.g. `/users/me`): anonymous → 401, any logged-in subject → allowed.
> Do not model it as a capability on `public`.

## 3. Capabilities

### 3.1 Shape & lifecycle

Roles gain an optional capability list:

```ts
{ code, name, description, capabilities?: string[] }   // default: none
```

- Capabilities are **named only in configuration** and **resolved once at server boot** — **never
  at runtime**. No role, no user, no API can create, assign, or redefine a capability. They are
  static structure of the code/config.
- `admin` and `public` hold **no** capabilities (see §2.3): `admin` because it is the superuser
  (appended everywhere, so it satisfies every capability implicitly); `public` because its access is
  defined by `roles: []` routes, not capabilities. Capabilities live only on consumer-defined roles.

### 3.2 Framework-reserved capabilities

The framework hard-codes and honors exactly three capability names on its own routes:

| Capability | Grants access to | Framework routes |
|---|---|---|
| `manifest` | Loading the admin console manifest | `GET /admin/manifest` |
| `users` | User management | `/users/*` (CRUD + block/unblock + reset) |
| `tokens` | Integration-token management | `/token/*` |

Consumers may coin **their own** capability names for **their own** routes; the vocabulary is open,
the framework only reserves the three above.

### 3.3 Enforcement mechanism (boot-time, gate unchanged)

A route declares the capability it requires:

```ts
config: { requireCapability: 'users' }   // default: none → admin-only (via the global append)
```

At router load, the loader resolves the route's effective allowed roles to
**`[admin] ∪ { roles whose config declares that capability }`**. The request-time gate
(`lib/hooks/onRequest.ts`) is unchanged — it still performs a plain role intersection, and `admin`
always passes via the global append.

**Consequence (desirable):** the generated **manifest reflects capability holders automatically**.
The manifest generator reads each route's resolved allowed roles, so sub-admin role codes appear in
the per-capability `roles[]`, and the admin UI's access control shows/hides correctly with no
special casing. (Implementation note: the loader must write the resolved role set to the same field
both the request gate and `lib/manifest/generator.ts` read.)

### 3.4 Route → capability mapping

| Route group | Today | Target |
|---|---|---|
| `GET /admin/manifest` | `[admin, backoffice]` | `requireCapability: 'manifest'` |
| `/users/*` | `[admin]` | `requireCapability: 'users'` |
| `/token/*` | `[admin, backoffice]` | `requireCapability: 'tokens'` |
| `/tenants/*` | `[admin]` | unchanged — platform/system surface, not a sub-admin capability |

### 3.5 Boot-time validation (fail-fast)

Role references and capability requirements are validated **once at boot**, after the role catalog
(`config/roles.ts` + built-ins) and all routes are loaded. The server **fails fast** on
misconfiguration instead of silently dropping routes. (Today, an unknown role reference falls into a
`try/catch` in `lib/loader/router.ts` that sets `config.enable = false` — the route disappears with
no error.)

- **Unknown role on a route → fatal.** If a route is gated on a role code absent from the merged
  catalog (e.g. `backoffice` or `pippo` never declared in `config/roles.ts`), startup **aborts** with
  an explicit error. All offenders are **aggregated** and reported together (route method, path,
  handler + role), not one at a time.
- **Named errors require string-code references.** Both reference forms are accepted and validated:
  a missing role referenced **by string code** (`roles: ['pippo']`) is reported **by name**; an
  **object reference** that resolves to `undefined` (`roles: [roles.pippo]`) can only be reported as
  "undefined role on route X" — the name is already lost at import time. String codes give the better
  diagnostics; migrating core routes to string codes (optional) yields uniform named errors.
- **Capabilities (advisory, non-fatal).** A `requireCapability` naming a capability that no role
  holds is **valid** — the route stays admin-only via the append — so it is at most a startup
  **warning**, never a failure. The reserved names `users` / `tokens` / `manifest` are always valid.

## 4. The admin apex — "sub-admins never prevail over real admins"

`admin` is a **restricted group** (default size 1, see §5) that governs the whole privilege
structure. Capability holders are **operational admins**: they can run the machine, but they can
never touch the apex nor become it. Three rules enforce this; each closes a concrete backdoor.

**Rule A — no elevation to `admin`.** A capability holder can never create or assign the `admin`
role — to a **user** *or* to an **integration token**. This closes a real backdoor: integration
tokens carry `roles[]` used for authorization (`onRequest` normalizes `req.token.roles`), so a
`tokens` holder minting a `roles:['admin']` token would obtain admin. Only a real `admin` can grant
`admin`, and only when `allow_multiple_admin` is `true` (§5).

**Rule B — no action against admins.** A capability holder can never `update` / `delete` / `block` /
`unblock` / `reset-password` / `reset-mfa` a subject that currently **is** an admin. Admins are
**visible** in list/read to `users` holders, but **untouchable** except by a real admin.

**Rule C — capabilities are immutable.** No one can create or associate capabilities at runtime;
they live only in role definitions resolved at boot. A `users` holder **can assign roles** to users
but **cannot redefine capabilities**.

### 4.1 Accepted implication — sub-admin self-expansion

Because capabilities are immutable but role-assignment is permitted, a `users` holder may assign any
**non-`admin`** role — including roles that carry `tokens`/`manifest`/`users`. A `users` sub-admin
can therefore **spawn or expand other sub-admins** (and self-grant existing capabilities), but can
**never reach `admin`**. This auto-expansion *below the apex* is **explicitly accepted**: sub-admins
may become "de facto admins" while remaining powerless against real admins.

## 5. Admin governance

- **`config.options.allow_multiple_admin`** (default `false`) sets the posture:
  - `false` → single-admin: the API will not mint a second admin.
  - `true` → the founder can create other admins, who can create others (chain).
- The `allow_multiple_admin` guard must be enforced **symmetrically** on **create**, **update**, and
  **token creation** (today it exists only on `POST /users` create; `update` and token creation
  bypass it — see §8).
- **Never zero admins.** At runtime, delete / demote / block is refused if it would drop the admin
  count to zero (anti-lockout guard). This is separate from, and additional to, the sovereign
  founder protection (§6).

## 6. Genesis of the first admin — Option Z

### 6.1 Principle

**An admin is always born from provisioning, never from public self-registration.** This is already
how multi-tenant works: `createTenant` seeds the tenant admin during provisioning
(`lib/database/typeorm/loader/tenantManager.ts`). We align the base/system bootstrap to the same
principle.

- **`POST /auth/register` never creates an `admin`** — not even the first one. It only creates
  non-privileged users.
- **`ADMIN_EMAIL` (env) is mandatory** and identifies the **sovereign founder**.

> **Gated on a configured data layer.** Genesis needs a user store, so it runs only when a live
> connection is present (`global.connection`; the core does not start a DB itself, the consumer does).
> A core-only deployment with no data layer performs no genesis and does not require `ADMIN_EMAIL`.
> When the data layer *is* present, the reconciliation in §6.3 applies — including the fail-fast when
> there is no admin and no `ADMIN_EMAIL` to bootstrap one.

### 6.2 Founder identity = config match (no new column)

The founder is "the user whose `email === ADMIN_EMAIL`" (normalized lowercase/trim). Protection is
**derived from the config match** at each mutation — **no persistent `protected` column, no
migration**. Transfer/offboarding fits the env-driven deploy: **change `ADMIN_EMAIL` and redeploy →
the new address becomes the founder; the previous one reverts to an ordinary admin.**

### 6.3 Boot reconciliation (base/system schema)

Runs only single-tenant with a live data-layer connection. Multi-tenant tenant admins come
from provisioning and the system founder is seeded out-of-band, so genesis is skipped there.

1. `ADMIN_EMAIL` **set** → look up the user with that email:
   - **not found →** create it as `admin`. Password: `ADMIN_PASSWORD` if provided, otherwise a
     strong random one **written to stdout only** (never the structured logger, which may be
     shipped/retained); rotation on first login is a documented follow-up, not yet enforced (§10).
   - **found but not admin →** promote it to `admin` (config is authoritative).
   - **found and admin →** no-op.
2. `ADMIN_EMAIL` **unset** → allowed only when an admin already exists (peer admins, governed by
   never-zero); if there are **zero admins**, **fail-fast** at startup.

The instance therefore **never boots with zero admins**: either the founder is provisioned from
`ADMIN_EMAIL`, or an admin already exists, or startup aborts.

### 6.4 Sovereign founder protections (runtime)

The founder (`email === ADMIN_EMAIL`) is protected against **everyone, admins included**:

- **not deletable**, **not demotable** (cannot lose the `admin` role), **not blockable**;
- **email is immutable via API** (only changeable via env + redeploy — required to keep the config
  match stable);
- **sovereign credentials:** password/MFA are rotatable **only by the founder themselves** or via
  env/redeploy. **No other admin can reset the founder** (prevents a co-admin from hijacking the
  apex; recovery goes through operator-level env access).

## 7. Multi-tenant

- **System founder = platform apex.** `ADMIN_EMAIL` protects the **system/base** founder only. That
  identity is sovereign over the whole platform.
- **Tenant admins are NOT sovereign.** They are born from provisioning (`createTenant`) and are the
  apex **within their own tenant**, subject to the standard rules (never-zero-admins guard,
  `allow_multiple_admin`). They receive **no founder protection**.
- **Cross-tenant authority = impersonation (already implemented).** There is no direct cross-tenant
  table access. The system admin manages the tenant registry (`/tenants`, `tenantContext:false`,
  public schema) and **impersonates** into a target tenant via `POST /tenants/impersonate`, which
  mints a **tenant-bound** token (`tid` = target tenant, `impersonator` = audit). The `tid`
  invariant (`onRequest` rejects `token.tid !== req.tenant.id`) plus schema isolation keep every
  data operation single-schema and tenant-bound.
- Per-tenant "founder protection" (a sovereign admin *inside* a tenant) is **out of scope** for now;
  it would require storing the founder email on the `Tenant` record.

## 8. Existing rough edges to fix as part of this work

Found while auditing the current code; the capability model is not safe until these are closed:

1. **`allow_multiple_admin` asymmetry** — enforced on `POST /users` create only; `PUT /users/:id`
   (`lib/api/users/controller/user.ts`) does **not** re-check, so an admin can elevate anyone to
   admin via update regardless of the flag. Also missing on token creation.
2. **No last-admin protection** — `remove` deletes by id with no guard; the last admin can be
   deleted → total lockout.
3. **Token role backdoor** — integration tokens carry authorization `roles[]`; must be covered by
   Rule A (no `admin` on tokens).
4. **Public register-as-admin** — `POST /auth/register` currently mints the first admin (land-grab
   on a fresh, exposed instance; also creates it *unconfirmed*, a chicken-and-egg for login).
   Replaced by Option Z (§6).
5. **System-admin detection dead branch** — `lib/api/tenants/controller/tenants.ts` checks
   `req.user?.tenantId === 'system'`, but the `User` entity has no `tenantId`; detection effectively
   relies on `req.tenant?.slug === 'system'`. Consolidate.
6. **`system` tenant provisioning/doc** — the `system` tenant is recognized by slug but never
   created by the framework; document how it is provisioned.

## 9. Breaking changes & migration

| Change | Impact | Migration |
|---|---|---|
| `backoffice` removed from built-ins | Consumers referencing it | Re-declare in `config/roles.ts` with the needed `capabilities` |
| `/auth/register` no longer creates `admin` | Bootstrap flow | Use the `ADMIN_EMAIL` genesis (§6) |
| `ADMIN_EMAIL` now mandatory | Startup | Set it in the environment; boot fail-fast without it |
| `/users`, `/token`, `/admin/manifest` re-gated to capabilities | Non-admin access | Grant `users` / `tokens` / `manifest` to the consumer role |

Released as **`4.0.0`** (major). A route gated on a now-undeclared role fails fast at boot (§3.5) —
this is intentional, so the removal of `backoffice` surfaces loudly in any consumer that forgot to
re-declare it, instead of silently disabling routes.

## 10. Out of scope (later)

- Per-tenant sovereign founder protection.
- `users` / `tokens` capability read/write split (kept coarse for now).
- A `tenants` capability (tenant management stays hard `[admin]` / system).
- Forced password + MFA rotation on the founder's first login (a genesis-created password is
  logged once; rotation is not yet enforced).
