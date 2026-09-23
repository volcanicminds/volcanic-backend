# Authentication flows (v5)

> **Status: specification of what the code does.** Target: `@volcanicminds/backend` v5, phase 12
> (`EVO_FASE_12.md`, decisions F33 to F49). Replaces `docs/AUTH_COMPOSABLE_EVOLUTION.md`, the v4
> design this engine grew out of, which is removed: where the two differed, this one is the code.
> If this document and the code disagree, the code wins and this document has a defect.

A login in v5 is a **flow**: one identify stage that says who the subject is, then the ordered
stages the configuration asks of that subject, then a session. The same engine runs on both planes
(the users of a tenant, and the platform's own identities), and every method, the built-in ones
and a consumer's, goes through the same contract. There is no other login route: the v4 login and
MFA verification routes and their `/system` twins are gone, and so is the five-minute temporary
token that connected them (docs/MIGRATION_V4_V5.md §29).

Related documents: docs/API_V5.md (§2 and §5, the route tables), docs/MANAGERS_V5.md (§13 to §17,
the five ports), docs/SCHEMA_V5.md (§2.7 to §2.9 and §3.5, the tables),
docs/CONFIGURATION_V5.md (the `accessLog` block and the variables), docs/SECURITY_MFA.md (the
second factor and its policy).

---

## 1. The model

| Term | Meaning |
|---|---|
| plane | `tenant` or `control`. Each has its own configuration block, its own routes, cookies and users |
| authenticator | one method, identified by `id` (`password`, `totp`, `email-otp`, `oidc`, or a consumer's) |
| identifier | an authenticator that establishes **who** the subject is. The first stage is always one |
| verifier | an authenticator that proves something more about a subject already known |
| flow | the stages owed after identification, chosen by the subject's roles |
| stage | `{ anyOf: [...], optional?: true }`: `anyOf` is the OR, the list of stages is the AND |
| flow row | the state of a login in progress, in the `auth_flow` table of the subject's container |
| flow credential | the opaque string that names a flow row between two requests |

A method can play both roles: `email-otp` identifies a subject from an address alone, or verifies
one that a password has already identified.

**The flow is chosen after identification, never before.** Until the first stage passes, the
engine does not know who is logging in, so it cannot know their roles; choosing a flow earlier
would mean revealing what roles an address has. After identification the engine takes the
**first** flow whose `roles` meet the subject's, and `'*'` meets everyone. A flow may restrict the
identifiers it accepts (`identifiers`): an `admin` who identified with a method that flow does not
list is refused with `FLOW_METHOD_NOT_ALLOWED`.

**An optional stage applies to a subject enrolled in one of its methods.** That is how "ask for
the TOTP code of whoever has one" is written, without an expression language: each verifier
answers `isEnrolled(subject)`, and a stage marked `optional` is skipped for a subject enrolled in
none of its methods.

**The stages are recomputed at every step** from the configuration and the policy of now, and the
subject is loaded again after every factor. A subject blocked between two factors meets the refusal
at the next one, and a configuration changed under a live flow ends that flow rather than finishing
it against rules nobody chose.

---

## 2. Configuration

### 2.1 `src/config/authFlows.ts`

Discovered like `roles.ts`: the framework's defaults in `lib/config/authFlows.ts`, the project's
under `src/config/authFlows.{ts,js}`. Typed with `AuthFlowsConfig`, exported by the package.

```ts
import type { AuthFlowsConfig } from '@volcanicminds/backend'

const authFlows: AuthFlowsConfig = {
  tenant: {
    identify: ['password', 'email-otp', 'oidc'],
    flows: [
      { roles: ['admin'], identifiers: ['password', 'oidc'], stages: [{ anyOf: ['totp', 'idp-mfa'] }] },
      { roles: ['*'], stages: [{ anyOf: ['totp', 'email-otp'], optional: true }] }
    ],
    returnUrl: 'https://app.example.com/login/return',
    providers: {
      google: {
        type: 'oidc',
        issuer: 'https://accounts.google.com',
        clientId: '1234.apps.googleusercontent.com',
        clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
        redirectUri: 'https://api.example.com/auth/flow/return/oidc'
      }
    }
  },
  control: {
    identify: ['password'],
    flows: [{ roles: ['*'], stages: [{ anyOf: ['totp'], optional: true }] }]
  },
  limits: { flowTtl: 600, otpTtl: 300, otpMaxAttempts: 5, otpMaxSends: 3 }
}

export default authFlows
```

**A project's plane block replaces the framework's whole; it is never merged.** The general
configuration is merged deeply (docs/CONFIGURATION_V5.md §3), and a stage list merged with the
framework's is the quietest way to end up with a login one factor short. A file that declares only
`tenant` keeps the framework's `control` block, and the reverse. The `limits` are scalars and are
taken key by key.

**The framework's defaults are the login of v4 on both planes**: `identify: ['password']` and a
single `'*'` flow with an optional `totp` stage.

| Key | Meaning |
|---|---|
| `identify` | the identifiers the plane offers. At least one |
| `flows` | ordered list of `{ roles, identifiers?, stages }`. The last one must be `roles: ['*']`, and no other may be |
| `flows[].roles` | role codes of the plane's catalogue (`config/roles.ts`, `config/systemRoles.ts`), or `'*'` |
| `flows[].identifiers` | the identifiers this flow accepts, a subset of `identify`. Absent: all of them |
| `flows[].stages` | verifiers only. `idp-mfa` is allowed where `identify` lists `oidc` (§6.3) |
| `returnUrl` | where the return from an external provider sends the browser (§5.5). Without it the return answers 200 `{ ok }` and the console must be reached some other way |
| `providers` | identity providers declared by the deployment (§6.1) |

### 2.2 Limits

| Limit | Default | Variable, which wins over the file | Meaning |
|---|---|---|---|
| `flowTtl` | 600 s | `AUTH_FLOW_TTL` | absolute lifetime of a flow. Never extended |
| `otpTtl` | 300 s | `AUTH_OTP_TTL` | lifetime of one sent code |
| `otpMaxAttempts` | 5 | `AUTH_OTP_MAX_ATTEMPTS` | wrong codes (TOTP or sent) before the flow dies. The account is never locked by it |
| `otpMaxSends` | 3 | `AUTH_OTP_MAX_SENDS` | codes sent within one flow |

Two further ceilings are fixed in code: **5 sends per subject in 15 minutes and 20 in 24 hours,
across every flow**, so that starting again does not reset the count; and the code length, 6 digits
when `email-otp` verifies a known subject and 8 when the address alone asked for it. The reasoning
behind the second, an estimate and not a measurement: as an identifier an attacker needs only the
address, so they get at most 20 sends a day with 5 attempts each, 100 guesses a day; over 10⁶
six-digit codes that is about 3.6% in a year, over 10⁸ eight-digit codes about 0.04%.

### 2.3 Custom authenticators

Authenticators are not configuration: they are code that needs managers, so they arrive through
`start()`, next to the managers, and a test can inject one without writing a file.

```ts
await startServer({ ...layer, mfaManager, challengeDeliveryManager, authenticators: [myMethod] })
```

The registry is built at boot: the four built-ins first, then the injected ones. An `id` registered
twice is **replaced** on the planes the second declares, with a warning in the log, because
replacing a built-in changes how people log in. A registered method is not an offered one: a plane
offers what its block lists.

### 2.4 Refusal at boot

Everything that would otherwise be found at the first login is found at boot, one message per
cause, and the boot stops (`lib/auth/validate.ts`):

- a plane block without `identify` or `flows`, an empty `identify`, a stage with an empty `anyOf`;
- a method not registered on that plane, a verifier in `identify`, an identifier in a stage;
- a last flow that is not `'*'`, or a `'*'` flow before the last;
- a role that is not in the plane's catalogue, an `identifiers` entry that `identify` does not list;
- `idp-mfa` on a plane whose `identify` does not list `oidc`;
- a provider missing `type: 'oidc'`, `issuer`, `clientId`, `redirectUri` or `clientSecretEnv`, a
  malformed one (§6.1), or one whose `clientSecretEnv` names an empty variable;
- `email-otp` listed and no `challengeDeliveryManager` injected;
- `totp` in a stage that is not optional and no `mfaManager` injected;
- a policy of `MANDATORY` on a plane where `totp` is not registered, or with no `mfaManager`;
- a method with `initiate`, a stage that is not optional, or a `MANDATORY` policy, with no flow
  store (§10);
- `oidc` listed and `openid-client` not importable (it is an optional peer: `npm i openid-client@^6`);
- a limit that is not a positive integer.

---

## 3. The authenticator contract

The types are exported by the package (`types/global.d.ts`). The engine is the only caller of an
authenticator, and the only writer of the flow row: an authenticator reads what it is told and
answers.

```ts
interface Authenticator {
  readonly id: string
  readonly kind: 'identifier' | 'verifier' | readonly ('identifier' | 'verifier')[]
  readonly planes: readonly ('tenant' | 'control')[]
  initiate?(ctx: AuthContext, input: AuthInput): Promise<AuthResult>
  verify(ctx: AuthContext, input: AuthInput): Promise<AuthResult>
  complete?(ctx: AuthContext, input: AuthReturnInput): Promise<AuthResult>
  readonly stateParam?: string                     // default 'state'
  isEnrolled?(ctx: AuthContext, subject: AuthSubject): boolean | Promise<boolean>
  enrol?(ctx: AuthContext, subject: AuthSubject): Promise<EnrolmentSetup>
}
```

- **`verify`** checks what the client sent. A method with neither `initiate` nor `complete` closes
  in the request that calls it (`password`, `totp`).
- **`initiate`** starts what cannot finish in one request: it sends a code, or answers with the
  address of an external provider. It runs on `start` for an identifier and on `challenge` for a
  verifier.
- **`complete`** receives the return from an external provider, which arrives without the flow
  credential and is bound to the flow by `state` (§5.5). It never issues a session.
- **`isEnrolled`** decides whether an optional stage applies. Absent, the method counts as enrolled.
- **`enrol`** starts an in-flow enrolment; the secret it answers is kept in the flow row, encrypted,
  and shown only in that one response.

`AuthContext` carries everything, and nothing is implicit: `plane`, `handle` (the data handle of
the request, as for managers), `tenant` (the registry row, null on the control plane and in single
tenant), `subject` (null before identification), `policy` (the effective MFA policy), `managers`,
`flow`, `limits`, and four bound operations: `challenges` (`record`, `consume`, `nominate` a
sent code, without ever seeing the flow secret that keys it), `roundTrip` (`begin`, which stores
what a return will need and answers the `state` to send), `provider(key)` and `accountCreation()`.
`record(entry)` writes to the access log on the flow's behalf.

`AuthResult` is one of:

| Outcome | Meaning |
|---|---|
| `success` | with `subject` for an identifier; `satisfied` names further methods proven (`idp-mfa`); `external` is what a `complete` validated |
| `challenge` | a code was sent: the descriptor (`channel`, masked `destination`, `expiresAt`, `resendAt`) |
| `redirect` | the browser must go elsewhere: `binding: 'redirect'` with a `url`, or `binding: 'post'` with a `url` and form `fields` (the shape SAML will need) |
| `pending` | an external round trip has not come back yet |
| `fail` | a `reason` in upper case. `recoverable` keeps the flow alive; `remaining` and `retryAt` travel to the client |

**Rules for writing one.** A refusal is a code, never a sentence: the console translates, the
backend does not. A failure before the subject is proven ends the flow unless it is `recoverable`.
The subject an identifier returns is loaded again by the engine and judged by the same rule as
every other login (§8), so a consumer's method cannot let in a blocked account by forgetting to
ask. A method whose code the store does not check (a TOTP-like one) has an attempt reserved by the
engine before `verify` runs, so parallel guesses meet the ceiling instead of racing past it.

---

## 4. The built-in methods

| `id` | Kind | Planes | Input | Notes |
|---|---|---|---|---|
| `password` | identifier | both | `email`, `password` | every failure before a verified password is `AUTH_INVALID_CREDENTIALS` (docs/API_V5.md §2.1); `PASSWORD_TO_BE_CHANGED` after it |
| `totp` | verifier | both | `code` | a replayed code answers as a wrong one. Enrolled when the subject has `mfaEnabled` |
| `email-otp` | both | both | identifier: `email` on `start`, `code` on `step`; verifier: `code` | needs `challengeDeliveryManager`. Enrolled when the address is confirmed |
| `oidc` | identifier | both | `provider` (a key), optional `returnTo` (a path) on `start`; nothing on `step` | needs `openid-client`. PKCE `S256` and `nonce` always |

**`email-otp` as an identifier does not reveal whether an address has an account.** An unknown
address gets the same 202, the same descriptor and the same write to the flow row, with a code
nobody receives. The delivery is scheduled after the response is decided and never awaited, because
the latency of a mail server is a stopwatch. The flow is bound to the subject its first send named:
a later send for another address costs the same and delivers nothing. The destination is always
the address on file, never one taken from the body.

**`email-otp` as a verifier** sends only to a confirmed address: an address nobody proved is not a
channel a second factor may travel on.

---

## 5. The life cycle of a flow

### 5.1 Routes

| Tenant plane | Control plane | Rate limit per IP | What it does |
|---|---|---|---|
| `GET /auth/flow/options` | `GET /system/auth/flow/options` | 60/min | the identifiers of the plane, without writing anything |
| `POST /auth/flow/start` | `POST /system/auth/flow/start` | `AUTH_RATELIMIT_MAX` per `AUTH_RATELIMIT_WINDOW` (10/min) | runs the identifier named by `method` |
| `POST /auth/flow/step` | `POST /system/auth/flow/step` | 10/min | answers the current stage, or starts an enrolment with `action: 'enrol'` |
| `POST /auth/flow/challenge` | `POST /system/auth/flow/challenge` | 5/min | sends a code again, within the ceilings |
| `POST /auth/flow/cancel` | `POST /system/auth/flow/cancel` | none | ends the flow of the credential, if any. Always `{ ok: true }` |
| `GET /auth/flow/return/:method` | `GET /system/auth/flow/return/:method` | 20/min | the browser's return from a provider |

The per-IP limits sit on top of the per-flow and per-subject ceilings of §2.2, which are the real
gates. The control-plane routes exist only where `/system/*` is mounted, that is with a `tenants`
block. On the tenant plane the tenant is resolved as on any unauthenticated route: header or
subdomain (docs/API_V5.md §2.2); the return is the exception (§5.5).

A body carries `method` and, in bearer mode, `flow`; every other field goes to the method. The
query string is never read as input.

### 5.2 Answers

**200: the session.** The same body the v4 login returned: the user, `token`, `refreshToken` and
`securityPolicy: { mfaPolicy }`. In cookie mode `token` and `refreshToken` are `null` and the
session cookies are written. The flow cookie is cleared.

**202: a partial authentication**, never 200:

```json
{
  "flow": "vf1.<routing>.<flowId>.<secret>",
  "expiresAt": "2026-09-24T10:10:00.000Z",
  "stage": {
    "options": [
      { "id": "totp", "kind": "verifier" },
      { "id": "email-otp", "kind": "verifier",
        "challenge": { "channel": "email", "destination": "d***@a***.com",
                       "expiresAt": "2026-09-24T10:05:00.000Z", "resendAt": "2026-09-24T10:00:30.000Z" } }
    ]
  }
}
```

`flow` is the credential in bearer mode and `null` in cookie mode, where it travels in a cookie.
An option carries `challenge` once a code was sent, `enrol` (`true`, then the setup
`{ secret, uri, qrCode }` once the enrolment started) when the stage demands an enrolment, and
`action` (`{ type: 'redirect', url }` or `{ type: 'post', url, fields }`) when the browser must go
elsewhere. **Codes and identifiers only, never a label**: the console draws its own.

**4xx: a refusal**, the usual error body (`statusCode`, `error`, `code`, `message`) plus
`remaining` (attempts left) and `retryAt` (when a refused send may be asked again) where they
apply. A refusal that ends the flow also clears its cookie. The codes are in §11.

`GET /auth/flow/options` answers `{ options: [{ id, kind }], accountCreation }`: the `oidc` option
carries `providers`, the keys of the providers active for this plane and tenant, and the tenant
plane adds the account creation mode (docs/API_V5.md §2.5). A client draws its buttons from it.

### 5.3 A login in requests

**Password, no second factor.** `POST /auth/flow/start { method: 'password', email, password }`
answers 200 with the session. No flow row is ever written: a login that closes in one request needs
none.

**Password, then TOTP.** `start` answers 202 with `totp` in the options; the row now holds the
proven subject. `POST /auth/flow/step { method: 'totp', code }` answers 200. A wrong code answers
401 `FLOW_CODE_INVALID` with `remaining`; the fifth ends the flow with `FLOW_ATTEMPTS_EXHAUSTED`.

**Forced enrolment.** Under `MANDATORY`, a subject with no factor gets a stage whose option is
`{ id: 'totp', kind: 'verifier', enrol: true }`. `step { method: 'totp', action: 'enrol' }` answers
202 with the setup; the client shows the QR code, and `step { method: 'totp', code }` enrols the
factor and completes the login in the same request. The secret is generated on the server and waits
encrypted in the row: the client never sends one.

**Email code as identifier.** `start { method: 'email-otp', email }` answers 202 with the
challenge; `step { method: 'email-otp', code }` identifies the subject and continues with the flow
chosen for its roles. `challenge { method: 'email-otp', email }` sends again: the flow stays bound
to the subject its first send named, so a different address in a later send costs the same and
delivers nothing.

**OIDC.** `start { method: 'oidc', provider: 'google', returnTo: '/orders' }` answers 202 with
`action: { type: 'redirect', url }`. The browser goes to the provider and comes back to
`/auth/flow/return/oidc`, which records the validated claims in the row and answers **303** to the
plane's `returnUrl`, with `?returnTo=/orders` when one was given. The console then calls
`step { method: 'oidc' }` with its flow credential, and only there is the subject resolved (§7) and
the session issued, or the next stage asked. A step that arrives before the browser does answers
409 `IDP_RETURN_PENDING` and may be repeated.

### 5.4 The flow credential

`vf1.<routing>.<flowId>.<secret>`, 32 bytes of secret from the CSPRNG, the same format family as
the refresh credential (`vs1`, docs/AUTHORIZATION_V5.md §9.1). The `routing` segment is the tenant
id, or `ctl` on the control plane and in single tenant; it is checked against the container the
request resolved and never used to choose one, so a credential of another tenant answers 403
`TENANT_MISMATCH`. Only the SHA-256 of the secret is stored.

| Mode | Where it travels |
|---|---|
| cookie (default) | a signed httpOnly cookie, `SameSite=Strict`: `auth_flow` with path `/auth/flow`, `control_flow` with path `/system/auth/flow`, both under `COOKIE_PATH_PREFIX` |
| bearer | the `flow` field of the body |

**Never the `Authorization` header.** The tenant resolution and the authentication hook both read
that header, and a flow credential is not a session. It is not a JWT, so the hook never mistakes one
for a token: this is what removed the list of routes the v4 temporary token could reach. For the
same reason every JWT that carries a `role` claim is refused everywhere with 401: the framework
signs none, and a temporary token of the old login still alive across the deploy would otherwise pass for a
session.

**One live proven flow per subject.** A flow holds its subject's slot only once the subject is
proven (the first stage passed); from then on a new proven flow of the same subject evicts the old
one in the same statement, and the old credential finds nothing. A flow not yet proven (an
`email-otp` identifier with only an address, an OIDC login waiting for the return) evicts nobody.
Every change to the row is one conditional statement on its `version`, so two steps racing each
other have one winner and the loser gets `FLOW_REQUIRED`.

**A flow is good for one session.** It is retired before the session is issued, whatever happens
next. A retired row keeps no secret and no subject slot, and stays until its sends leave the
24-hour window, because deleting it would reset the count a restart must not reset.

### 5.5 The return from a provider

The return is a browser navigation from another site: it carries no token and, with the header
resolver, no tenant header, and a `SameSite=Strict` cookie is not sent on it. It is bound to its
flow by the parameter the protocol itself gives back, `state` in OIDC, in the form
`st1.<routing>.<secret>` (128 bits of secret, about 63 bytes, sized to fit the 80 bytes SAML allows
`RelayState`). The `routing` chooses the container, the secret is looked up by hash **inside** it,
so an altered routing finds nothing; a tenant the request declares by subdomain or header that
disagrees is 403 `TENANT_MISMATCH`. This is not the tenant in the query string that v5 forbids:
that was a declaration believed, this is an address checked against a row written when the tenant
was resolved the normal way.

The return **never issues a session**. It records what the method validated in the row and answers
303 to `returnUrl`, with nothing in the URL but the optional `returnTo` path. The session is issued
by the next `step`, which only the browser holding the flow credential can make: a login CSRF (an
attacker landing their own code on the victim's browser) ends in the attacker's row. `returnTo` is
kept as a path only (no scheme, no `//host`, no backslash, no control character), so the redirect
cannot leave the configured console.

A failed return (the person declined, the provider refused, a claim did not validate) still
redirects, and spends the `state` as a success does. The navigation cannot carry an answer the
console reads, so the refusal is written in the row: the next `step` answers it (`IDP_DENIED`,
`IDP_RETURN_INVALID`, or a consumer method's own code) and ends the flow, and the access log has
`stage.failed` at the return and `login.failed` at the step. Without a `returnUrl` the return answers
200 `{ ok }` instead of redirecting.

---

## 6. Identity providers

### 6.1 Where a provider is declared

**By the deployment**, in `authFlows.ts` under `providers` for a plane. It serves the single-tenant
case and the control plane (operators logging in with the company IdP). The client secret is only
the **name** of an environment variable (`clientSecretEnv`), read once at boot, kept out of every
global and every log line; it rotates with a restart.

**By tenant**, in the `identity_provider` table of the control plane, written by a platform operator
with the `tenants` capability:

| Method | Path | Notes |
|---|---|---|
| GET | `/tenants/:id/identity-providers` | never the client secret |
| POST | `/tenants/:id/identity-providers` | `{ key, type: 'oidc', status?, config, clientSecret? }`. Validated in shape, without calling the provider |
| GET | `/tenants/:id/identity-providers/:key` | with `hasClientSecret`, never the secret |
| PUT | `/tenants/:id/identity-providers/:key` | `config` is replaced whole; `clientSecret` absent keeps the stored one, `null` removes it |
| DELETE | `/tenants/:id/identity-providers/:key` | removes the row and its secret |

The secret is encrypted by the data layer with the key of the MFA secrets (`MFA_DB_SECRET`, falling
back to `JWT_SECRET`), and the manager hands it back decrypted only to the login. **Never in
`tenant.config`**: that object is serialized to whoever reads the tenant.

The settings of a provider, the same rules for both sources:

| Setting | Rule |
|---|---|
| `issuer` | an https URL; discovery reads `/.well-known/openid-configuration` from it, cached for an hour |
| `clientId` | required |
| `redirectUri` | an absolute URL, explicit, never derived from the `Host` header: `https://<api>/auth/flow/return/oidc` |
| `scopes` | default `openid email profile` |
| `tokenAuthMethod` | `client_secret_basic` (default) or `client_secret_post`. Without a secret the client is public, and PKCE binds the code |
| `linkByEmail`, `emailDomains` | §7. `linkByEmail` needs a non-empty `emailDomains` |
| `jit` | `{ enabled, roles }`, tenant plane only, never the `admin` role |
| `mfa` | `{ trust: 'amr' \| 'acr', values: [...] }`, §6.3 |

Anything else is refused: `config` is stored in clear, so a secret put there by mistake must not be
accepted. A key is lowercase letters, digits, `-` or `_`.

### 6.2 Which provider a login gets

On the tenant plane of a multi-tenant deployment, a tenant's own **active** provider comes first,
then the deployment's of the same key. A **disabled** provider of the tenant hides the deployment's
of the same key, because the operator switched that key off for that customer. Elsewhere only the
deployment's providers exist. `GET /auth/flow/options` lists the resulting keys.

### 6.3 The provider's second factor (`idp-mfa`)

By default the provider's MFA **does not count**: `amr` and `acr` are a third party's claims, as
reliable as its configuration. A provider declared with `mfa: { trust: 'amr', values: ['mfa',
'hwk', 'otp'] }` (or `trust: 'acr'`, in which case the request asks for it with `acr_values`)
satisfies the pseudo-method `idp-mfa` when the ID token carries one of the values. `idp-mfa` counts
where a stage lists it and for the MFA floor (§8.2), nowhere else.

---

## 7. Linking and just-in-time provisioning

An identity at a provider is resolved to a subject in this order, and nothing else (F40):

1. **An existing link** on the four keys `(plane, provider, issuer, subject)`, never on the address.
   The linked account is judged as any login judges it.
2. **A link by address**, only where the provider declares `linkByEmail`, only for an address the
   provider says it verified (`email_verified: true`), only in one of its `emailDomains`. The link is
   created and `idp.linked` is logged.
3. **An account created just in time**, only on the tenant plane, only where the provider turns
   `jit` on, only for a verified address, never with the `admin` role, never over an existing
   account, and as the tenant's account creation mode allows (docs/API_V5.md §2.5): under `invite`
   only for an address in the provider's `emailDomains`; under `approval` the account is created
   waiting and already linked, and the login answers `ACCOUNT_PENDING_APPROVAL`; under `open`
   freely. The account is born confirmed, with a password nobody knows. `idp.provisioned` is logged.
4. Otherwise 403 `IDP_IDENTITY_NOT_LINKED`, logged as `idp.rejected`.

`sub` is unique per issuer only, and an address changes, is recycled and is unverified on many
providers: linking by address is the classic door to an account takeover, which is why each step
after the first is opt-in.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/auth/identities` | authenticated | the caller's own links |
| DELETE | `/auth/identities/:id` | authenticated | removes one; another subject's answers 404 |
| GET | `/users/:id/identities` | capability `users` | the links of a user |
| POST | `/users/:id/identities` | capability `users` | `{ provider, issuer, subject }`: never an address alone |
| DELETE | `/users/:id/identities/:linkId` | capability `users` | |

A user can see and remove their links, not add one: the self-service link is deferred (§12).

---

## 8. Sessions and the second factor

### 8.1 Who may log in

One rule, asked the same way by every door (the identifier, every step, the renewal, the resolution
of a provider login): on the tenant plane a valid row, a confirmed address, not blocked, not waiting for
approval (`mayLogIn`); on the control plane, not blocked. The cause of a refusal goes to the log;
the client gets `AUTH_INVALID_CREDENTIALS`, except after a provider login, where a waiting account
gets `ACCOUNT_PENDING_APPROVAL` because the provider has just proved the person owns it.

### 8.2 The MFA floor

The effective policy (docs/SECURITY_MFA.md) is applied **by the engine, not by the flow**. Under
`MANDATORY` a flow that would close with only the identifier gets one more stage: the factors the
subject has enrolled among those the plane names, and TOTP; with none enrolled, an enrolment in
`totp`. No configuration can lower it, because a floor a line of configuration can lower is not a
floor. `idp-mfa` from a trusted provider counts as the second factor. Under `OFF` no new factor can
be enrolled, in the flow or outside it, but whoever already has one keeps being asked for it. An
enrolment is offered inside the flow only to a subject with no factor at all, the same rule as the
409 `MFA_ALREADY_ENABLED` of the management routes; a stage that nobody can satisfy ends the flow
with 403 `FLOW_ENROLMENT_REFUSED`.

### 8.3 The session

The end of a flow issues the session **once**, the same session and refresh rotation as always
(docs/AUTHORIZATION_V5.md §9). The `session` row gains `auth_methods`, the methods the login
satisfied (for example `{password,totp}` or `{oidc,idp-mfa}`): whether a session was born without a
second factor is a fact that cannot be reconstructed afterwards, and a future step-up will ask it.
`reset_external_id_on_login` rotates the identifier once, at the end, on the tenant plane only.

### 8.4 The MFA management routes

`/auth/mfa/setup`, `/auth/mfa/enable`, `/auth/mfa/disable` and the `/system/auth/mfa/*` twins remain
as account management, and they need a **complete session**: no temporary token exists any more.
`enable` no longer issues a session, because the forced enrolment it served now happens inside the
flow. Enrolling, replacing or removing a factor is an operation on an account already
authenticated; only the enrolment `MANDATORY` imposes lives in the login.

---

## 9. The access log

A table, `access_log`, in every container: the events of a tenant's users in that tenant's
container, the platform's in the control plane, with `scope` telling them apart where both share a
container. Exporting or destroying a tenant carries its accesses with it, and an operator reads a
customer's accesses only by impersonating, which leaves its own trace.

**Events**, a closed list that the manager enforces: `login.succeeded`, `login.failed`,
`flow.started`, `stage.passed`, `stage.failed`, `challenge.sent`, `challenge.refused`,
`flow.expired`, `flow.exhausted`, `idp.linked`, `idp.unlinked`, `idp.provisioned`, `idp.rejected`,
`account.pending`, `account.approved`, `mfa.enrolled`, `mfa.disabled`, `logout`, `session.revoked`,
`session.reuse_detected`, `tokens.invalidated`. A successful renewal is deliberately not an event:
it happens every hour for every live session, and the session row keeps `last_used_at`.

**Columns**: `id` (UUID v7), `occurred_at`, `scope`, `event`, `outcome` (`success` or `failure`),
`code`, `subject_id` (the `externalId`, null when the subject is unknown), `methods`, `provider`,
`flow_id`, `sid`, `ip`. Nothing else: no user agent, no address tried for an unknown subject, never a
password, a code, a secret, a token or a claim. The IP is truncated to /24 (IPv4) or /48 (IPv6),
which, unlike a hash, cannot be reversed by trying every address; `ACCESS_LOG_IP=none` drops it.

**A write never fails a login.** One insert on the handle of the request, awaited inside a `try`:
awaited because the tenant's handle is given back when the response ends, and a later write would
use a handle somebody else holds. The process log line is written whatever happens to the row. An
`email-otp` identifier writes on both branches, so the log does not become the stopwatch the
delivery was moved out of.

**Reading**: `GET /access-log` and `/access-log/count` for the tenant's `admin`,
`GET /system/access-log` and `/count` with the `access-log` capability (granted to
`system:auditor`, implicit for `system:admin`). Magic Query over a closed list of fields; read-only.

**Retention**: 90 days on the tenant plane, 180 on the control plane (`ACCESS_LOG_RETENTION_DAYS`,
`ACCESS_LOG_CONTROL_RETENTION_DAYS`), purged opportunistically on one write in fifty and by
`npx volcanic access-log --purge [--tenants]` (docs/CONFIGURATION_V5.md §4).

---

## 10. Without a data layer

Without an `AuthFlowManagement` only the logins that close in one request work: `password` with no
stage that applies. A second step with no memory is a second step that counts no attempts, so a
plane that lists a stage that is not optional, `email-otp`, `oidc` or a `MANDATORY` policy refuses
the boot, and an optional stage that turns out to apply at a login answers 503
`AUTH_FLOW_NOT_AVAILABLE`. The five ports (docs/MANAGERS_V5.md §13 to §17) are Null Objects by
default and `@volcanicminds/backend/db` implements four of them; `ChallengeDeliveryManagement` is
always the consumer's, because the backend emits data, not presentation.

---

## 11. Refusals

| Code | Status | Ends the flow | When |
|---|---|:---:|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | yes | any failure of an identifier before the subject is proven, and a subject that may no longer log in |
| `AUTH_INPUT_INVALID` | 400 | when a flow exists | a malformed address, password or `returnTo` |
| `PASSWORD_TO_BE_CHANGED` | 403 | | the password verified and has expired |
| `FLOW_REQUIRED` | 401 | yes | no credential, a malformed or unknown one, a retired flow, a race lost to another step, a configuration changed under the flow |
| `FLOW_EXPIRED` | 401 | yes | the flow outlived `flowTtl` |
| `FLOW_METHOD_NOT_ALLOWED` | 403 | on a refused identifier | a method the plane or the stage does not offer, or an identifier the chosen flow does not accept |
| `FLOW_CODE_INVALID` | 401 | | a wrong or replayed code; `remaining` says how many are left. The last one answers `FLOW_ATTEMPTS_EXHAUSTED` |
| `FLOW_CODE_EXPIRED` | 401 | | the sent code expired or was used: ask for another |
| `FLOW_SEND_LIMIT` | 429 | | a send over a ceiling; `retryAt` says when |
| `FLOW_ATTEMPTS_EXHAUSTED` | 401 | yes | `otpMaxAttempts` wrong codes |
| `FLOW_ENROLMENT_REFUSED` | 403 | yes | the stage demands an enrolment the policy or the subject's factors do not allow |
| `AUTH_FLOW_NOT_AVAILABLE` | 503 | | the step needs a flow row and the build has no flow store (§10) |
| `MFA_NOT_AVAILABLE` | 503 | | a TOTP step in a build without an MFA manager |
| `TENANT_MISMATCH` | 403 | | the credential or `state` routes to another tenant than the request's |
| `IDP_UNKNOWN_PROVIDER` | 400 | yes | no active provider with that key here |
| `IDP_UNAVAILABLE` | 502 | yes | the provider's discovery failed |
| `IDP_RETURN_PENDING` | 409 | | the step arrived before the browser came back |
| `IDP_RETURN_INVALID`, `IDP_DENIED` | 401 | yes | the return failed (a claim that does not validate / the person or the provider declined); answered by the next step (§5.5) |
| `IDP_IDENTITY_NOT_LINKED` | 403 | yes | §7 |
| `ACCOUNT_PENDING_APPROVAL` | 403 | yes | the account behind a provider login awaits an administrator |
| `SYSTEM_USERS_NOT_AVAILABLE` | 503 | | a control-plane flow route in a build without platform identities |

A refusal code of a consumer's authenticator passes through as 401 with that code.

---

## 12. Deferred

**SAML.** The contract already has what it needs: `complete` with a posted form, `stateParam` for
`RelayState`, `action: { type: 'post', url, fields }`, a `state` short enough for SAML's 80 bytes,
and the `identity_provider.type` column. The method and its library are a later phase.

**Self-service linking** (F48, after 5.0). A user with a live session adding a provider account is a
back door for whoever steals that session for an hour: the link outlives password changes, logouts
and even a rotation of `external_id`. It will come with a flow of another purpose that asks for a
fresh re-authentication first, that is with step-up, which does not exist yet. Until then links are
created by the three routes of §7, by an administrator, or not at all.

**SMS and social logins.** `ChallengeChannel` already has `'sms'`, and `ChallengeDeliveryManagement`
will carry it; a social login is an OIDC provider or a consumer's authenticator with `initiate` and
`complete` (the test suite has one, `test/lib/fixtures/authenticators.ts`). No built-in method ships
for either.

**Step-up.** `auth_methods` on the session is what it will read; nothing asks for it yet.
