# Manager contracts (v5)

> **Status: specification. Implement exactly this.**
> Target: `@volcanicminds/backend` v5. Tasks **T-1.2**, **T-1.3**, **T-2.5** of `EVO_FRAMEWORK.md`.
> These interfaces are **the integration surface of the consumer**: they are what a project
> injects through `start(decorators)`. Changing one of them after v5 ships is a breaking change,
> so they are decided here, before the code.

## 1. The two handles

Every function that touches data receives, as its **first argument**, the handle that says
*where* it operates. Nothing is deduced from ambient state, ever.

```ts
declare const controlBrand: unique symbol
declare const tenantBrand: unique symbol

/** A connection bound to the control plane (the tenant registry, system users). */
export type ControlHandle = { readonly [controlBrand]: true }

/** A connection bound to one tenant container (schema, database, or file). */
export type TenantHandle = { readonly [tenantBrand]: true; readonly tenantId: string }

/** Application data: the tenant container when tenancy is on, the control plane when it is `none`. */
export type DataHandle = ControlHandle | TenantHandle
```

**The core declares the brands, the data layer supplies the client.** The types above live in
`types/global.d.ts` and carry no ORM in them: invariant 10 says the engine name does not appear
in the public API, and typing the handle as `DrizzleDatabase & brand` in the core would put it
there, in the one file every consumer loads. The data layer re-exports the same handles widened
to its client — `export type ControlDb = ControlHandle & NodePgDatabase` — and offers
`asClient(handle)` for the rare place that writes a query by hand instead of going through a
manager. Everything else takes a handle and passes it on, which is all a controller needs.

The handle of a request is read with one helper, so the choice is made in one place, and the
helper is **exported** (`import { dataContext } from '@volcanicminds/backend'`): an application
built on the framework makes the choice with the same function the framework uses.

`dataContext(req)` is **not** `req.tenant ?? req.control`. It answers exactly three cases and
none of them is a fallback (invariant 3, `lib/util/tenancy.ts`):

| The request | What it gets |
|---|---|
| declares `scope: 'control'` | the control plane, because it asked for it |
| runs where no `tenants` block is declared | the control plane, because that is where the application data lives |
| is a tenant route with a resolved container | the container |

A tenant route that reaches its handler **without** a resolved container gets a
`NoDataContextError`, never the control plane. Writing `req.tenant ?? req.control` by hand
inverts that last row: it hands a request that lost its context whatever the control plane
holds, which is defect D-06 under another spelling. `NoDataContextError` is exported as well,
because catching it means catching a bug in the resolution and not a bad request.

The brands are phantom types: they cost nothing at runtime and make
`tenantManager.createTenant(tenantHandle, …)` a **compile error**. That is invariant 6, and it is
the whole point: the separation is enforced by the compiler, not by the discipline of whoever
writes the query.

On a request:

```ts
req.control      // ControlHandle, always present
req.tenant?      // TenantHandle: the connection to this request's container
req.tenantInfo?  // Tenant: the registry row (id, slug, status, strategy, engine)
```

`req.tenant` is a **connection**, `req.tenantInfo` is a **record**. Keeping them in one property
is how v4 ended up with `@ts-ignore` on every access.

`req.db` and `req.runner` **do not exist in v5**. There are no deprecated aliases: this is a
major version and the migration is documented, not emulated.

---

## 2. Rules that apply to every manager

1. **Every method is `async`** and returns a `Promise`. In v4 several were declared
   `any | null` and were sometimes sync, sometimes not.
2. **The handle is the first parameter**, always named `ctx`. It is greppable: a call without a
   handle does not compile.
3. **No method reads global state.** No `global.connection`, no `global.repository`, no ambient
   request. Those do not exist in v5.
4. **`isImplemented()` stays.** It is how the core knows whether a real manager was injected or
   the null-object of `lib/defaults/managers.ts` is running.
5. **Errors are thrown, not returned as `null`,** whenever the failure is not "the row does not
   exist". A missing row returns `null`; a broken connection, a violated constraint or a missing
   context **throws**.
6. **Sensitive fields never leave a manager.** Password verification happens inside
   `retrieveUserByPassword`; the hash is not returned to the caller under any circumstance.

---

## 3. `UserManagement`

Operates on the `user` table, in the **application data** container.

```ts
export interface UserManagement {
  isImplemented(): boolean
  isValidUser(data: unknown): boolean

  createUser(ctx: DataHandle, data: NewUser): Promise<User>
  updateUserById(ctx: DataHandle, id: string, data: Partial<User>): Promise<User | null>
  deleteUser(ctx: DataHandle, id: string): Promise<boolean>            // soft delete: sets deleted_at
  resetExternalId(ctx: DataHandle, id: string): Promise<string>        // invalidates every token of the user

  retrieveUserById(ctx: DataHandle, id: string): Promise<User | null>
  retrieveUserByExternalId(ctx: DataHandle, externalId: string): Promise<User | null>
  retrieveUserByEmail(ctx: DataHandle, email: string): Promise<User | null>
  retrieveUserByUsername(ctx: DataHandle, username: string): Promise<User | null>
  retrieveUserByResetPasswordToken(ctx: DataHandle, token: string): Promise<User | null>
  retrieveUserByConfirmationToken(ctx: DataHandle, token: string): Promise<User | null>
  /** Constant-time comparison, also for an email that does not exist. */
  retrieveUserByPassword(ctx: DataHandle, email: string, password: string): Promise<User | null>

  changePassword(ctx: DataHandle, email: string, password: string, oldPassword: string): Promise<boolean>
  forgotPassword(ctx: DataHandle, email: string, ttlSeconds?: number): Promise<string | null>
  resetPassword(ctx: DataHandle, user: User, password: string): Promise<boolean>
  userConfirmation(ctx: DataHandle, user: User): Promise<boolean>

  blockUserById(ctx: DataHandle, id: string, reason: string): Promise<boolean>
  unblockUserById(ctx: DataHandle, id: string): Promise<boolean>
  /** Ends the wait of an account created under `approval` (F49); false when it was not waiting. */
  approveUserById(ctx: DataHandle, id: string): Promise<boolean>

  countQuery(ctx: DataHandle, data: VQuery): Promise<number>
  findQuery(ctx: DataHandle, data: VQuery): Promise<VFindResult<User>>

  saveMfaSecret(ctx: DataHandle, userId: string, secret: string): Promise<boolean>
  retrieveMfaSecret(ctx: DataHandle, userId: string): Promise<string | null>
  enableMfa(ctx: DataHandle, userId: string): Promise<boolean>
  disableMfa(ctx: DataHandle, userId: string): Promise<boolean>
  /** Emergency reset performed by an administrator, by id. */
  forceDisableMfa(ctx: DataHandle, userId: string): Promise<boolean>
}
```

**Changes from v4**: `disableUserById` is removed (it duplicated `blockUserById`);
`forceDisableMfaForAdmin(email)` becomes `forceDisableMfa(ctx, userId)` (the old name described
the caller, not the action, and taking an email invited enumeration);
`forgotPassword` loses its `runner?` parameter, replaced by `ctx`.

---

## 4. `TokenManagement`

```ts
export interface TokenManagement {
  isImplemented(): boolean
  isValidToken(data: unknown): boolean

  createToken(ctx: DataHandle, data: NewToken): Promise<Token>
  updateTokenById(ctx: DataHandle, id: string, data: Partial<Token>): Promise<Token | null>
  removeTokenById(ctx: DataHandle, id: string): Promise<boolean>
  resetExternalId(ctx: DataHandle, id: string): Promise<string>

  retrieveTokenById(ctx: DataHandle, id: string): Promise<Token | null>
  retrieveTokenByExternalId(ctx: DataHandle, externalId: string): Promise<Token | null>

  blockTokenById(ctx: DataHandle, id: string, reason: string): Promise<boolean>
  unblockTokenById(ctx: DataHandle, id: string): Promise<boolean>

  countQuery(ctx: DataHandle, data: VQuery): Promise<number>
  findQuery(ctx: DataHandle, data: VQuery): Promise<VFindResult<Token>>
}
```

A token whose `expires_at` is in the past is rejected at authentication time by the core, not by
the manager.

---

## 5. `TenantManagement`

Operates **only** on the control plane, and owns the life cycle of containers. Every method takes
a `ControlHandle`: passing a `TenantHandle` does not compile.

```ts
export interface TenantManagement {
  isImplemented(): boolean

  // ---- registry ----
  listTenants(ctx: ControlHandle, query?: VQuery): Promise<VFindResult<Tenant>>
  getTenant(ctx: ControlHandle, id: string): Promise<Tenant | null>
  getTenantBySlug(ctx: ControlHandle, slug: string): Promise<Tenant | null>
  createTenant(ctx: ControlHandle, data: NewTenant): Promise<Tenant>
  updateTenant(ctx: ControlHandle, id: string, data: Partial<Tenant>): Promise<Tenant | null>
  suspendTenant(ctx: ControlHandle, id: string, reason?: string): Promise<boolean>
  restoreTenant(ctx: ControlHandle, id: string): Promise<boolean>
  /** Soft-deletes the registry row only. It does NOT remove data: see destroyContainer. */
  softDeleteTenant(ctx: ControlHandle, id: string): Promise<boolean>

  // ---- containers ----
  /** Opens (or reuses from the LRU cache) a connection to the tenant's container. */
  openContainer(tenantId: string): Promise<TenantHandle>
  /** Returns the handle to the cache; never destroys session state, because none is kept. */
  closeContainer(handle: TenantHandle): Promise<void>
  /** Applies the tenant migration set to a container and returns the version reached. */
  migrateContainer(tenantId: string, target?: string): Promise<string>
  /** Dumps the container. Fails, rather than producing a partial file, if the tool is missing. */
  exportContainer(tenantId: string, destination: string): Promise<ExportResult>
  /** Irreversible. Only ever called after a successful export (see T-6.3). */
  destroyContainer(tenantId: string): Promise<boolean>
  /** Read-only report: schema version, size, row counts. Used by the destruction preview. */
  inspectContainer(tenantId: string): Promise<ContainerReport>
}
```

**Gone from v4**: `resolveTenant(req)` and `switchContext(tenant, db)`. Tenant **resolution**
moves into the core, which reads and verifies the token and passes only the tenant identifier
(task T-3.2, and the dependency-cruiser boundary forbids the data layer from importing core
values). Context **switching** disappears entirely: v5 never mutates session state, it opens a
handle (task T-3.1).

---

## 6. `SystemUserManagement` (new in v5)

Same authentication surface as `UserManagement`, restricted to the control plane, without
self-registration.

```ts
export interface SystemUserManagement {
  isImplemented(): boolean
  createSystemUser(ctx: ControlHandle, data: NewSystemUser): Promise<SystemUser>
  updateSystemUserById(ctx: ControlHandle, id: string, data: Partial<SystemUser>): Promise<SystemUser | null>
  deleteSystemUser(ctx: ControlHandle, id: string): Promise<boolean>
  retrieveSystemUserById(ctx: ControlHandle, id: string): Promise<SystemUser | null>
  retrieveSystemUserByEmail(ctx: ControlHandle, email: string): Promise<SystemUser | null>
  retrieveSystemUserByExternalId(ctx: ControlHandle, externalId: string): Promise<SystemUser | null>
  retrieveSystemUserByPassword(ctx: ControlHandle, email: string, password: string): Promise<SystemUser | null>
  blockSystemUserById(ctx: ControlHandle, id: string, reason: string): Promise<boolean>
  unblockSystemUserById(ctx: ControlHandle, id: string): Promise<boolean>
  countQuery(ctx: ControlHandle, data: VQuery): Promise<number>
  findQuery(ctx: ControlHandle, data: VQuery): Promise<VFindResult<SystemUser>>
  // MFA, same four methods as UserManagement
}
```

---

## 7. `TrackingManagement` (renamed from `DataBaseManagement`)

```ts
export interface TrackingManagement {
  isImplemented(): boolean
  /** The tracked row as it stands, for the baseline of the diff. */
  retrieveBy(ctx: DataHandle, entityName: string, entityId: string): Promise<any | null>
  addChange(ctx: DataHandle, change: NewChange): Promise<Change>
}
```

The v4 name said "database management" while the interface only wrote the audit trail.
`synchronizeSchemas()` is **removed**: schemas are versioned by migrations (phase 5), and a
method that rebuilds a schema from metadata is incompatible with that.

**Correction, made in T-3.5.** This section first typed `retrieveBy` as returning `Change[]`,
the audit history of an entity. The method has exactly one caller, the tracker, and what the
tracker needs is the row as it stands *before* the request writes to it, which is what the v4
method returned. A method whose declared type does not match the single job it exists for is a
defect of the document, so the document was corrected rather than the caller bent around it
(precedence rule, `EVO_FRAMEWORK.md` §0).

`retrieveBy` answers `null` in two cases the caller does not need to tell apart: the row does
not exist, or the table is not one the handle knows. The second is the normal case for a
consumer's own entity, because v5 has no registry of consumer entities (`global.entity` is
gone). Then the consumer supplies the baseline by setting `req.trackingData`, and if nobody
does, the change is recorded with the previous values **absent** rather than invented: an entry
without an `old` key means "not captured", which is not the same claim as `old: null`.

**Behaviour, and it is a change** (defect D-05): the tracker receives `ctx` and writes inside the
tenant container. If the write fails, the request fails, with an identifiable error code. A route
may opt out declaring `tracking: { strict: false }`, and then the failure is logged and the
request proceeds.

The change is written after the handler has already written its own row, and the two are not
in one transaction: strict mode therefore answers 500 on a request whose data change did
happen. Making them atomic means running the handler inside the tracker's transaction, which
is a different design. Until then, a visible inconsistency beats an invisible one.

---

## 8. `MfaManagement` and `TransferManagement`

Unchanged from v4 except for being fully `async`. They hold no data handle: `MfaManagement` is
pure computation, `TransferManagement` owns its own storage.

```ts
export interface MfaManagement {
  generateSetup(appName: string, email: string): Promise<{ secret: string; uri: string; qrCode: string }>
  /** Returns the matched time-step delta when valid, null when invalid. The delta enables replay rejection. */
  verify(token: string, secret: string): Promise<number | null>
}
```

---

> **`SessionManagement` belongs here and is written in §11.** It arrived with phase 11, by which
> time the numbering of this file was already quoted from the code (`lib/database/ports.ts` cites
> §9 for the section below), so it was appended instead of inserted and the existing numbers were
> left alone.

## 9. Ports the framework implements (not injected by the consumer)

These are internal, but they are the seam the adapters plug into (task T-1.3), and an
implementer needs them written down:

```ts
export interface ConnectionProvider {
  control(): ControlHandle
  /** Opens or reuses the container of a tenant; obeys the LRU limit of T-7.1. */
  tenant(tenantId: string): Promise<TenantHandle>
  /** Called once per request, after the response: releases what the request borrowed. */
  releaseRequestScope(scope: RequestScope): Promise<void>
  shutdown(): Promise<void>
}

export interface MigrationRunner {
  pending(container: ContainerRef): Promise<Migration[]>
  apply(container: ContainerRef, target?: string): Promise<string>
  version(container: ContainerRef): Promise<string | null>
}

export interface ContainerLifecycle {
  create(tenant: Tenant): Promise<void>
  export(tenant: Tenant, destination: string): Promise<ExportResult>
  destroy(tenant: Tenant): Promise<void>
  inspect(tenant: Tenant): Promise<ContainerReport>
}

export interface CapabilityMatrix {
  supports(engine: Engine, strategy: Strategy): boolean
  /** Called at boot. Logs fatal and exits 1 on an unsupported combination. */
  assertSupported(config: ResolvedConfig): void
}
```

---

## 10. Migration table for a v4 consumer

| v4 | v5 |
|---|---|
| `userManager.retrieveUserByEmail(email)` | `userManager.retrieveUserByEmail(dataContext(req), email)`, importing `dataContext` from `@volcanicminds/backend`. Not `req.tenant ?? req.control`: see §1 |
| `req.db` / `req.runner` | `req.tenant` / `req.control` |
| `dataBaseManager` | `trackingManager` |
| `dataBaseManager.synchronizeSchemas()` | removed: use migrations |
| `tenantManager.resolveTenant(req)` | removed: the core resolves the tenant |
| `tenantManager.switchContext(tenant, db)` | `tenantManager.openContainer(tenantId)` |
| `userManager.disableUserById(id)` | `userManager.blockUserById(id, reason)` |
| `userManager.forceDisableMfaForAdmin(email)` | `userManager.forceDisableMfa(ctx, userId)` |

---

## 11. `SessionManagement` (new in v5, phase 11)

The registry behind the refresh credential. A row is a **session**, not a token: `sid` is fixed for
the whole life of the session, what rotates at every renewal is the secret, and `generation` counts
the rotations. That shape is what makes "close this device", "close the family, a stolen secret came
back" and "where am I logged in" the same row and the same lookup. The mechanism is
`docs/AUTHORIZATION_V5.md` §9 and the table is `docs/SCHEMA_V5.md` §2.5.

```ts
export type SessionScope = 'tenant' | 'control'

export type SessionLookup =
  | { outcome: 'current'; session: Session }
  | { outcome: 'grace'; session: Session }
  | { outcome: 'reused'; session: Session }
  | { outcome: 'expired'; session: Session }
  | { outcome: 'revoked'; session: Session }
  | { outcome: 'unknown' }

export interface SessionManagement {
  isImplemented(): boolean

  openSession(
    ctx: DataHandle,
    data: {
      subjectId: string
      scope: SessionScope
      /** The clear secret. Only its hash is stored. */
      secret: string
      idleExpiresAt: Date | string
      absoluteExpiresAt: Date | string
      ip?: string | null
      userAgent?: string | null
      impersonationId?: string | null
    }
  ): Promise<Session>

  /** Classifies a presented secret. A malformed or unknown secret is an answer, not a throw. */
  findBySecret(ctx: DataHandle, secret: string, graceSeconds: number): Promise<SessionLookup>

  /** Spends the current generation and writes the next one. Null when the generation is stale. */
  rotate(
    ctx: DataHandle,
    sid: string,
    generation: number,
    next: { secret: string; idleExpiresAt: Date | string }
  ): Promise<Session | null>

  revokeSession(ctx: DataHandle, sid: string, reason: string): Promise<boolean>
  /** Returns how many were closed. */
  revokeAllOfSubject(ctx: DataHandle, subjectId: string, reason: string): Promise<number>
  listOfSubject(ctx: DataHandle, subjectId: string): Promise<Session[]>
  purgeExpired(ctx: DataHandle, before?: Date | string): Promise<number>
}
```

**The secret goes in and never comes out.** `openSession` takes it in clear, writes its SHA-256 and
keeps nothing else; no method returns one, and `Session` does not carry it. The caller composes the
credential from the secret it already holds, so a container that leaks its rows leaks nothing that
can renew a session. Rule 6 of §2, applied to a credential rather than to a password.

**`findBySecret` classifies and does not decide.** It runs on a string a stranger chose, so every
shape of one has an outcome instead of an exception:

| Outcome | What it means | What the renewal does |
|---|---|---|
| `current` | the secret is the live generation | renews |
| `grace` | the generation just replaced, still inside the tolerance window | renews, and leaves the credential alone: another call of the same session rotated first |
| `reused` | that same spent generation, outside the window | revokes the **whole** session: the server cannot tell the owner from the thief, and nobody can explain it innocently |
| `expired` | the right secret on a row past one of its clocks | refuses |
| `revoked` | a secret of a session already closed | refuses |
| `unknown` | no row carries that hash, in either generation | refuses |

The last three are deliberately **one** answer on the wire, `401 REFRESH_REQUIRED`: telling them
apart tells whoever holds a stolen credential which of the three it is holding.

**`rotate` takes the generation it expects to spend**, and that parameter is the whole concurrency
design. The update matches `sid` **and** that generation **and** a row not yet revoked, so of two
renewals racing each other only one can win: the first moves the generation forward, the second
matches no row. `null` is therefore **not an error and must not be raised as one**. It says "somebody
else rotated first", and the correct answer is a fresh access token with the credential left
untouched, because the caller's copy is now the previous generation and the grace window still
accepts it. Minting a second live secret there is exactly the bug this signature exists to prevent.

**Every method takes a `DataHandle`, never a `ControlHandle`**, because a session lives where its
subject lives: a tenant user's inside the tenant container, a platform identity's in the control
plane. Destroying or exporting a tenant therefore carries its sessions with it, and destroying a
customer cannot log out the operator who ordered it. The core never chooses that handle by itself,
the caller does, exactly as for users, and the compiler cannot catch passing the wrong one. The
`scope` column carries the fact instead: both kinds of row sit in the same container of a deployment
without tenants, and a renewal checks the scope it expects rather than trusting where it found the
row.

**`purgeExpired` removes what no renewal could use any more**, which means a row whose **first**
clock has run out, revoked or not. Revocation by itself deletes nothing: the moment and the reason
stay readable for as long as the row would have been usable had nobody closed it. It is called by
the CLI and, opportunistically, by the renewal.

**Without this manager there is no renewal at all**, and that is decision F28 rather than an
omission. The null-object default answers `isImplemented(): false`, and the core then refuses the
renewal and the session routes with `404` instead of issuing a refresh credential nobody could ever
consume or revoke. A credential that cannot be spent cannot be revoked either, so shipping one and
calling it a session is the worse of the two failures. A consumer that wants the registry elsewhere,
in Redis for instance, implements this interface and injects it: that is what the port is for.
| sync `encrypt` / `decrypt` | `await encrypt(...)` / `await decrypt(...)` |

---

## 12. `SettingManagement` (new in v5, phase 12)

```typescript
interface SettingManagement {
  isImplemented(): boolean
  /** The stored value, or null when the key was never written. */
  get(ctx: DataHandle, key: string): Promise<unknown>
  set(ctx: DataHandle, key: string, value: unknown, updatedBy?: string | null): Promise<void>
  remove(ctx: DataHandle, key: string): Promise<boolean>
}
```

One JSON value per key, in the `setting` table of a container. **Each plane writes where it owns
the data**: the platform's rules for every tenant go in the control container, a tenant's choices in
its own. The first user is the account creation rule of F49 (docs/API_V5.md §2.5): the key
`account_creation` in the control container holds `{ allowed, default }` for every tenant, the key
`account_creation.mode` in a tenant's container holds what its administrator chose. `set` is one
upsert on the key, never a read followed by a write, so two administrators saving at once cannot
both insert. A value is never a secret: whoever reads a key reads all of it.

**Without this manager** the null-object default answers `isImplemented(): false`, every rule falls
back to the deployment's configuration, and the routes that write a setting answer 503
`SETTINGS_NOT_AVAILABLE`.


---

## 13. `AuthFlowManagement` (new in v5, phase 12)

The store of the logins in progress (docs/AUTH_FLOW_V5.md §5, table `auth_flow` in
docs/SCHEMA_V5.md §2.7). The flow engine is its only caller.

```typescript
interface AuthFlowManagement {
  isImplemented(): boolean
  /** A proven subject evicts its previous flow in the same statement. The clear secret is hashed. */
  openFlow(ctx: DataHandle, data: {
    flowId: string; scope: SessionScope; secret: string
    subjectId?: string | null; candidateSubjectId?: string | null; flowName?: string | null
    expiresAt: Date | string; ip?: string | null; userAgent?: string | null
  }): Promise<AuthFlow>
  /** A malformed or unknown secret is an answer, not a throw. */
  findBySecret(ctx: DataHandle, flowId: string, secret: string): Promise<AuthFlowLookup> // current | expired | unknown
  findByState(ctx: DataHandle, state: string): Promise<AuthFlow | null>
  /** Optimistic on `version`: null when another step moved the flow first. */
  advance(ctx: DataHandle, flowId: string, version: number, patch: {
    subjectId?: string | null; candidateSubjectId?: string | null; flowName?: string | null
    stageIndex?: number; satisfied?: string[]
  }): Promise<AuthFlow | null>
  recordChallenge(ctx: DataHandle, flowId: string, data: {
    secret: string; method: string; code: string; expiresAt: Date | string; limits: ChallengeLimits
  }): Promise<ChallengeRecord>      // sent | limit (flow or subject)
  consumeChallenge(ctx: DataHandle, flowId: string, data: { secret: string; code: string; maxAttempts: number }): Promise<ChallengeConsumption>
  recordAttempt(ctx: DataHandle, flowId: string, data: { secret: string; maxAttempts: number }): Promise<AttemptRecord>
  bindExternal(ctx: DataHandle, flowId: string, data: { state?: string | null; external: AuthFlowExternal }): Promise<boolean>
  recordExternalResult(ctx: DataHandle, flowId: string, result: ExternalAuthResult): Promise<boolean>
  /** What a failed return leaves for the next step: `{ method, code }`. */
  recordExternalFailure(ctx: DataHandle, flowId: string, failure: ExternalAuthFailure): Promise<boolean>
  completeFlow(ctx: DataHandle, flowId: string): Promise<boolean>
  cancelFlow(ctx: DataHandle, flowId: string): Promise<boolean>
  purgeExpired(ctx: DataHandle, before?: Date | string): Promise<number>
}
```

**Every change is one conditional statement.** A read followed by a write would let two steps racing
each other both win: `advance` names the `version` it moves, `consumeChallenge` spends the right code
once and a wrong one costs an attempt in the same `UPDATE`, `recordAttempt` reserves an attempt
**before** a TOTP code is tested, so a burst of parallel guesses meets the ceiling instead of racing
past it, and `recordChallenge` applies the per-flow and per-subject ceilings in the statement that
records the send. `recordExternalResult` and `recordExternalFailure` write once and spend the
`state` in the same statement, so a return answers once, whether it succeeded or failed; the
returned `AuthFlow` carries the failure as `externalFailure`.

**No secret is stored in clear.** The flow secret and the `state` are stored as SHA-256, the code as
an HMAC keyed by the flow secret, which the table does not hold, and `external` (PKCE verifier,
`nonce`, enrolment secret) is encrypted by the manager with `MFA_DB_SECRET`. The manager hands
`external` back decrypted; the returned `AuthFlow` carries none of the hashes.

**Retiring is not deleting.** `completeFlow`, `cancelFlow` and an eviction clear every secret and
release the subject slot; the row stays until its sends leave the per-subject window, and
`purgeExpired` removes it after that. The engine purges opportunistically on one start in fifty.

**Without this manager** only a login that closes in one request works (docs/AUTH_FLOW_V5.md §10),
and the boot refuses a configuration that needs more.

## 14. `ExternalIdentityManagement` (new in v5, phase 12)

The links between an identity at a provider and a subject (docs/SCHEMA_V5.md §2.8).

```typescript
interface ExternalIdentityManagement {
  isImplemented(): boolean
  findLink(ctx: DataHandle, key: ExternalIdentityKey): Promise<ExternalIdentity | null> // { scope, provider, issuer, subject }
  createLink(ctx: DataHandle, data: ExternalIdentityKey & { subjectId: string; emailAtLink?: string | null }): Promise<ExternalIdentity>
  listOfSubject(ctx: DataHandle, subjectId: string, scope: SessionScope): Promise<ExternalIdentity[]>
  /** Removes the link only when it belongs to `subjectId`. */
  removeLink(ctx: DataHandle, id: string, subjectId: string): Promise<boolean>
  touch(ctx: DataHandle, id: string): Promise<boolean>
}
```

A link is found on the four keys and never on an address. `removeLink` takes the owner, so a route
that removes "one of mine" cannot remove somebody else's by guessing an id. Without this manager a
provider login resolves nobody and answers `IDP_IDENTITY_NOT_LINKED`.

## 15. `IdentityProviderManagement` (new in v5, phase 12)

A tenant's own identity providers, in the control plane (docs/SCHEMA_V5.md §3.5). Every method
takes a `ControlHandle`: the registry is the platform's.

```typescript
interface IdentityProviderManagement {
  isImplemented(): boolean
  list(ctx: ControlHandle, tenantId: string): Promise<IdentityProvider[]>
  /** The only method that answers the client secret, decrypted. */
  get(ctx: ControlHandle, tenantId: string, key: string): Promise<IdentityProviderWithSecret | null>
  create(ctx: ControlHandle, data: {
    tenantId: string; key: string; type: 'oidc'; status?: 'active' | 'disabled'
    config: OidcProviderSettings; clientSecret?: string | null
  }): Promise<IdentityProvider>
  update(ctx: ControlHandle, tenantId: string, key: string, patch: {
    status?: 'active' | 'disabled'; config?: OidcProviderSettings; clientSecret?: string | null
  }): Promise<IdentityProvider | null>
  remove(ctx: ControlHandle, tenantId: string, key: string): Promise<boolean>
  /** Every provider of the tenant; answers how many rows went. Called by the destruction. */
  removeAll(ctx: ControlHandle, tenantId: string): Promise<number>
}
```

**The encryption is the data layer's.** The core cannot import the data layer's crypto
(`core-no-datalayer-import`), so the manager encrypts on write and decrypts in `get`, with the key of
the MFA secrets. `list` never carries the secret. In `update`, a `clientSecret` absent keeps the
stored one and `null` removes it. Without this manager only the deployment's providers exist.

## 16. `ChallengeDeliveryManagement` (new in v5, phase 12, injected by the consumer)

How a code reaches a person. The framework ships no implementation: the backend emits data, not
presentation, so the consumer composes the subject and the text, in its own language.

```typescript
interface ChallengeDeliveryManagement {
  isImplemented(): boolean
  deliver(message: {
    channel: 'email' | 'sms'
    to: string                // always the address on file, never one taken from a request
    code: string
    purpose: 'identify' | 'verify'
    expiresAt: Date | string
    plane: 'tenant' | 'control'
    tenantId: string | null
    subjectId: string         // the external id
    locale?: string | null
  }): Promise<void>
}
```

A consumer wires it to `Mailer` of `@volcanicminds/tools/mailer`, or to anything else:

```typescript
const challengeDeliveryManager = {
  isImplemented: () => true,
  deliver: async ({ to, code, expiresAt }) => {
    await mailer.send({ to, subject: 'Your sign-in code', html: `<p>${code}</p>` })
  }
}
await startServer({ ...layer, challengeDeliveryManager })
```

`deliver` is called after the response is decided and never awaited by the request, because the
latency of a mail server would tell an observer whether an address has an account; a failure is a
log line. `sms` is in the type for the method that will use it; no built-in method sends one yet.
**Without it**, a plane that lists `email-otp` refuses the boot.

## 17. `AccessLogManagement` (new in v5, phase 12)

The access log (docs/SCHEMA_V5.md §2.9, docs/AUTH_FLOW_V5.md §9).

```typescript
interface AccessLogManagement {
  isImplemented(): boolean
  /** Refuses an event outside the vocabulary; truncates the IP or drops it (`ACCESS_LOG_IP`). */
  record(ctx: DataHandle, entry: AccessLogEntry): Promise<AccessLogRecord>
  /** `scope` is a condition the query cannot relax, `_logic` included. */
  findQuery(ctx: DataHandle, query: VQuery, scope?: SessionScope): Promise<VFindResult<AccessLogRecord>>
  countQuery(ctx: DataHandle, query: VQuery, scope?: SessionScope): Promise<number>
  purgeBefore(ctx: DataHandle, before: Date | string, scope?: SessionScope): Promise<number>
  /** Rows past the retention of their own scope (90 and 180 days by default), in one statement. */
  purgeExpired(ctx: DataHandle, now?: Date): Promise<number>
}
```

The core asks `isImplemented()` before writing, and a failed write is logged and never fails the
request it describes. Without tenants both planes write into one container, which is why `scope` is
a parameter of every read rather than a filter the caller may forget. **Without this manager** the
accesses reach the process log only, and `/access-log` answers 404.
