# Authorization (v5): scopes, roles, capabilities

> **Status: specification. Implement exactly this.**
> Target: `@volcanicminds/backend` v5. Tasks **T-4.1**, **T-4.2**, **T-4.3** of `EVO_FRAMEWORK.md`.
> This document **extends** `docs/AUTHORIZATION_MODEL.md` (roles, capabilities, the boot-time
> gate); it does not replace it. Everything that document says about the tenant scope stays
> true. What is new in v5 is the **control scope** and the fact that the two can never be
> confused.

## 1. The problem this solves

In v4 the difference between "the super admin of the platform" and "the admin of a tenant" is
**which schema resolved the `user` table** when the request was authenticated. Nothing else.
That is a runtime coincidence, and defect D-01 broke it: a poisoned connection could resolve the
`user` table inside a tenant's schema, and a tenant admin became a platform admin. This is not a
misconfiguration to document, it is a privilege-escalation path to remove by construction.

**v5 rule: identity, roles and routes all carry a scope, and the scopes never mix.**

---

## 2. The two scopes

| | `tenant` | `control` |
|---|---|---|
| Who lives here | `user` rows inside a tenant container | `system_user` rows in the control plane |
| What it administers | one customer's data | the platform: the tenant registry, provisioning, destruction |
| Role codes | `admin`, `public`, consumer-defined | `system:*` only |
| Token claims | `tid` present | `scp: 'control'`, **no** `tid` |
| Default for a route | **yes**, this is the default | declared explicitly |

A route declares its scope:

```ts
{ method: 'GET', path: '/', scope: 'control', roles: [roles.system.admin], handler: 'tenants.list' }
```

`scope: 'control'` replaces the v4 flag `tenantContext: false`. The v4 name described a
mechanism (do not open a tenant context); the v5 name describes the meaning (this route acts on
the platform). The default stays the safe one: **a route without `scope` runs in the tenant
scope**, exactly as `tenantContext` defaulted to `true`.

### 2.1 Boot-time validation, fail-closed

At router load the framework refuses to start (log.fatal + `process.exit(1)`) when:

1. a `control` route lists a role code that is not `system:*`;
2. a `tenant` route lists a `system:*` role code;
3. a `control` route declares a capability that is not in the control catalogue (§4);
4. `scope: 'control'` is used while no control plane is configured.

These are not warnings. A route that mixes scopes is a hole, and it must be impossible to ship.

### 2.2 Request-time gate

The gate is the same role intersection as v4, with one added check performed **first**:

- a token with `scp: 'control'` on a `tenant` route → **403**;
- a token carrying `tid` on a `control` route → **403**;
- then, and only then, the role intersection runs against the catalogue of that scope.

There is no path where a tenant token reaches control-scope data by being "admin enough".

---

## 3. Built-in system roles

Three, shipped by the framework, all protected (a consumer may relabel them, never redefine
their code or capabilities):

| Code | Meaning | Capabilities |
|---|---|---|
| `system:admin` | superuser of the control scope. Appended to every control route, exactly as `admin` is appended in the tenant scope | all, implicitly |
| `system:operator` | day-to-day operations: read the registry, create and suspend tenants, impersonate | `tenants`, `tenants:impersonate` |
| `system:auditor` | read-only oversight | `tenants:read`, `manifest` |

A consumer may define further control roles in its own configuration and grant them capabilities
from the control catalogue. It cannot invent a capability the framework does not honour on a
framework route, exactly as in the tenant scope.

---

## 4. Capability catalogue

The tenant catalogue is unchanged: `manifest`, `users`, `tokens` (see
`docs/AUTHORIZATION_MODEL.md` §3.2), plus whatever the consumer coins for its own routes.

The control catalogue is **new and reserved**:

| Capability | Grants | Framework routes |
|---|---|---|
| `tenants:read` | read the registry | `GET /tenants`, `GET /tenants/:id` |
| `tenants` | create, update, suspend, restore | `POST /tenants`, `PUT /tenants/:id`, `POST /tenants/:id/restore` |
| `tenants:impersonate` | open an impersonation session | `POST /tenants/:id/impersonate` |
| `tenants:export` | export a container | `POST /tenants/:id/export` |
| `tenants:destroy` | destroy a container's data | `POST /tenants/:id/destruction-request`, `DELETE /tenants/:id/data` |
| `migrations` | read schema versions, run the fleet migrator through the API | `GET /tenants/migrations` |
| `manifest` | read the admin manifest | `GET /admin/manifest` |
| `system-users` | manage platform identities | `/system/users/*` |

`tenants:destroy` is deliberately **not** part of `tenants`: creating a tenant and destroying its
data are not the same job, and an operator who can do the first must not automatically do the
second.

---

## 5. Tokens

| Claim | Tenant token | Control token |
|---|---|---|
| `sub` | `user.external_id` | `system_user.external_id` |
| `tid` | tenant id | **absent** |
| `scp` | absent (implicitly `tenant`) | `'control'` |
| `roles` | tenant role codes | `system:*` codes |
| `imp` | impersonation record id, when the session is an impersonation | absent |

**The tenant of a request comes from `tid`, never from a header, whenever a token is present**
(task T-3.2). The header or the subdomain resolves the tenant only for requests that have no
token: login and public routes. If a token carries `tid` and the header names another tenant,
the request is **refused**, not resolved to the more likely one.

---

## 6. Impersonation

Closes defect D-18. In v4 impersonation left only a claim in a token, lasted 24 hours, and its
`req.user?.tenantId === 'system'` branch was dead code comparing a field that does not exist.

**v5 flow:**

1. The caller presents a **control** token and holds `tenants:impersonate`.
2. The request body must carry a **reason**. An impersonation without a stated reason is refused
   with 400: the reason is what makes the audit record worth keeping.
3. The framework writes an `impersonation` row (§3.3 of `docs/SCHEMA_V5.md`) **before** issuing
   anything.
4. It then issues a **tenant-scoped** token for the target user, carrying `imp` = the record id,
   with a TTL of **30 minutes** by default (configurable, hard maximum 4 hours).
5. Every request made with that token is logged with the `imp` id. Tracked writes (`change`)
   record it too.
6. `POST /tenants/impersonate/end` revokes the record (`revoked_at`); a token whose `imp` record
   is revoked or expired is rejected even if the JWT itself is still valid.

---

## 7. Founder

`isFounderEmail` compared an email against a process environment variable, so in multi-tenant
the same address was "founder" inside **every** tenant (defect D-27).

In v5 the founder is the `is_founder` column of the `user` row, inside its own container. The
environment variable survives for exactly one purpose: seeding the **first system user** on an
empty control plane, at boot, when no `system_user` row exists. After that first write it is
never read again.

---

## 8. What a consumer must change coming from v4

| v4 | v5 |
|---|---|
| `tenantContext: false` on a route | `scope: 'control'` |
| platform admins were `user` rows in the `public` schema with role `admin` | `system_user` rows with `system:*` roles |
| a single `admin` role meaning both things | `admin` (tenant) and `system:admin` (control), never interchangeable |
| `ADMIN_EMAIL` deciding who is founder everywhere | `is_founder` per user row; `ADMIN_EMAIL` only seeds the first system user |
| impersonation with a 24 h token and no record | 30 min token, mandatory reason, persisted and revocable record |
