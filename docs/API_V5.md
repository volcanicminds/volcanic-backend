# HTTP API (v5)

> **Status: specification. Implement exactly this.**
> Target: `@volcanicminds/backend` v5. It is the route inventory the framework ships; a consumer
> adds its own on top. Scope, roles and capabilities follow `docs/AUTHORIZATION_V5.md`; query
> parameters follow `docs/MAGIC_QUERY_V5.md`.
> Legend: **scope** is `tenant` (default) or `control`; **auth** is `public` (no token),
> `authenticated` (any valid token of that scope), or a capability name.

## 1. Map of the surface

| Group | Scope | What it is |
|---|---|---|
| `/auth/*` | tenant | authentication of application users |
| `/users/*` | tenant | user management inside a tenant |
| `/token/*` | tenant | machine credentials inside a tenant |
| `/health` | control | liveness |
| `/admin/manifest` | control | description of the manageable API |
| `/system/auth/*` | control | authentication of platform administrators |
| `/system/users/*` | control | management of platform administrators |
| `/tenants/*` | control | the tenant registry and container life cycle |

**`/tool/*` does not exist in v5.** Its only route, `POST /tool/synchronize-schemas`, rebuilt a
schema from entity metadata; that is incompatible with versioned migrations (phase 5) and is
removed with no replacement.

---

## 2. `/auth` (tenant scope)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | creates `confirmed: false`, always. Rate limited |
| POST | `/auth/unregister` | authenticated | |
| POST | `/auth/login` | public | rate limited. Returns a tenant token |
| POST | `/auth/logout` | authenticated | |
| POST | `/auth/refresh-token` | public (valid refresh token) | **verifies `tid`** against the resolved tenant (defect D-19) |
| POST | `/auth/invalidate-tokens` | authenticated | rotates `external_id` |
| POST | `/auth/validate-password` | public | |
| POST | `/auth/change-password` | authenticated | |
| POST | `/auth/confirm-email` | public | |
| POST | `/auth/forgot-password` | public | rate limited. Always 200 |
| POST | `/auth/reset-password` | public | rate limited |
| POST | `/auth/mfa/setup` | authenticated | |
| POST | `/auth/mfa/enable` | authenticated | rate limited 10/60s |
| POST | `/auth/mfa/verify` | authenticated | rate limited 10/60s |
| POST | `/auth/mfa/disable` | authenticated | |

### 2.1 Uniform failure messages (defect D-17)

`POST /auth/login` and `POST /auth/register` answer with **one** message for every rejection
that happens before a successful password verification:

| Situation | v4 response | v5 response |
|---|---|---|
| unknown email | `Invalid user` | `AUTH_INVALID_CREDENTIALS`, 401 |
| wrong password | `Wrong credentials` | `AUTH_INVALID_CREDENTIALS`, 401 |
| unconfirmed user | `User email unconfirmed` | `AUTH_INVALID_CREDENTIALS`, 401 |
| blocked user | `User blocked` | `AUTH_INVALID_CREDENTIALS`, 401 |
| email already registered | `Email already registered` | 200 with the same body as a successful registration, and no account created |
| password expired | `Password is expired` | `PASSWORD_TO_BE_CHANGED`, 403 — **stays distinct**, because it happens *after* the password verified |

The real cause is written to the log with a distinct internal code (`AUTH_UNKNOWN_EMAIL`,
`AUTH_BAD_PASSWORD`, `AUTH_UNCONFIRMED`, `AUTH_BLOCKED`). Verified that no backoffice of ours
depends on the distinct client messages: `volcanic-admin` contains none of those strings.

### 2.2 Tenant resolution for these routes

They are the only routes where the tenant **cannot** come from a token, so it comes from the
resolver: header or subdomain, whichever is configured, never both (task T-3.2). If no tenant is
resolved and tenancy is enabled, the response is 400 `TENANT_REQUIRED`.

---

## 3. `/users` (tenant scope)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/users` | capability `users` | Magic Query |
| GET | `/users/count` | capability `users` | |
| GET | `/users/:id` | capability `users` | |
| POST | `/users` | capability `users` | |
| PUT | `/users/:id` | capability `users` | optimistic lock on `version`: mismatch → 409 |
| DELETE | `/users/:id` | capability `users` | soft delete |
| POST | `/users/:id/block` | capability `users` | |
| POST | `/users/:id/unblock` | capability `users` | |
| POST | `/users/:id/mfa/reset` | capability `users` | |
| POST | `/users/:id/password/reset` | capability `users` | |
| GET | `/users/me` | authenticated | |
| PUT | `/users/me` | authenticated | |
| GET | `/users/roles` | authenticated | the role catalogue of the **current scope** |
| GET | `/users/is-admin` | authenticated | answers for the current scope: a tenant admin is not a platform admin |

---

## 4. `/token` (tenant scope)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/token` | capability `tokens` | |
| GET | `/token/count` | capability `tokens` | |
| GET | `/token/:id` | capability `tokens` | |
| POST | `/token` | capability `tokens` | `expiresAt` is required in the body; `null` must be explicit |
| PUT | `/token/:id` | capability `tokens` | |
| DELETE | `/token/:id` | capability `tokens` | |
| POST | `/token/:id/block` | capability `tokens` | **path changed**: v4 was `/token/block/:id` |
| POST | `/token/:id/unblock` | capability `tokens` | **path changed**: v4 was `/token/unblock/:id` |

---

## 5. `/system/auth` and `/system/users` (control scope, new in v5)

Platform administrators authenticate on their own routes and receive a token carrying
`scp: 'control'` and no `tid`. There is **no public registration**: system users are provisioned.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/system/auth/login` | public | rate limited, same uniform messages as §2.1 |
| POST | `/system/auth/logout` | authenticated (control) | |
| POST | `/system/auth/refresh-token` | valid control refresh token | |
| POST | `/system/auth/mfa/verify` | authenticated (control) | |
| GET | `/system/users` | capability `system-users` | |
| POST | `/system/users` | capability `system-users` | |
| GET | `/system/users/:id` | capability `system-users` | |
| PUT | `/system/users/:id` | capability `system-users` | |
| DELETE | `/system/users/:id` | capability `system-users` | |
| POST | `/system/users/:id/block` | capability `system-users` | |
| POST | `/system/users/:id/unblock` | capability `system-users` | |
| POST | `/system/users/:id/mfa/reset` | capability `system-users` | |

---

## 6. `/tenants` (control scope)

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/tenants` | `tenants:read` | Magic Query over the registry |
| GET | `/tenants/:id` | `tenants:read` | |
| POST | `/tenants` | `tenants` | creates the container, applies the tenant migration set, seeds the admin |
| PUT | `/tenants/:id` | `tenants` | |
| POST | `/tenants/:id/suspend` | `tenants` | **new**: explicit, instead of a `status` field edited by hand |
| POST | `/tenants/:id/restore` | `tenants` | |
| DELETE | `/tenants/:id` | `tenants` | soft-deletes **the registry row only**. The response says so explicitly |
| GET | `/tenants/migrations` | `migrations` | which container is at which schema version |
| POST | `/tenants/:id/migrate` | `migrations` | applies the pending migrations to one container |
| POST | `/tenants/:id/export` | `tenants:export` | |
| POST | `/tenants/:id/impersonate` | `tenants:impersonate` | body: `{ userId, reason }`. `reason` is **required** |
| POST | `/tenants/impersonate/end` | authenticated (control) | revokes the impersonation record |
| POST | `/tenants/:id/destruction-request` | `tenants:destroy` | phase 1, see §6.2 |
| DELETE | `/tenants/:id/data` | `tenants:destroy` | phase 2, see §6.2 |

### 6.1 Creation

Body: `{ name, slug, strategy, engine, locator?, config?, admin: { email, password, adminConfirmed? } }`.

- `locator` absent is derived from the slug, then sanitised. If the sanitised value differs from
  a value the caller **did** send, the response is 400 (defect D-20).
- `admin.adminConfirmed` defaults to **`true`** on this route: a tenant whose administrator
  cannot log in is not provisioned, it is broken (defect D-08). `POST /auth/register` keeps
  creating unconfirmed users: they are different paths with different meanings.
- The container is created, migrated to the current version, and the version is recorded. If the
  migration fails, the whole creation is rolled back and the registry row is not written.

### 6.2 Destruction, two phases

**Phase 1** — `POST /tenants/:id/destruction-request`

Response: `{ requestId, expiresAt, preview: { locator, sizeBytes, rowCounts, lastExportAt } }`
plus a one-time `token`, returned **once** and never stored (only its SHA-256 is kept).

**Phase 2** — `DELETE /tenants/:id/data`

Body: `{ token, slug, otp }`, all three required, **in the body and never in the URL**: a token in
the path lands in proxy access logs, browser history and tracing systems.

- `slug` must equal the tenant's slug, typed again by the operator.
- `otp` is the operator's **TOTP MFA code** when they have MFA enabled; when they do not, the
  framework sends a one-time code to their email through `transferManager` and that code is what
  goes here. MFA is the preferred path and the README says so.
- The framework **exports first** (`tenants:export` path, §6 of `docs/SCHEMA_V5.md`). If the
  export fails, or produces an empty file, the destruction does not happen.
- The event is written **before** execution, with the export reference.
- Idempotent: calling it again on an already-destroyed tenant answers 200 with `alreadyDestroyed: true`.

Failure modes and their codes: `DESTRUCTION_TOKEN_INVALID`, `DESTRUCTION_TOKEN_EXPIRED`,
`DESTRUCTION_SLUG_MISMATCH`, `DESTRUCTION_OTP_INVALID`, `DESTRUCTION_EXPORT_FAILED`.

---

## 7. `/health` and `/admin/manifest` (control scope)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | public | never touches a tenant container |
| GET | `/admin/manifest` | capability `manifest` | describes only what the caller's roles can reach |

---

## 8. Errors

Every error body is `{ statusCode, error, code, message }`, where `code` is stable and
machine-readable and `message` is for humans. `HIDE_ERROR_DETAILS` is honoured by **every** error
path, including the `onError` hook, which in v4 leaked the exception message on 500 (defect D-23).

| Status | When |
|---|---|
| 400 | malformed request, invalid query, missing tenant, sanitisation mismatch |
| 401 | missing or invalid credentials, uniformly (§2.1) |
| 403 | valid identity, insufficient scope, role or capability; expired password |
| 404 | the addressed resource does not exist **in the caller's container** |
| 409 | optimistic lock conflict, or an operation already in progress (fleet migration lock) |
| 429 | rate limit |
| 500 | unexpected. Message hidden when `HIDE_ERROR_DETAILS` is on |

**404 versus 403 across tenants.** Addressing a resource of another tenant answers **404**, never
403: 403 would confirm that the resource exists somewhere. The same rule applies to a tenant slug
that exists but is suspended, so that probing the registry from outside reveals nothing.
