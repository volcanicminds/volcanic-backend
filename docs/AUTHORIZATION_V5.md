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
| `system:operator` | day-to-day operations: read the registry, create and suspend tenants, impersonate, open the platform console | `tenants`, `tenants:read`, `tenants:impersonate`, `manifest` |
| `system:auditor` | read-only oversight | `tenants:read`, `manifest`, `access-log` |

A consumer may define further control roles in its own configuration and grant them capabilities
from the control catalogue. It cannot invent a capability the framework does not honour on a
framework route, exactly as in the tenant scope.

---

## 4. Capability catalogue

The tenant catalogue is unchanged: `manifest`, `users`, `tokens` (see
`docs/AUTHORIZATION_MODEL.md` §3.2), plus whatever the consumer coins for its own routes.

`manifest` is the one name both catalogues reserve, each for its own plane (T-10.14): with the
tenant catalogue it gates `GET /admin/manifest`, the manifest of a customer's console; with the
control catalogue it gates `GET /system/manifest`, the platform console's. Every other control
capability is refused on a tenant route at boot (`SHARED_CAPABILITIES`, `lib/loader/roles.ts`).

The control catalogue is **new and reserved**:

| Capability | Grants | Framework routes |
|---|---|---|
| `tenants:read` | read the registry | `GET /tenants`, `GET /tenants/:id` |
| `tenants` | create, update, suspend, restore | `POST /tenants`, `PUT /tenants/:id`, `POST /tenants/:id/restore` |
| `tenants:impersonate` | open an impersonation session | `POST /tenants/:id/impersonate` |
| `tenants:export` | export a container | `POST /tenants/:id/export` |
| `tenants:destroy` | destroy a container's data | `POST /tenants/:id/destruction-request`, `DELETE /tenants/:id/data` |
| `migrations` | read schema versions, run the fleet migrator through the API | `GET /tenants/migrations` |
| `manifest` | read the platform console manifest | `GET /system/manifest` |
| `system-users` | manage platform identities | `/system/users/*` |
| `access-log` | read the operators' access log, never a tenant's | `GET /system/access-log`, `GET /system/access-log/count` |

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
| `sid` | the session this token was issued for (§9), when the deployment keeps a registry | the same |
| `imp` | impersonation record id, when the session is an impersonation | absent |

**The tenant of a request comes from `tid`, never from a header, whenever a token is present**
(task T-3.2). The header or the subdomain resolves the tenant only for requests that have no
token: login and public routes. If a token carries `tid` and the header names another tenant,
the request is **refused**, not resolved to the more likely one.

**No token carries a `role` claim, and one that does is refused** on every route with 401. v4 signed
a five-minute token carrying a `role` claim between the password and the second factor, and kept
it confined with a list of routes; the login is now a flow whose state lives in a table and whose
credential is not a JWT (docs/AUTH_FLOW_V5.md §5.4), so the framework signs no such token, and one
still alive across the upgrade would otherwise pass for a session.

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
| a refresh JWT that nothing consumed, and a logout that only cleared cookies | an opaque credential against a session registry, rotated at every renewal (§9) |

---

## 9. Sessions and renewal

A login writes a row in the `session` table of the subject's container (`docs/SCHEMA_V5.md` §2.5)
and hands back two credentials with different jobs. The **access token** is the JWT above: short,
stateless, verified without reading anything. The **refresh credential** is an opaque secret whose
only meaning is that row, and it is what turns "log me back in without a password" into an act the
server can observe, count and stop.

The v4 arrangement could do none of that. The refresh token was a second JWT, so renewing it
verified a signature and consumed nothing: the same string worked from the login to its expiry,
the theft of one was indistinguishable from its legitimate use, `logout` cleared the browser's
cookies while the copied credential kept renewing, and the only real revocation was rotating
`external_id`, a public identifier that integrations store.

### 9.1 The credential

```
vs1.<routing>.<sid>.<secret>
```

Four segments, of which exactly one is a credential. `vs1` is the version, so a later format can
be told apart instead of guessed. `routing` is the tenant id, or `ctl` for the control plane.
`sid` names the session. `secret` is 32 bytes from the CSPRNG in base64url, and the container
keeps only its SHA-256.

**Why it is not a JWT.** A signature is worth having when the receiver can decide alone. Here it
cannot: the renewal has to read the session row anyway, to learn whether that generation was
already spent. The signature would therefore buy nothing and cost a second secret to manage, a
second token namespace that verifies as the first whenever the two secrets coincide (which is why
a `typ: 'refresh'` claim had to exist at all), and a set of claims that go stale against the row
that actually decides. An opaque secret is worth nothing without the database, which is the
property that matters.

**Why the routing prefix, which names the tenant in clear.** In multi-tenant the session row lives
**inside** the tenant's container and there is no global index of sessions, so the container has
to be chosen before anything can be read, from something that arrives with the request. The tenant
id is not a secret (every access token carries it in `tid`) and the prefix is not proof: it says
where to look, it is checked against the tenant the request resolved to, and a mismatch is
`403 TENANT_MISMATCH`, the same refusal the access token meets.

A malformed credential is a refusal and never an exception. The parser answers null for anything
that is not four well-formed segments, because it runs on a string a stranger chose.

### 9.2 Rotation, and the window that keeps honest tabs alive

Every renewal mints a new secret, writes it as the current generation, keeps the spent one in
`previous_secret_hash`, increments `generation` and moves `last_used_at` and the idle clock. The
client therefore holds a different credential after every call, in **both** modes and on **both**
planes: a bearer client has no reason to carry a weaker session than a browser.

Rotation does not prevent theft. What it buys is that a stolen copy stops working the moment the
owner renews, and that the theft becomes visible instead of silent.

Two tabs of the same browser renew in the same instant, though, and they present the same secret.
So the generation just replaced stays acceptable for `graceSeconds` (10 by default) measured from
`rotated_at`, and a renewal inside that window is answered with a fresh access token while the
credential is left alone: the caller's copy is the previous generation, which the window still
accepts, and minting a second live secret is what would be wrong. The comparison is strict, so
`graceSeconds: 0` really means no tolerance.

### 9.3 Reuse detection

A secret that belongs to the previous generation and arrives **outside** the window is a
credential that should no longer exist anywhere. The server cannot tell which of the two holders
is the thief, so it does not try: the whole session is revoked with the reason written in the row,
a warning is logged, and the answer is `401 SESSION_REUSE_DETECTED`. The legitimate user logs in
again; the thief gets nothing.

Everything else the renewal refuses (an unknown secret, an expired session, a revoked one) answers
the same `401 REFRESH_REQUIRED`. They are one actionable fact, "log in again", and telling them
apart tells whoever holds a stolen credential which of the three it is.

### 9.4 Two clocks

Each row carries inactivity and an absolute lifetime, and a renewal moves only the first, never
past the second. One clock alone is the wrong answer in either direction: a deadline that always
moves forward is a session that never ends, and a fixed one throws out someone in the middle of
their work. The values come from the `sessions` block (`docs/CONFIGURATION_V5.md` §4), 30 and 180
days by default.

The access token stays stateless, and the row is read and written **only** at renewal. Touching
`last_used_at` on every request would make one row of every active session the hottest and most
contended row in the container. The price is that a revocation takes effect for the access token
only when it expires, which is acceptable precisely because that lifetime is short (`1h` by
default).

### 9.5 Revocation, at three levels

| Level | How | What it ends | When it is the right one |
|---|---|---|---|
| one session | `POST /auth/logout`, or `DELETE /auth/sessions/:id` with a `sid` read from `GET /auth/sessions` | that one session, by `sid` | the everyday case: this device now, or a device left logged in somewhere else |
| every session of a subject | `POST /auth/invalidate-tokens` | every live row of that `external_id`, each with a reason | "log me out everywhere", a password change, a support call |
| the identity itself | the same route, immediately after | rotates `external_id`, so every access token already signed for it stops resolving | a compromised account |

The first level is a surface of its own, on both planes (`docs/API_V5.md` §2.4): a caller lists
its own sessions and closes one by `sid`. Two rules make that safe to expose. A `sid` is a handle
and not an authorisation, so ownership is checked by looking it up among the caller's own rows,
and a session belonging to somebody else answers the same 404 as one that never existed, which is
what keeps the identifier from becoming an oracle. And the rows handed out carry no secret and no
hash: `sid`, the two clocks, `ip` and `userAgent` are what a device list needs, and nothing there
can renew anything.

The order of the last two is not cosmetic. The sessions are closed **first**, by name, so the
registry records when each one ended and why; rotating the identity first would leave the rows
keyed to an `external_id` nobody carries any more, live until their own expiry and pointing at
nothing. The hammer stays available because a compromised account really needs it, but it stops
being the only tool and stops being the routine: `external_id` is a public identifier, serialised
in responses and stored by integrations, and using it as a session seal breaks references that
have nothing to do with the session.

### 9.6 Without a registry there is no renewal

The registry is on wherever a data layer is injected. Where there is none, the renewal routes
answer `404` instead of pretending: a refresh credential nobody can consume is a credential that
never expires, and shipping that under the name of a session would be the worse of the two
failures. `JWT_REFRESH=false` keeps its old meaning and turns renewal off deliberately, for a
deployment that wants the session to end with the access token. The listing and the closing of
sessions answer `404` under the same three conditions, because without a registry there is
nothing to list and nothing to close.

### 9.7 What removes a dead row

Expiry is a comparison, not a deletion: a session past either clock is refused from that moment
on, whatever is still written in the container. Removing the rows is separate housekeeping, and it
happens in two places. The renewal purges opportunistically, on roughly one call in fifty, so a
deployment that never runs anything by hand does not grow the table for ever; the work is awaited
rather than fired and forgotten, because the container is released when the response ends and a
query outliving it would run on a handle somebody else already holds. A failure there is logged
and never charged to the renewal, which has a user waiting. An operator can also ask for it:
`npx volcanic sessions --purge`, and `--tenants` to pass over every active container as well as
the control plane. The command does nothing unless `--purge` is spelled out, because deleting rows
is the only thing it does.

What is removed is what no renewal could use any more, which means a clock has run out. **Revoking
a session does not delete it**: the row keeps its moment and its reason and goes only when it
expires on its own, so "when did this session end, and why" outlives the ending itself rather than
disappearing with it.

---

## 10. Second factor and single sign-on

How a subject proves who it is is the business of the login flow (docs/AUTH_FLOW_V5.md); four of
its rules are authorization rules and are stated here.

**The MFA policy is a floor the configuration cannot lower.** Under `MANDATORY` the flow engine
demands a second factor of every login on that plane, whatever `authFlows.ts` says, and enrols a
subject that has none inside the login (docs/AUTH_FLOW_V5.md §8.2). The policy of each plane and
tenant is the one of docs/SECURITY_MFA.md. The methods a login satisfied are written on the session
row (`auth_methods`), so "this session was opened without a second factor" stays a fact that can be
read later.

**A provider's second factor counts only where the deployment trusts it.** An OIDC login satisfies
the pseudo-method `idp-mfa` only when its provider is declared with `mfa: { trust: 'amr' | 'acr',
values }` and the ID token carries one of the values. By default it does not count: `amr` and `acr`
are a third party's claims, and a misconfigured provider must not lower the floor.

**A provider login never mints an administrator.** Just-in-time provisioning exists on the tenant
plane only, its roles can never include `admin` (checked when the provider is written and again at
the login), and it obeys the tenant's account creation mode (docs/API_V5.md §2.5). On the control
plane there is none: platform identities are provisioned. Linking by address is opt-in per provider
and limited to its `emailDomains` (docs/AUTH_FLOW_V5.md §7).

**A tenant's identity providers belong to the platform.** They are rows of the control plane,
written with the `tenants` capability (reading them too: they describe the customer's IdP, which a
read-only oversight role does not need), with the client secret encrypted and never returned. A
tenant's administrator cannot add a provider to its own tenant: an SSO configuration that lets
people in is a decision of whoever runs the platform.

