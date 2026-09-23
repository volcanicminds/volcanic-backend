# Security: multi-factor authentication (v5)

`@volcanicminds/backend` ships a native second factor, TOTP, on both planes, and a code sent by email
(`email-otp`) that can serve as a second factor too. Both are methods of the login flow: how a
login asks for them, and how a consumer adds its own, is in docs/AUTH_FLOW_V5.md. This document is
about the **policy** that decides when a second factor is owed, and about the recovery paths.

## The policy

Four values, from the most permissive:

| Value | Enrolling a factor | Removing one's own factor | A login |
|---|---|---|---|
| `OFF` | refused, in the login and outside it | refused: an administrator resets it | whoever already has a factor is still asked for it |
| `OPTIONAL` (default) | allowed | allowed | asks for the factor of whoever has one |
| `ONE_WAY` | allowed | refused: an administrator resets it | as `OPTIONAL` |
| `MANDATORY` | allowed, and imposed | refused | **every** login needs a second factor; a subject with none enrols inside the login |

Three levels, and the first is a floor the others may only tighten (docs/CONFIGURATION_V5.md §4):

- `MFA_POLICY` (or `mfa_policy` in `config/general.ts`) for the deployment, which is the tenant
  plane's policy unless a tenant tightens it;
- `SYSTEM_MFA_POLICY` for the control plane, the platform's own operators; it defaults to
  `MFA_POLICY`;
- `config.mfa_policy` on a tenant's registry row, written by a platform operator with `PUT
  /tenants/:id`. A value weaker than the floor is refused with `MFA_POLICY_WEAKER`, an unknown one
  with `MFA_POLICY_INVALID`.

The effective policy of the caller travels back in `securityPolicy.mfaPolicy` of `/users/me`,
`/system/auth/me` and the body of a completed login, which is where a console decides what to offer.

**`MANDATORY` is applied by the flow engine, not by the flow configuration.** A project's
`config/authFlows.ts` cannot write a login without a second factor on a plane whose policy demands
one: the engine adds the stage, offering the factors the subject has enrolled or, with none, an
enrolment in TOTP (docs/AUTH_FLOW_V5.md §8.2). An OIDC login counts as having a second factor only
when its provider is declared trusted for it (`idp-mfa`).

**A policy nothing can honour refuses the boot.** `MANDATORY` with no `mfaManager` injected stops
the start, and so does `MANDATORY` on a plane where the `totp` method is not registered, because
the first login would lock everybody out. A tenant that asks for `MANDATORY` in such a build is
refused with `MFA_NOT_AVAILABLE`.

## The login

There is no second login step outside the flow and no temporary token. A login that owes a second
factor answers **202** with the stage it waits on, and the client answers it on the same flow:

```text
POST /auth/flow/start  { method: 'password', email, password }  -> 202, stage: [{ id: 'totp', kind: 'verifier' }]
POST /auth/flow/step   { method: 'totp', code: '123456' }        -> 200, the session
```

The flow credential travels in the `auth_flow` cookie (cookie mode) or in the `flow` field of the
body (bearer mode), never in `Authorization`. Five wrong codes end the flow with
`FLOW_ATTEMPTS_EXHAUSTED`; the account is never locked by them. A replayed TOTP code answers as a
wrong one.

**Forced enrolment.** Under `MANDATORY`, a subject with no factor is offered
`{ id: 'totp', kind: 'verifier', enrol: true }`. `step { method: 'totp', action: 'enrol' }` answers
202 with `{ secret, uri, qrCode }`; the first right code enrols the factor and completes the login.
The secret is generated on the server and kept encrypted in the flow row until then: the client
never sends one. An enrolment inside a login is offered only to a subject with no factor at all, so
a stolen password can never replace a victim's factor.

## Managing one's own factor

With a complete session, and never during a login:

| Tenant plane | Control plane | |
|---|---|---|
| `POST /auth/mfa/setup` | `POST /system/auth/mfa/setup` | generates a secret and a QR code; 409 `MFA_ALREADY_ENABLED` when a factor is active |
| `POST /auth/mfa/enable` | `POST /system/auth/mfa/enable` | `{ secret, token }`: confirms with a code. Issues no session |
| `POST /auth/mfa/disable` | | only under `OPTIONAL` |

Replacing a factor goes through disable, or through a reset by an administrator.

## Recovery

**An administrator resets a user's factor**: `POST /users/:id/mfa/reset` with the `users`
capability on the tenant plane, `POST /system/users/:id/mfa/reset` with `system-users` on the
control plane. Grant that capability to whoever answers the support call.

**Emergency reset at boot.** For a deployment whose only administrator lost the device:

```bash
MFA_ADMIN_FORCED_RESET_EMAIL=admin@example.com
MFA_ADMIN_FORCED_RESET_UNTIL=2026-09-24T15:00:00.000Z
```

On start, if `UNTIL` is in the future and no more than ten minutes away, the framework disables the
factor of the identity with that address, looked up where the genesis puts the administrator: with
a `tenants` block, the **platform identity** (`system_user`) of the control plane; without, the
**user** of the control container. Further away than ten minutes, the boot stops; in the past, or
not a date, the variables are ignored. Remove both variables immediately after the recovery. A
tenant's own administrator is not reset this way: another administrator of that tenant resets it
with `POST /users/:id/mfa/reset`.
