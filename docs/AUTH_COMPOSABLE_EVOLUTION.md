# Composable Multi-Step Authentication Engine

> Status: **Design / Roadmap** — target **v4 (breaking)**.
> This document describes the evolution of the framework's authentication from a hardcoded
> `password → TOTP` flow into a **composable, configurable, multi-step engine** with
> **pluggable authentication methods** behind a stable internal contract.
>
> **Audience:** a developer who knows this framework but was **not** part of the design
> discussion. This document is meant to be self-sufficient: read it top to bottom and you
> should understand *what* we are building, *why*, and *how* to build it. Sections 1–3 give the
> baseline and vocabulary; 4–17 are the design; the checklists at the end are the executable
> roadmap.

## 1. Motivation

The current auth path hardcodes login + a single TOTP second factor. Adding a new factor
(email code, SMS, social) requires rewriting the controller. The engine turns each factor into
a **pluggable method** and each login path into a **declarative, per-role flow**, so new
methods and policies are added by configuration and a small interface implementation — not by
editing core.

Two composition axes we want to support:

- **OR (alternatives)** — satisfy a step with *one of* several methods (password *or* email code).
- **AND (sequence)** — satisfy several steps *in order* (password *then* second factor).

## 2. Current state (before v4) — the baseline this replaces

So you know the starting point, here is how authentication works **today**:

- **Login controller** — `lib/api/auth/controller/auth.ts` holds `login`, `mfaSetup`,
  `mfaEnable`, `mfaVerify`, `mfaDisable`, `refreshToken`, `forgotPassword`, `resetPassword`,
  `confirmEmail`, etc. The login → MFA logic is **hardcoded** here.
- **Password check** — `userManager.retrieveUserByPassword` (bcrypt, salt 12).
- **MFA (the one existing "second step")** — on login, if the user has MFA enabled (or policy
  is `MANDATORY`), `login` returns **`202` + a `tempToken`** (a JWT with claim
  `role: 'pre-auth-mfa'`, TTL 5 min) plus `{ mfaRequired, mfaSetupRequired }`
  (schema `authMfaChallengeSchema`). The TOTP is then verified at `POST /auth/mfa/verify`,
  which issues the final tokens.
- **Gatekeeper** — `lib/hooks/onRequest.ts` verifies the JWT on every request and enforces a
  hardcoded whitelist (`MFA_SETUP_WHITELIST`): a `pre-auth-mfa` token may only reach
  `/auth/mfa/setup|enable|verify` and `/auth/logout`; everything else → `403 MFA_REQUIRED`.
- **TOTP verification** — delegated to the injected `mfaManager.verify(token, secret)`, with
  replay protection via the `mfaLastUsedCounter` field (see `evaluateMfaResult` in the
  controller). The MFA secret is stored **encrypted** on the user (`saveMfaSecret`).
- **JWT** — access token `sub = user.externalId` (not the DB id, so rotating `externalId`
  revokes all tokens); a separate `refreshToken` JWT namespace; dual delivery via
  `AUTH_MODE` (`BEARER` header/body or `COOKIE` httpOnly).
- **Roles** — not carried in the JWT; reloaded from the DB in `onRequest`
  (`retrieveUserByExternalId`) and enforced against each route's `requiredRoles`.
- **Managers** — `userManager`, `mfaManager`, `tokenManager`, `tenantManager`, etc. are
  injected via `start(decorators)` (Null Object pattern: a no-op default runs if not injected).

**Key insight:** the `202 + tempToken + pre-auth-mfa` mechanism above is already a **one-step
version** of the state machine this document generalizes. We are not inventing a new paradigm;
we are turning a single hardcoded step into a configurable N-step engine.

## 3. Terminology (glossary)

| Term | Meaning |
| --- | --- |
| **Method / Authenticator** | A single way to prove something (password, email-otp, totp, sms-otp, social). The pluggable unit. |
| **`identifier`** | A method that establishes **who** the user is (password, email-otp, social). Must come first — you cannot verify a second factor before you know the subject. |
| **`verifier`** | A method that proves a fact about an **already-known** subject (totp, sms-otp). |
| **Flow** | An ordered list of **stages** for a role. The whole login path. |
| **Stage** | One position in a flow; contains an `anyOf` list of acceptable methods (OR) and an optional `when` condition. |
| **`anyOf`** | The methods that satisfy a stage; the user picks **one** (this is the OR). |
| **Subject** | The user/account resolved once identity is established. |
| **tempToken** | A short-lived, signed token that represents a **partial** (in-progress) authentication. Grants access to nothing except the flow endpoints. |
| **`flowId`** | A high-entropy handle for the in-flight flow. Stored on `User` as a revocable pointer and as the key of the `UserAuthFlow` record. |
| **Gatekeeper** | The `onRequest` hook logic that decides which routes a token may reach. A tempToken may only reach `/auth/flow/*`. |
| **Challenge** | A code dispatched to a channel (email/SMS) that the user must return. |
| **Sink** | The destination the audit log is written to (DB table, external SIEM, console, none). |
| **Self-heal** | The property that restarting a login (re-login) automatically abandons any stuck in-flight flow — no admin action needed. |

## 4. Concepts (and prior art)

| Concept | Prior art | Role here |
| --- | --- | --- |
| **Authenticator** | Passport.js Strategy | The pluggable unit implementing one method |
| **Flow** | Keycloak Authentication Flows | Ordered stages, per role |
| **Step response** | Ory Kratos "nodes" | Describes *which inputs* are needed, never presentation/i18n |
| **Flow config** | Auth.js providers | Declarative per-role definition |
| **State handle** | existing `externalId` pattern | Revocable pointer to the in-flight flow |

Passport gives us the single-method contract; it is **single-step** (you chain steps
yourself). Keycloak's Authentication Flows give us the **multi-step orchestration** Passport
lacks. This engine = Passport's Strategy contract + Keycloak's flow composition, built on the
tempToken mechanism the framework already has.

## 5. The Authenticator contract (internal, stable)

The precise contract that makes future methods addable without touching core. Lives in
`types/global.d.ts`; built-ins ship with the framework, custom ones are injected by the consumer.

```ts
type AuthenticatorKind = 'identifier' | 'verifier'
// identifier: establishes WHO the user is (password, email-otp, social)
// verifier:   proves a fact about an already-known subject (totp, sms-otp)

interface AuthResult {
  status: 'success' | 'challenge' | 'fail' | 'redirect' | 'error'
  subject?: AuthSubject            // set by an identifier on 'success'
  challenge?: ChallengeDescriptor  // e.g. "code sent via email" → drives the 202
  redirect?: string                // for OAuth / social
  reason?: string                  // error CODE, never an i18n message
}

interface Authenticator {
  readonly id: string              // 'password' | 'email-otp' | 'totp'
  readonly kind: AuthenticatorKind

  initiate?(ctx: AuthContext): Promise<ChallengeDescriptor | void>  // send code (email/SMS); no-op for password/totp
  verify(ctx: AuthContext, credentials: Record<string, unknown>): Promise<AuthResult>
  isApplicable?(ctx: AuthContext): Promise<boolean>                 // e.g. totp only if subject.mfaEnabled
}
```

Mapping to what already exists (so the contract feels familiar):

| Passport | Volcanic |
| --- | --- |
| Strategy | `Authenticator` |
| `passport.use(name, strat)` | registry injected via `start({ authenticators: [...] })` |
| verify callback `done()` | `Authenticator.verify → AuthResult` |
| `serialize/deserializeUser` | already present: `externalId` ↔ `retrieveUserByExternalId` |
| session | JWT (bearer/cookie) — no server session |
| `passport.authenticate` middleware | flow engine + `onRequest` gatekeeper |

**First-round methods**: `password` (exists), `totp` (exists, wraps `mfaManager`),
`email-otp` (new). `sms-otp` / social are design-ready via the same contract.

**`reason` codes** returned on `fail`/`error` are stable machine strings (never localized
text), e.g. `INVALID_CREDENTIALS`, `CODE_EXPIRED`, `CODE_INVALID`, `TOO_MANY_ATTEMPTS`,
`METHOD_NOT_ALLOWED`, `FLOW_EXPIRED`, `USER_BLOCKED`. The frontend maps codes to messages.

## 6. Method registry & injection

A registry consistent with the existing Manager DI (Null Object pattern). The framework ships
built-ins; the consumer appends/overrides by `id`:

```ts
start({
  authenticators: [ smsOtpAuthenticator, googleOAuthAuthenticator ] // appended/override by id
})
// password / totp / email-otp already registered by core
```

## 7. Flow configuration (`src/config/authFlow.ts`)

Per-role, declarative. **Reading order = precedence.** `*` is the mandatory catch-all and must
be the **last** key.

```ts
export default {
  admin: [
    { anyOf: ['password'] },                                  // stage 1 — identify
    { anyOf: ['totp'] }                                       // stage 2 — MFA always
  ],
  backoffice: [
    { anyOf: ['password'] },
    { anyOf: ['email-otp', 'sms-otp'], when: 'subject.mfaEnabled' } // conditional 2nd factor
  ],
  '*': [
    { anyOf: ['password'] }                                   // default: single factor
  ]
}
```

Semantics:

- **Array of stages** = AND (sequence). **`anyOf` within a stage** = OR (pick one).
- **`when`** = conditional stage, evaluated against the subject. It is a **restricted
  expression** over known subject fields (e.g. `subject.mfaEnabled`), resolved by a small safe
  evaluator — **never** `eval()` of arbitrary code. Unknown fields fail at boot (see below).
- **Role precedence** = declaration order; a user with several roles gets the **first**
  matching flow (list most-privileged first, so a lesser role never weakens login). Example:
  a user with `['backoffice','admin']` gets the `admin` flow because `admin` is declared first.

### Boot validation — fail-fast, no silent defaults

The `authFlow.ts` loader **aborts startup** (like the weak-JWT-secret and depcruise checks
already in the framework) if:

1. `*` is missing, or is not the **last** key.
2. Any referenced method `id` does not exist in the authenticator registry (typo protection).
3. Any flow's **first stage** contains a non-identifier (can't run a verifier before the
   subject is known).
4. Any stage has an empty `anyOf`.
5. (When used) a `when` condition references an unknown subject field.

Rationale: an auth misconfiguration must surface as a startup crash in CI, never as a user who
can't log in — or, worse, a user who logs in with fewer factors than intended.

## 8. Flow state & the temporary handle

State lives on a dedicated entity; a **single revocable pointer** sits on `User` (like
`externalId`). Single active flow per user → two devices proceed **in sequence** (a new login
overwrites the slot). Multi-device concurrency can be enabled later by dropping the pointer
and keying only by user.

```
User {
  externalId        // full-session subject (unchanged)
  flowId (nullable) // revocable pointer to the in-flight flow; clearing it kills the flow
}

UserAuthFlow {
  flowId (PK, high-entropy random)
  userId
  flow, stage, satisfied[]        // position in the state machine
  codeHash, codeExpiresAt         // current email/SMS code (hashed, never plaintext)
  attempts, resends               // brute-force + email-bomb caps
  expiresAt, createdAt            // absolute flow TTL
}
```

The **tempToken** carries `{ typ: 'auth-flow', flowId, tid, exp }`, signed with a **dedicated
JWT namespace/secret** (`JWT_FLOW_SECRET`, falls back to `JWT_SECRET`) so it is
cryptographically distinct from a real bearer. The `onRequest` gatekeeper generalizes the
current `pre-auth-mfa` whitelist: a `typ:'auth-flow'` token is accepted **only** on
`/auth/flow/*`, and each step re-validates `token.flowId === user.flowId === record.flowId`.

## 9. Endpoints (v4)

```
POST /auth/flow/start      { flow?, credentials? }
  → 202 { tempToken, stage, options[] }   (partial auth — never 200)
  → 200 { token, ... }                     (flow already complete, single factor)

POST /auth/flow/step       Bearer <tempToken>; { authenticator, credentials }
  → 202 (next stage) | 200 (final tokens) | 4xx (fail, with remaining attempts)

POST /auth/flow/challenge  Bearer <tempToken>; { authenticator }
  → 202 (dispatches / re-sends the email/SMS code)   [rate-limited]
```

The `options[]` in the 202 lists the allowed method **ids** for the current stage and whether
a challenge was dispatched — **structure only, no labels/i18n** (BE emits data, not
presentation). The FE renders and picks.

**Channel destination is server-derived**: for `email-otp` the code is sent to the subject's
on-file email resolved from `flowId → userId`, **never** to an address supplied in the request
body (injection guard). The FE may show it masked (`d***@…`) but does not dictate it.

## 10. Worked example — `password → email-otp`

A concrete end-to-end run, including the failure and restart branches, so the moving parts are
unambiguous.

```
① POST /auth/flow/start   { flow: 'backoffice', credentials: { email, password } }
   Server: verifies password (stage 1, an identifier).
           Stage 2 is [email-otp | sms-otp] when subject.mfaEnabled → applies.
           Creates UserAuthFlow{ flowId, stage:1, satisfied:['password'], expiresAt:+15m }.
           Sets user.flowId = flowId.
           Signs tempToken { typ:'auth-flow', flowId, tid, exp:+15m }.
   → 202  { tempToken, stage: 2, options: [ {id:'email-otp'}, {id:'sms-otp'} ] }

② POST /auth/flow/challenge   Bearer <tempToken>   { authenticator: 'email-otp' }
   Server: derives the destination from flowId → userId → user.email (NOT from the body).
           Generates a 6-digit code, stores sha256(code) in record.codeHash,
           codeExpiresAt:+5m, and emails the code.
   → 202  { challenge: { channel:'email', destination:'d***@…', expiresAt } }

③ POST /auth/flow/step   Bearer <tempToken>   { authenticator:'email-otp', credentials:{ code } }
   Server: constant-time compare sha256(code) vs record.codeHash; checks codeExpiresAt.
     • wrong code → record.attempts++; if attempts > AUTH_OTP_MAX_ATTEMPTS the code is burned.
                    → 4xx { reason:'CODE_INVALID', remaining }
     • correct    → atomic single-use consume; satisfied += ['email-otp']; stage complete.
                    → 200 { token, refreshToken, user }   (+ delete record, clear user.flowId)
```

**Branch — code expired / never arrived:** the user calls `/auth/flow/challenge` again (up to
`AUTH_OTP_MAX_RESENDS`, rate-limited) to get a fresh code; the absolute 15-min flow TTL is not
extended.

**Branch — user gives up and reloads the login page:** the FE simply calls `/auth/flow/start`
again. A new `flowId` overwrites `user.flowId`; the previous record is now orphaned and its old
tempToken is rejected by the gatekeeper (flowId mismatch). No admin action, no stuck state.

## 11. OTP security (the details that decide robustness)

1. Short codes stored **hashed** (never plaintext) + **constant-time** compare.
2. **Single-use, atomic** consumption (conditional UPDATE, not read-then-write) → no
   double-submit / replay.
3. **Attempts counter** with cap → anti-brute-force.
4. **Server-side expiry** actually enforced (does *not* copy the current reset-token debt).
5. **tempToken isolation** (dedicated secret + `typ` claim) + gatekeeper restricted to
   `/auth/flow/*`.
6. **Re-validate user status** (blocked/disabled) at **every** step, not only stage 1.
7. TOTP keeps its existing anti-replay counter (`mfaLastUsedCounter`).

## 12. Flow lifecycle & self-healing (no admin needed)

Guiding principle: **state protects the in-flight attempt; it never blocks restarting.
Restarting is always free and self-resets.**

- A new `POST /auth/flow/start` (re-login, page refresh, or back) generates a new `flowId`,
  **overwrites** the pointer on `User`, and the old flow becomes orphaned → its old tempToken
  is instantly rejected by the gatekeeper (flowId mismatch).
- Hitting any cap or the flow TTL **kills the flow silently**; the user simply logs in again.
- A background **sweep job** deletes expired/dead `UserAuthFlow` rows.
- **No admin reset is required by design**; the system unblocks itself on the next login.

| Parameter | Default | Env | Purpose |
| --- | --- | --- | --- |
| Flow TTL (absolute) | 15 min | `AUTH_FLOW_TTL` | past it → restart from login |
| Code TTL | 5 min | `AUTH_OTP_TTL` | single email/SMS code |
| Wrong attempts / code | 5 | `AUTH_OTP_MAX_ATTEMPTS` | anti-guessing |
| Resends / flow | 3 (rate-limited) | `AUTH_OTP_MAX_RESENDS` | anti email-bombing |

**Account lockout is a separate, auto-expiring concern** (persistent abuse across sessions),
deliberately *not* mixed into the flow — a wrong OTP must never lock the account, only end the
flow.

## 13. Audit / access log

A write-only, **unlinked** (no FK) forensic trail. Injected as an `auditManager`
(`AccessLogManagement`) consistent with the other managers, but **active by default**
(default sink = console) so there is an audit trail out of the box.

```ts
interface AccessLogManagement {
  record(event: AuthEvent): void   // synchronous enqueue, never throws
}
```

- **Queue + batch flusher**: `record()` pushes to a bounded in-memory buffer (instant, never
  throws); a single background flusher writes in batches and owns the only `.catch`. This
  removes per-call unhandled-rejection risk and back-pressures under a flood (enqueue instead
  of firing N concurrent inserts). A bounded queue with a `dropped` counter reports loss.
- **Configurable sink** (via `general` / `plugins` config): `table` (an `AccessLog`-style
  entity) · `external` fn (SIEM) · `console` · `none`.
- **Forensic & lossy by design** — security *decisions* (lockout counters) rely on the
  synchronous flow state, **never** on this log.
- **Never logs** passwords, codes, tokens, or secrets. Email/IP are personal data → retention
  policy + optional masking/hashing of the attempted identifier for unknown-user attempts.

## 14. Existing debt to remediate (in scope)

- `resetPasswordToken` and `confirmationToken` are stored **in plaintext** on `User`
  (`lib/database/typeorm/loader/userManager.ts`) and their expiry is **never validated**
  (`resetPasswordTokenAt` is written but unused) → hash them and enforce expiry. (The MFA
  secret is already correctly encrypted; recovery codes are never generated by the framework.)

## 15. Backward compatibility (v4)

Breaking: `/auth/login` + `/auth/mfa/*` are superseded by `/auth/flow/*`. Provide a migration
note and, where feasible, keep thin adapters so the default `*` flow reproduces today's
behavior (password, optional TOTP) to ease consumer migration (e.g. `dionisi-backend`).

## 16. Design decisions & rationale (why, not just what)

So a reader can evaluate the design rather than just follow it:

- **Stateful flow record, not a stateless self-contained token.** A signed JWT is immutable,
  so it cannot count attempts or guarantee single-use. Server-side state (`UserAuthFlow`)
  enables attempt caps, one-time consumption, and revocation. Chosen for OTP security.
- **Single-slot `flowId` on `User` (1:1), not concurrent (1:N).** One in-flight flow per user
  is a **security invariant** (bounded parallel attempts) and needs no new lookup surface;
  multi-device logins proceed in sequence. Kept intentionally simple; can evolve to 1:N by
  dropping the `User` pointer and keying `UserAuthFlow` by `userId`.
- **Hybrid storage.** The `flowId` pointer on `User` gives `externalId`-style instant
  revocation; the `UserAuthFlow` row holds the ephemeral, high-write detail (code, counters,
  stage) so the core `User` entity stays clean.
- **Role precedence by declaration order, not computed "strictness."** Flows form a partial
  order (two 2-stage flows aren't comparable), so auto-ranking is fragile and surprising. An
  explicit ordered list is deterministic and auditable.
- **Audit as a plain injected manager + queue, not an event bus.** A pub/sub abstraction is
  over-engineering here. `record()` is a synchronous enqueue; a single flusher owns batching
  and error handling.
- **No admin reset.** Self-healing via re-login makes a manual reset unnecessary; keeping it
  out removes an operational burden and an attack/error surface. (Trivial to add later: clear
  `flowId`.)
- **`202`, never `200`, for partial auth.** A `200` carrying a tempToken can be mistaken by a
  client or middleware for a completed login; a distinct status keeps partial and full auth
  unambiguous.

## 17. File map (where things will live)

| Path | New/Changed | Purpose |
| --- | --- | --- |
| `types/global.d.ts` | changed | `Authenticator`, `AuthResult`, `AuthContext`, `AuthSubject`, `AccessLogManagement`, `AuthEvent` |
| `lib/config/constants.ts` | changed | default TTLs, caps, audit event types |
| `lib/auth/registry.ts` | new | authenticator registry (`register`/`get`/`list`) |
| `lib/auth/authenticators/*.ts` | new | built-ins: `password`, `totp`, `email-otp` |
| `lib/auth/engine.ts` | new | flow state machine (resolve stage/options, advance, complete) |
| `lib/loader/authFlow.ts` | new | load + fail-fast validate `authFlow.ts` |
| `lib/config/authFlow.ts` | new | core default flow (`*` = password) |
| `lib/api/auth/routes.ts` | changed | register `/auth/flow/*` routes |
| `lib/api/auth/controller/auth.ts` | changed | thin handlers delegating to the engine |
| `lib/schemas/auth.ts` | changed | JSON schemas for the new endpoints |
| `lib/hooks/onRequest.ts` | changed | generalized gatekeeper (replaces `pre-auth-mfa` whitelist) |
| `lib/database/typeorm/entities/userAuthFlow.ts` | new | `UserAuthFlow` entity |
| `lib/database/typeorm/entities/user.ts` | changed | add `flowId` pointer |
| `lib/database/typeorm/entities/accessLog.ts` | new | audit `AccessLog` entity (table sink) |
| `lib/database/typeorm/loader/userManager.ts` | changed | flow persistence + debt fixes (hash reset/confirm tokens) |
| `lib/defaults/managers.ts` | changed | default `auditManager` (console sink) |
| `index.ts` | changed | inject `authenticators`, register `flowToken` JWT namespace, wire loaders |

## 18. Stakeholder summary (plain language)

- **Composable step engine** — combine checks in sequence or as alternatives; total
  flexibility on how users sign in.
- **Internal contract for methods** — add SMS/social later with no rewrite.
- **Per-role rules in a config file** — admins get stronger checks; app owners set rules
  without touching code; startup fails loudly on a bad config.
- **Temporary pass** during multi-step — grants access to nothing on its own.
- **Protected email codes** — hidden, expiring, single-use, locked after too many tries.
- **A half-finished login blocks no one** — just start over; it self-resets, no admin action.
- **Access/attempt log** — a background queue writes it in batches, so it never slows login;
  destination configurable (DB table / SIEM / console / none).
- **Debt cleanup** — reset/confirmation codes secured.
- **Major version** — apps on the framework must adapt their login integration.

---

## Implementation roadmap

> Exhaustive, non-final checklist. Phases are sequenced but individual items may be reordered.
> Mark each `[ ]` → `[x]` as it lands.

### F0 — Types & contracts

- [ ] Define `AuthenticatorKind = 'identifier' | 'verifier'` in `types/global.d.ts`
- [ ] Define `AuthResult` (union `success|challenge|fail|redirect|error`, `subject?`, `challenge?`, `redirect?`, `reason?`)
- [ ] Define `ChallengeDescriptor` (channel, masked destination, `expiresAt`, method id)
- [ ] Define `AuthSubject` (subject abstraction: id, externalId, email, roles, `mfaEnabled`, tenant)
- [ ] Define `AuthContext` (`req`, `tenant`, `subject?`, `flow`, manager access)
- [ ] Define `Authenticator` interface (`id`, `kind`, `initiate?`, `verify`, `isApplicable?`)
- [ ] Define `AuthenticatorRegistry` interface (`register`, `get`, `list`)
- [ ] Define `AccessLogManagement` interface (`record(event): void`) + `AuthEvent` type
- [ ] Add constants/enums in `lib/config/constants.ts` (default TTLs, caps, audit event types, `AuthFlowStatus`)
- [ ] Export new public types from `index.ts` (as already done for `MfaManagement`, etc.)

### F1 — Registry & built-in authenticators

- [ ] Implement the registry (`lib/auth/registry.ts`): `register` (append/override by `id`), `get`, `list`
- [ ] Extend `start(decorators)` in `index.ts` to accept `authenticators: Authenticator[]`
- [ ] Register core built-ins before consumer overrides
- [ ] Built-in `password` (`identifier`): uses `userManager.retrieveUserByPassword`; no `initiate`
- [ ] Built-in `totp` (`verifier`): `isApplicable = subject.mfaEnabled`; `verify` wraps `mfaManager.verify` + anti-replay `mfaLastUsedCounter` (reuse `evaluateMfaResult`)
- [ ] Built-in `email-otp` (`identifier`+`verifier`): `initiate` generates+sends code; `verify` validates code
- [ ] Null Object default for `auditManager` (console sink active)
- [ ] Update `lib/defaults/managers.ts` if a registry default is needed

### F2 — Flow config & loader (fail-fast)

- [ ] Define the `src/config/authFlow.ts` shape (role → stage[], `anyOf`, `when`)
- [ ] Implement `lib/loader/authFlow.ts` (autodiscovery of `src/config/authFlow.{ts,js}`)
- [ ] Provide a core default `authFlow` (flow `*` = password only) in `lib/config/`
- [ ] Boot-check: `*` present → else abort
- [ ] Boot-check: `*` is the **last** key → else abort
- [ ] Boot-check: every referenced `method` exists in the registry → else abort
- [ ] Boot-check: each flow's first stage contains **only** `identifier` methods → else abort
- [ ] Boot-check: no empty `anyOf` → else abort
- [ ] Boot-check: `when` conditions reference valid subject fields → else abort
- [ ] Role precedence resolution (declaration order, first match; `*` fallback)
- [ ] Expose `global.authFlows` (or similar) for introspection/manifest

### F3 — Flow state & tempToken

- [ ] Define abstract `UserAuthFlow` entity in `lib/database/typeorm/entities/` (`flowId` PK, `userId`, `flow`, `stage`, `satisfied[]`, `codeHash`, `codeExpiresAt`, `attempts`, `resends`, `expiresAt`, `createdAt`)
- [ ] Add `flowId` (nullable) to the `User` entity (revocable pointer) + `select:false`
- [ ] Extend `UserManagement` / `userManager` with flow methods (create/get/advance/clear, atomic code consumption)
- [ ] Register the dedicated JWT namespace `flowToken` in `index.ts` (secret `JWT_FLOW_SECRET`, fallback `JWT_SECRET`)
- [ ] Run `assertSecretStrength` on `JWT_FLOW_SECRET` in production
- [ ] Sign tempToken `{ typ:'auth-flow', flowId, tid, exp }`
- [ ] Generalize the gatekeeper in `lib/hooks/onRequest.ts`: a `typ:'auth-flow'` token is accepted **only** on `/auth/flow/*`
- [ ] Remove/adapt the `MFA_SETUP_WHITELIST` whitelist and `pre-auth-mfa` logic
- [ ] Triple-coherence check on every step: `token.flowId === user.flowId === record.flowId`
- [ ] Multi-tenant scoping of the `flowId` lookup (by `tid`)

### F4 — Endpoints & engine

- [ ] `POST /auth/flow/start`: verify stage-1 identity, create `UserAuthFlow`, set `user.flowId`, respond 202 (or 200 if single-stage flow completes)
- [ ] `POST /auth/flow/step`: validate method allowed at current stage, verify credentials, advance `satisfied`/`stage`, 202 or final 200
- [ ] `POST /auth/flow/challenge`: (re)send code via `initiate`, rate-limited
- [ ] Engine: resolve allowed `options[]` for the current stage (respecting `anyOf` + `isApplicable` + `when`)
- [ ] Engine: emit final tokens (access + refresh) on flow completion + delete record + clear `user.flowId`
- [ ] 202 response `options[]` = **ids/structure only**, no labels/i18n (BE-data-only principle)
- [ ] Channel destination **server-derived** (subject email via `flowId→userId`), never from body
- [ ] OTP code stored **hashed** + **constant-time** compare
- [ ] **Single-use atomic** consumption (conditional UPDATE, affected-rows check)
- [ ] `attempts` counter + cap → dead flow past threshold
- [ ] `resends` counter + cap + rate-limit (anti email-bombing)
- [ ] Enforce `codeExpiresAt` (code TTL) and `expiresAt` (absolute flow TTL)
- [ ] Re-validate user status (blocked/disabled) on **every** step
- [ ] Self-heal: a new `start` overwrites `flowId` → old flow orphaned → old tempToken rejected
- [ ] Background sweep job: `DELETE UserAuthFlow WHERE expiresAt < now()` (schedule via `schedules` loader)
- [ ] Parameter envs: `AUTH_FLOW_TTL`, `AUTH_OTP_TTL`, `AUTH_OTP_MAX_ATTEMPTS`, `AUTH_OTP_MAX_RESENDS`
- [ ] JSON schemas for the new endpoints' body/response in `lib/schemas/auth.ts`
- [ ] Register the routes in `lib/api/auth/routes.ts` with appropriate rate limits

### F5 — Audit log

- [ ] Define `AccessLog` entity (unlinked, no FK): `type`, `outcome`, `method`, `userId?` (value), `identifier?` (masked), `tid?`, `flowId?`, `ip`, `userAgent`, `reason?`, `createdAt`
- [ ] Implement the bounded in-memory queue + batch flusher (single `.catch`, `dropped` counter)
- [ ] `record(event)` synchronous, never throws (enqueue only)
- [ ] Sinks `table` (writes `AccessLog`), `external` (fn/SIEM), `console`, `none` — selected via config
- [ ] Sink config in `general`/`plugins` (default = console active)
- [ ] Emit events at decision points: `flow_start`, `step_success`, `step_fail`, `challenge_sent`, `flow_complete`, `flow_expired`, `mfa_fail`, `lockout`
- [ ] Hard filter: **never** passwords/codes/tokens/secrets in the event payload
- [ ] PII handling: mask/hash the identifier for unknown-user attempts; retention note
- [ ] Document that the audit trail is forensic/lossy and **not** a source of security decisions

### F6 — Existing debt remediation

- [ ] Hash `resetPasswordToken` at generation (`userManager.forgotPassword`) and look up by hash
- [ ] Hash `confirmationToken` at generation (`createUser`) and look up by hash
- [ ] Enforce expiry on `resetPasswordTokenAt` in `resetPassword` (fix the existing bug)
- [ ] Env for reset/confirm validity window (e.g. `RESET_TOKEN_TTL`)

### F7 — v4 compatibility & migration

- [ ] Decide: backward-compat adapters for `/auth/login` + `/auth/mfa/*` **or** clean deprecation
- [ ] Default `*` flow reproduces current behavior (password, optional TOTP) where possible
- [ ] Migration note for consumers (e.g. `dionisi-backend`): endpoints, response shape, envs
- [ ] Major version bump in `package.json` + changelog/release notes
- [ ] Verify impact on `AUTH_MODE=COOKIE` (tempToken via cookie vs header)

### F8 — Tests (in-memory, `NODE_ENV=memory`)

- [ ] Full multi-step flow `password → email-otp` (happy path)
- [ ] OR flow: choice between two methods at the same stage
- [ ] Conditional flow `when: subject.mfaEnabled` (triggers / does not trigger)
- [ ] OTP code expiry (past `AUTH_OTP_TTL`)
- [ ] Wrong-attempts cap → dead flow
- [ ] Resend cap + rate-limit
- [ ] Atomic single-use: double-submit of the same code → only one success
- [ ] Self-heal: re-login overwrites `flowId`, old tempToken rejected
- [ ] Gatekeeper: tempToken on a business route → 403; only `/auth/flow/*` allowed
- [ ] Boot fail-fast: malformed `authFlow.ts` (missing `*`, `*` not last, unknown method, verifier-first, empty `anyOf`) → server does not start
- [ ] Role precedence: multi-role user gets the top-most flow
- [ ] Audit: events emitted + no secret in payload
- [ ] Debt: reset/confirm tokens hashed + expiry enforced

## Documentation update tasks

- [ ] **`README.md`** — update the feature matrix + auth section (composable engine, methods, per-role flows, audit)
- [ ] **`llms.txt`** — add flow-engine patterns (`Authenticator` contract, `authFlow.ts`, `/auth/flow/*` endpoints, lifecycle); correct references to the old login/MFA flow
- [ ] **`CLAUDE.md`** — update "Sicurezza / nozioni non ovvie" (MFA gatekeeper → generalized v4 gatekeeper, flow tempToken)
- [ ] **`docs/SECURITY_MFA.md`** — link/subordinate to this doc (TOTP becomes one `Authenticator`); flag v4 changes
- [ ] **`docs/CONFIGURATION.md`** — new envs (`AUTH_FLOW_TTL`, `AUTH_OTP_TTL`, `AUTH_OTP_MAX_ATTEMPTS`, `AUTH_OTP_MAX_RESENDS`, `JWT_FLOW_SECRET`, `RESET_TOKEN_TTL`, audit sink) + `authFlow.ts` / audit config
- [ ] **`docs/ADVANCED_ARCHITECTURE.md`** — cross-link to the engine (registry via DI, service pattern)
- [ ] **Example `.env` / env docs** — add the new variables with default values
- [ ] **`OUTPUT.md`** — regenerate with `npm run combine` after the updates
- [ ] **Context7** — note to re-sync the `/volcanicminds/volcanic-backend` index after release

## Verification

- [ ] `npm run check-all` (lint + type-check + depcruise) green — core ↛ data-layer boundary respected (engine in core, entities in the data layer with type-only imports)
- [ ] `npm test` green — all F8 in-memory E2E tests
- [ ] Boot fail-fast manually verified with a malformed `authFlow.ts` → server does not start
- [ ] README / llms.txt / CLAUDE.md updated; `OUTPUT.md` regenerated

## Notes

- **No admin reset** in this iteration (explicit decision): self-healing via re-login makes it
  unnecessary; a future reset stays trivial (clear `flowId`).
- `docs/` and related files are **English-only** (repo convention).
