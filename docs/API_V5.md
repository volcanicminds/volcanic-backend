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
| `/admin/manifest` | tenant | description of the manageable API, for a customer's console |
| `/system/manifest` | control | description of the manageable API, for the platform console |
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
| POST | `/auth/login` | public | rate limited. Returns a tenant token: in cookie mode, the default, it is written into `auth_token` and `refresh_token` and the body carries `token: null`, `refreshToken: null` (MIGRATION §24) |
| POST | `/auth/logout` | authenticated | **revokes the session row** of the presenting token, then clears the cookies (§2.3) |
| POST | `/auth/refresh-token` | public (valid refresh credential) | rotates the session: §2.3. **Verifies the routing segment** against the resolved tenant (defect D-19) |
| POST | `/auth/invalidate-tokens` | authenticated | revokes **every** session of the user, then rotates `external_id` |
| GET | `/auth/sessions` | authenticated | where this account is logged in, with the current session marked (§2.4) |
| DELETE | `/auth/sessions/:id` | authenticated | closes one session of the caller; somebody else's answers **404** (§2.4) |
| POST | `/auth/validate-password` | public | |
| POST | `/auth/change-password` | authenticated | |
| POST | `/auth/confirm-email` | public | |
| POST | `/auth/forgot-password` | public | rate limited. Always 200 |
| POST | `/auth/reset-password` | public | rate limited |
| POST | `/auth/mfa/setup` | authenticated | 409 `MFA_ALREADY_ENABLED` when a factor is already active: replacing one goes through disable |
| POST | `/auth/mfa/enable` | authenticated | rate limited 10/60s; 409 `MFA_ALREADY_ENABLED` as above, so a pre-auth token cannot overwrite an enrolled factor |
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

### 2.3 Renewal, logout and revocation

Since T-11.8 the refresh token is not a JWT: it is an opaque credential, `vs1.<routing>.<sid>.<secret>`,
backed by a row in the `session` table of the subject's container. The mechanism and the reasons
are in `docs/AUTHORIZATION_V5.md` §9; what a client has to know is here.

**The request.** In cookie mode the body is empty and the credential is read from the
`refresh_token` cookie, which the browser sends only to this path. In bearer mode the body is
`{ refreshToken }` and nothing else: the access token is no longer part of the request, because
everything the old bearer renewal checked by comparing two JWTs (same subject, same tenant, issued
recently enough) is a property of the row, which names one subject, lives in one container and
carries its own clocks.

**The answer.** `200` with `{ token, refreshToken }` in bearer mode, both of them new and both
declared by the response schema, so both really reach the client: **every renewal rotates the
credential**, and a client must store what it receives and present that next time. In cookie mode
both fields are `null` and the two cookies are rewritten. Losing a race with
another renewal of the same session is not a failure: the caller gets a fresh access token and
keeps the credential it already holds, which the grace window still accepts.

**The refusals**, all of them on both planes:

| Code | Status | When |
|---|---|---|
| `REFRESH_REQUIRED` | 401 | no credential on the request, or one that is malformed, unknown, expired or revoked. Deliberately one answer for all of them |
| `SESSION_REUSE_DETECTED` | 401 | a spent generation came back outside the grace window. **The whole session is revoked** and the reason is written in the row |
| `TENANT_MISMATCH` | 403 | the routing segment names a tenant other than the one the request resolved to |
| `SCOPE_MISMATCH` | 403 | a tenant session presented to the control plane's renewal, or the reverse |
| `NOT_FOUND` | 404 | this deployment keeps no session registry, or `JWT_REFRESH=false`. There is no renewal to offer, and saying so is honest |

**Logout ends the session, not the browser's memory of it.** `POST /auth/logout` revokes the row
named by the `sid` claim of the presenting token before clearing the cookies. In v4 it cleared the
cookies only, so whoever had copied the refresh cookie kept renewing after the user believed they
were out.

**`/auth/invalidate-tokens` is the level above**: it revokes every live session of the user and
then rotates `external_id`, in that order. The second act is the emergency one, and it also
invalidates every access token already signed, at the cost of changing a public identifier that
integrations may have stored.

### 2.4 Listing and closing sessions

Once a registry exists, "where am I logged in" is a question with an answer, and answering it in
the framework instead of in every consuming project is what T-11.14 is for.

`GET /auth/sessions` returns the caller's own live sessions, one object each: `sid`, `current`,
`createdAt`, `lastUsedAt`, `idleExpiresAt`, `absoluteExpiresAt`, `ip` and `userAgent`. `current`
is true for the session the request itself arrived on, so a console can label "this device"
without comparing anything it holds. No secret and no hash leaves the process: the only handle a
client is given is the `sid`, which is also what it sends back to close one.

`DELETE /auth/sessions/:id` closes one. Ownership is decided by looking the `sid` up among the
caller's own sessions and never by trusting the path, and a session belonging to somebody else
answers the **same 404** as one that does not exist. Distinguishing the two would turn the
identifier into an oracle for "is this a live session somewhere on this deployment". Closing the
session the call is made from is a logout, so the cookies are cleared with it.

Both routes need an authenticated caller and both answer `404 NOT_FOUND` wherever the deployment
keeps no registry (no data layer, `sessions.enabled: false`, or `JWT_REFRESH=false`), for the same
reason the renewal does: there is nothing to list and nothing to close.

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

### `/access-log` (tenant scope, new in v5)

The accesses of this tenant's users (F44): logins, flow steps, second factors, logouts, session
revocations, reuse of a spent refresh credential. Written by the framework, removed by retention,
never by a client. Rows carry the fields of the table and nothing else: no user agent, no address
tried for an unknown subject, never a password, a code or a token; the IP is truncated to /24 or
/48, or absent with `ACCESS_LOG_IP=none`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/access-log` | role `admin` | Magic Query over `id`, `occurredAt`, `scope`, `event`, `outcome`, `code`, `subjectId`, `methods`, `provider`, `flowId`, `sid`, `ip`; any other field is `QUERY_UNKNOWN_FIELD`. Only `scope: 'tenant'` rows, a condition the URL cannot relax. 404 `NOT_FOUND` in a build without the table |
| GET | `/access-log/count` | role `admin` | |

---

## 5. `/system/auth` and `/system/users` (control scope, new in v5)

Platform administrators authenticate on their own routes and receive a token carrying
`scp: 'control'` and no `tid`. There is **no public registration**: system users are provisioned.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/system/auth/login` | public | rate limited, same uniform messages as §2.1 |
| POST | `/system/auth/logout` | authenticated (control) | revokes the platform session, then clears the control cookies |
| POST | `/system/auth/refresh-token` | valid control refresh credential | literally the same code as `/auth/refresh-token` (§2.3), with the `control_refresh_token` cookie, the `ctl` routing segment and `scope: 'control'` on the row. A tenant session presented here is `SCOPE_MISMATCH` |
| POST | `/system/auth/mfa/setup` | any platform identity | starts the operator's own enrolment: every identity enrols itself, and `roles: []` here would have meant the superuser alone |
| POST | `/system/auth/mfa/enable` | any platform identity | finishes it with a code from the authenticator; both answer 409 `MFA_ALREADY_ENABLED` for an operator who already has a factor |
| POST | `/system/auth/mfa/verify` | authenticated (control) | |
| GET | `/system/auth/me` | any platform identity (`public` role gate plus `isAuthenticated`) | the operator behind the session with its roles, never the credential columns. A console reads it instead of `/users/me`, which refuses a control token (T-10.14) |
| GET | `/system/auth/sessions` | any platform identity | the operator's own platform sessions, the twin of §2.4 and with the same shape |
| DELETE | `/system/auth/sessions/:id` | any platform identity | closes one of them; a session of another operator answers 404, as on the tenant side |
| GET | `/system/manifest` | capability `manifest` (control catalogue) | the platform console's manifest, §7. Mounted with tenants and `options.manifest.enabled` |
| GET | `/system/users` | capability `system-users` | |
| POST | `/system/users` | capability `system-users` | |
| GET | `/system/users/:id` | capability `system-users` | |
| PUT | `/system/users/:id` | capability `system-users` | |
| DELETE | `/system/users/:id` | capability `system-users` | |
| POST | `/system/users/:id/block` | capability `system-users` | |
| POST | `/system/users/:id/unblock` | capability `system-users` | |
| POST | `/system/users/:id/mfa/reset` | capability `system-users` | |
| GET | `/system/access-log` | capability `access-log`, granted to `system:auditor` | Magic Query over the access log of the platform (`scope: 'control'` only, a condition the URL cannot relax) |
| GET | `/system/access-log/count` | capability `access-log` | |

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
| POST | `/tenants/impersonate/end` | `tenants:impersonate` | revokes the impersonation record. Body: `{ impersonationId }`. First written as "authenticated (control)", which on a control route resolves to the superuser alone: whoever can open a session must be able to end one, and that is the capability |
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

## 7. `/health` and the manifests

| Method | Path | Scope | Auth | Notes |
|---|---|---|---|---|
| GET | `/health` | control | public | never touches a tenant container |
| GET | `/admin/manifest` | tenant | capability `manifest` (tenant catalogue) | the manifest of a customer's console |
| GET | `/system/manifest` | control | capability `manifest` (control catalogue) | the manifest of the platform console; only with tenants |

**One console, one plane (T-10.14).** With tenants declared the two manifests describe disjoint
sets of routes: `/admin/manifest` the tenant routes, with `auth.plane: 'tenant'` and the `/auth/*`
endpoints; `/system/manifest` the control routes, with `auth.plane: 'control'` and the
`/system/auth/*` endpoints (`me` and the MFA steps included). A customer's users therefore never
receive the platform's route map and role codes. Without tenants there is one identity space:
`/admin/manifest` describes every route and `/system/manifest` is not mounted.

**`tenancy` (T-10.15).** `header` is named only on the tenant plane under the `header` resolver,
where a console must send it from the login on; `switchable` is always `false`, because the token
binds the tenant and a different one is a new login. `listEndpoint` is no longer emitted.

Within a plane the manifest is the same for every caller (`lib/api/admin/controller/manifest.ts`,
`lib/api/system/controller/systemManifest.ts`): the console hides what the caller's roles cannot
reach, and every route still enforces its own gate. Whoever holds `manifest` reads that plane's
route list and role codes, so grant it to the roles that operate the console. `MANIFEST_DUMP_PLANE`
chooses which of the two `MANIFEST_DUMP` writes; the platform one cannot be pulled in cookie mode,
where the header accepts integration tokens only and the control plane has none.

### 7.1 Action input (T-10.16)

A custom action, a route that is not CRUD, may carry `input`: the fields a console asks for before
calling it. From the platform manifest of a deployment with tenants:

```json
{
  "name": "impersonate", "kind": "action", "method": "POST", "path": "/tenants/:id/impersonate",
  "input": {
    "fields": [
      { "name": "userId", "type": "string", "required": true, "placeholder": "input.tenant.impersonate.userId" },
      { "name": "reason", "type": "string", "required": true, "widget": "textarea" }
    ]
  }
}
```

- **Derived from the body schema** of the route (`config.body`), because that is the one description
  of the body that cannot drift from what the route accepts. One field per property, its `type` mapped
  as for resource fields, `required` from the schema's `required`. An action without a body schema has
  no `input`, and CRUD capabilities never do.
- **The route hint adds what a schema cannot say.** `config.manifest.input`, per route and never at
  file level: `exclude` (properties the dialog does not ask for), `fields.<name>` with `widget`,
  `label`, `placeholder` and `required`, and `submitLabel`.
- **`required` for a controller's own refusal.** A field whose absence the controller refuses with a
  specific code (`REASON_REQUIRED`, `USER_REQUIRED`) is not `required` in the schema, where Fastify
  would answer first with `FST_ERR_VALIDATION`; the hint marks it, and the code stays the contract.
  Such a body schema is `nullable`, so a request without a body still reaches the controller.
- **No sensitive filter**, unlike resource fields: an input is typed by the operator and never read
  back, and the destruction `token` is exactly what that dialog has to ask for.
- The contract is `ActionInput` and `ActionInputField` in `manifest.v2.schema.json` of
  `@volcanicminds/admin`, which draws the dialog. Today two registry actions use it: `suspend` and
  `impersonate`.

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

**The renewal has its own codes**, listed in §2.3: `REFRESH_REQUIRED` for everything a stranger
could probe with, `SESSION_REUSE_DETECTED` when a spent credential comes back and the session is
closed because of it, and `404` where the deployment keeps no session registry at all.

**404 versus 403 across tenants.** Addressing a resource of another tenant answers **404**, never
403: 403 would confirm that the resource exists somewhere. The same rule applies to a tenant slug
that exists but is suspended, so that probing the registry from outside reveals nothing.
