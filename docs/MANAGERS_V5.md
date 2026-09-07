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

Inside the framework the handle of a request is read with one helper, so the choice is made in
one place: `dataContext(req)` returns `req.tenant ?? req.control`, that is the tenant container
when tenancy is on and the control plane when it is not.

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
| `userManager.retrieveUserByEmail(email)` | `userManager.retrieveUserByEmail(dataContext(req), email)`, or `req.tenant ?? req.control` written out |
| `req.db` / `req.runner` | `req.tenant` / `req.control` |
| `dataBaseManager` | `trackingManager` |
| `dataBaseManager.synchronizeSchemas()` | removed: use migrations |
| `tenantManager.resolveTenant(req)` | removed: the core resolves the tenant |
| `tenantManager.switchContext(tenant, db)` | `tenantManager.openContainer(tenantId)` |
| `userManager.disableUserById(id)` | `userManager.blockUserById(id, reason)` |
| `userManager.forceDisableMfaForAdmin(email)` | `userManager.forceDisableMfa(ctx, userId)` |
| sync `encrypt` / `decrypt` | `await encrypt(...)` / `await decrypt(...)` |
