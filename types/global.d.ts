/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-object-type */
import { FastifyRequest, FastifyReply } from 'fastify'
export { FastifyInstance } from 'fastify'
import { MfaPolicy } from '../lib/config/constants.js'
import { VQuery, VFindResult, VHeaders } from './orm.js'

export { MfaPolicy, VQuery, VFindResult, VHeaders }

export interface AuthenticatedUser {
  getId(): any
  username: string
  email: string
  roles: Role[]
  externalId: string
  mfaEnabled?: boolean
}

export interface AuthenticatedToken {
  getId(): any
  name: string
  roles: Role[]
}

export interface Role {
  code: string
  name: string
  description: string
  // Capabilities granted to this role (see docs/AUTHORIZATION_MODEL.md §3). Named only
  // in config, resolved at boot, never at runtime. `admin`/`public` are protected
  // built-ins and never carry capabilities (locked by the roles loader).
  capabilities?: string[]
}

export interface Roles {
  [option: string]: Role
}

// ---------------------------------------------------------------------------------------
// System identity (T-4.1, docs/AUTHORIZATION_V5.md §2-§4)
//
// Who administers the PLATFORM is a different thing from who administers a tenant, and in v5
// it is a different type. In v4 the only thing separating a super-admin from a tenant admin
// was which schema resolved the `user` table, i.e. exactly what defect D-01 broke: every
// administrative operation was one defect away from a privilege escalation.
//
// What the compiler can enforce, it does: a system role's code must start with `system:`,
// and its capabilities must come from the closed control catalogue, so a system role cannot
// name `users` and a control route cannot ask for a capability the framework does not
// honour. What it cannot enforce is the other direction, because TypeScript has no way to
// subtract a literal union from `string`: nothing stops a tenant role from writing
// `capabilities: ['tenants:destroy']`. That gap is closed at boot instead, by the router's
// integrity check (docs/AUTHORIZATION_V5.md §2.1), which refuses to start rather than warn.
// ---------------------------------------------------------------------------------------

/** The control catalogue. Closed and reserved: a consumer cannot coin one. */
export type SystemCapability =
  | 'tenants:read'
  | 'tenants'
  | 'tenants:impersonate'
  | 'tenants:export'
  | 'tenants:destroy'
  | 'migrations'
  | 'manifest'
  | 'system-users'

export interface SystemRole {
  /** Always namespaced: the prefix is what keeps the two catalogues from ever merging. */
  code: `system:${string}`
  name: string
  description: string
  capabilities?: SystemCapability[]
}

export interface SystemRoles {
  [option: string]: SystemRole
}

export interface Data {
  [option: string]: any
}

// Structural hints (manifest L1) — domain-only, optional, additive. Usually declared
// at the file-level `config` of a routes.ts (one file ≈ one resource), overridable per-route.
export interface ResourceHints {
  name?: string // canonical resource name; maps schemas → resource without heuristics
  titleField?: string | string[]
  subtitleField?: string | string[]
  globalSearch?: string[] // omni-search fields (OR)
}

// Structural hints (manifest L1) authored in routes.ts, grouped under `config.manifest`
// to keep them separate from the operational route config (Fastify schema, controller, …).
export interface ManifestHints {
  group?: string // sidebar group hint
  resource?: ResourceHints // resource-level hints (name, titleField, …)
}

export interface RouteConfig {
  title: string
  description: string
  enable: boolean
  deprecated: boolean
  /**
   * Which plane the route acts on: 'tenant' (the default) or 'control'.
   *
   * The v4 spelling `tenantContext` is not accepted, and not translated either: the router
   * refuses to start on a route that still uses it (T-3.3, invariant 9). The conversion is
   * one line and it is in docs/MIGRATION_V4_V5.md.
   */
  scope?: 'tenant' | 'control'
  /**
   * Audit trail behaviour for this route (T-3.5). WHAT is tracked is declared in
   * `config/tracking.ts`; this says what happens when the change cannot be written.
   *
   * `strict` defaults to true: the request fails with `TRACKING_FAILED`. Declare
   * `tracking: { strict: false }` where the trail is accessory, and the failure becomes a
   * log line. The deployment-wide default can be moved with `config.strict` in
   * `config/tracking.ts`.
   */
  tracking?: { strict?: boolean }
  tags?: string[]
  version: string
  security?: any
  params?: any
  query?: any
  body?: any
  response?: any
  consumes?: any
  rawBody?: boolean
  manifest?: ManifestHints // structural hints for the generated manifest (group + resource)
  cache?: boolean | number | RouteCache // file-level cache default (inherited by every route; per-route `cache` overrides)
}

// Per-route caching (opt-in). Authored on the route: `true` (default TTL), a number
// (TTL in seconds), or the full object. Only GET responses with a 2xx status are
// cached; `invalidates` works on any method (typically mutations).
export interface RouteCache {
  enabled?: boolean // default true when the object is present
  ttl?: number // seconds; default from global config (options.cache.ttl)
  keyGroup?: string // logical key-group for invalidation; default = the api folder (area)
  invalidates?: string | string[] // key-groups to flush after a successful (2xx) response
}

// The normalized form threaded onto a ConfiguredRoute (keyGroup always resolved).
export interface NormalizedRouteCache {
  enabled: boolean
  ttl?: number
  keyGroup: string
  invalidates?: string[]
}

export interface Route {
  method: string
  path: string
  handler: string
  // Role objects (from the global `roles` catalog) or bare string codes; string codes
  // are resolved and validated against the catalog at load (unknown code → fail-fast).
  roles: (Role | string)[]
  // Gate on a capability: the allowed set becomes admin + every role that declares it.
  // A capability held by no role leaves the route admin-only. See docs/AUTHORIZATION_MODEL.md §3.
  requireCapability?: string
  middlewares: string[]
  config?: RouteConfig
  rateLimit?: any
  cache?: boolean | number | RouteCache
}

export type Engine = 'postgres' | 'sqlite' | 'libsql' | 'pglite'
export type TenantStrategy = 'schema' | 'container'
export type TenantResolver = 'header' | 'subdomain'

export interface PoolConfig {
  max?: number
  idleTimeoutMs?: number
}

export interface ControlConfig {
  engine: Engine
  /** Connection string; wins over the discrete DB_* variables. */
  url?: string
  /** Postgres only: the schema the control plane lives in. Explicit, never inferred. */
  schema?: string
  pool?: PoolConfig
  [option: string]: unknown
}

export interface ContainersConfig {
  /** LRU limit of live tenant containers (docs/CONFIGURATION_V5.md §1). */
  maxOpen?: number
  idleTimeoutMs?: number
  poolMax?: number
  /** `container` + sqlite/libsql only: where the per-tenant files live. */
  directory?: string
}

export interface TenantsConfig {
  strategy: TenantStrategy
  engine: Engine
  /** How the tenant is resolved for requests that carry no token. Never `query`: see D-11. */
  resolver?: TenantResolver
  headerKey?: string
  /** Which label of the hostname carries the tenant, when resolver is `subdomain`. */
  subdomainLevel?: number
  containers?: ContainersConfig
  migrations?: {
    checkOnResolve?: boolean
    refuseStartIfControlBehind?: boolean
  }
  [option: string]: unknown
}

// ---------------------------------------------------------------------------------------
// Data handles (docs/MANAGERS_V5.md §1)
//
// Two nominal types, so the compiler forbids passing a tenant connection where a control
// one is required. The brands are phantom: nothing exists at runtime. The core declares
// them WITHOUT naming an ORM — that is invariant 10, and it is what tied v4 to TypeORM in
// three files outside the data layer. The data layer re-exports them widened to its own
// client and offers an accessor for the rare hand-written query.
// ---------------------------------------------------------------------------------------
declare const controlBrand: unique symbol
declare const tenantBrand: unique symbol

/** A connection bound to the control plane: the tenant registry and the system users. */
export type ControlHandle = { readonly [controlBrand]: true }

/** A connection bound to one tenant container: a schema, a database, or a file. */
export type TenantHandle = { readonly [tenantBrand]: true; readonly tenantId: string }

/** Application data: the tenant container when tenancy is on, the control plane when it is not. */
export type DataHandle = ControlHandle | TenantHandle

/**
 * What one request borrows from the data layer (T-3.1).
 *
 * It exists so that giving it back has ONE address. In v4 the release was written twice,
 * an `onResponse` hook and a listener on `reply.raw`, and the two ran in the wrong order,
 * which is how a tenant's `search_path` went back into the pool (D-01). One scope, one
 * release, and a second call is a no-op rather than a double free.
 */
export interface DataRequestScope {
  readonly requestId: string
  tenantId?: string
  /** Set by the single release point: a scope is given back once. */
  released?: boolean
}

/**
 * The data layer seam the core is allowed to know about. No ORM, no connection type, no
 * import from `lib/database` (dependency-cruiser forbids it): the core receives this shape
 * as a decorator and calls it.
 */
export interface DataProvider {
  control(): ControlHandle | Promise<ControlHandle>
  /** `scope` says which request is holding the container, so the LRU knows not to close it. */
  tenant(tenantId: string, scope?: DataRequestScope): Promise<TenantHandle>
  /**
   * Returns whatever the request borrowed. `error` is passed when the client went away
   * mid-flight: a connection given back after an abort must be destroyed, not reused.
   */
  releaseRequestScope(scope: DataRequestScope, error?: Error): Promise<void>
  shutdown(): Promise<void>
}

/** A row of the tenant registry (docs/SCHEMA_V5.md §3.1). Never a connection: see `TenantHandle`. */
export interface Tenant {
  id: string
  name: string
  slug: string
  strategy: TenantStrategy
  engine: Engine
  /** Where the data is: schema name, database name, or file path. */
  locator: string
  status: 'active' | 'suspended' | 'archived'
  schemaVersion?: string | null
  config?: Record<string, unknown>
}

export interface GeneralConfig {
  name: string
  options: {
    allow_multiple_admin: boolean
    allow_admin_change_password_users: boolean
    // Opt-in: users created by an admin (POST /users) start confirmed (login-ready),
    // unless the payload explicitly sends confirmed:false.
    allow_admin_create_confirmed_users?: boolean
    reset_external_id_on_login: boolean
    scheduler: boolean
    embedded_auth: boolean
    // MFA Configs
    mfa_policy?: MfaPolicy | string
    mfa_admin_forced_reset_email?: string
    mfa_admin_forced_reset_until?: string
    // Lifetime of a /auth/forgot-password reset token, in seconds (default 3600).
    reset_password_token_ttl?: number
    /** Seconds an impersonation session lasts (T-4.2). Default 1800, hard maximum 14400. */
    impersonation_ttl?: number
    // Where the platform's own data lives: the tenant registry, the system users, and
    // the application data itself when there are no tenants (docs/CONFIGURATION_V5.md §1).
    control?: ControlConfig
    // Absent = single tenant. Declaring the block is what enables tenancy: there is no
    // separate `enabled` flag that could contradict the strategy.
    tenants?: TenantsConfig | null
    // Admin manifest capability (opt-in): exposes GET /admin/manifest
    manifest?: {
      enabled: boolean
    }
    // In-memory per-route response cache (opt-in per route via `cache`).
    cache?: {
      enabled?: boolean // master switch (default true)
      ttl?: number // default TTL in seconds for routes without an explicit ttl
      maxEntries?: number // LRU cap (slots) before least-recently-used eviction
    }
  }
}

/**
 * Where a scheduled job runs (T-3.4).
 *
 * `control` is the default because a job that says nothing must not touch a customer's
 * data: in v4 a job ran with no context at all, which meant it ran on whatever connection
 * the pool handed over, i.e. inside an arbitrary tenant (defect D-07).
 */
export type JobScope = 'control' | 'tenant' | 'every-tenant'

/** What the framework hands a job besides its data handle. */
export interface JobRun {
  jobName: string
  /** The registry row, on `tenant` and `every-tenant` runs. Never a connection. */
  tenant?: Tenant
  /** Aborted when the server closes: a fan-out over every tenant must be interruptible. */
  signal: AbortSignal
}

export type JobFunction = (ctx: DataHandle, run: JobRun) => unknown | Promise<unknown>

export interface JobSchedule {
  active: boolean // boolean (required)
  type?: string // cron|interval, default: interval
  async?: boolean // boolean, default: true
  preventOverrun?: boolean // boolean, default: true

  /** Which plane the job runs on. Default 'control'. */
  scope?: JobScope
  /** Required with scope 'tenant': the slug of the tenant the job runs inside. */
  tenant?: string
  /** Scope 'every-tenant' only: how many containers are worked at a time. Default 1, max 16. */
  concurrency?: number

  cron?: {
    expression?: string // required if type = 'cron', use cron syntax (if not specified cron will be disabled)
    timezone?: string // optional, like "Europe/Rome" (to test)
  }

  interval?: {
    days?: number // number, default 0
    hours?: number // number, default 0
    minutes?: number // number, default 0
    seconds?: number // number, default 0
    milliseconds?: number // number, default 0
    runImmediately?: boolean // boolean, default: false
  }
}

export interface ConfiguredRoute {
  enable: boolean
  tenantContext: boolean
  tracking?: { strict?: boolean }
  method: any
  path: string
  handler: any
  rawBody: boolean
  rateLimit: any
  file: string
  func: any
  base: string
  middlewares: string[]
  roles: Role[]
  doc: {
    summary?: string
    description?: string
    deprecated?: boolean
    tags?: string[]
    version?: string
    security?: any
    params?: any
    querystring?: any
    body?: any
    response?: any
    consumes?: any
  }
  group?: string // structural hint (manifest)
  resource?: ResourceHints // structural hints (manifest)
  cache?: NormalizedRouteCache // per-route caching (normalized)
}

export interface TrackChanges {
  enable: boolean
  method: string
  path: string
  /**
   * The tracked entity. When it names a table the framework knows (`user`, `token`), the
   * previous state is read automatically to build the diff; for a consumer's own entity the
   * framework cannot reach the table, so the consumer sets `req.trackingData` itself and the
   * change is otherwise recorded without the previous values.
   */
  entity: string
  fields?: {
    includes?: string[] | null
    excludes?: string[] | null
  } | null
  primaryKey?: string | null
}

export interface TrackChangesList {
  [option: string]: TrackChanges
}

// ---------------------------------------------------------------------------------------
// Managers: the integration surface a consumer injects through start(decorators).
// Contract: docs/MANAGERS_V5.md. Three rules hold everywhere:
//   - the handle is the FIRST argument, always named ctx: a call without a context does
//     not compile, and it is greppable;
//   - every method is async;
//   - a missing row returns null, anything else throws. No method reads global state.
// ---------------------------------------------------------------------------------------
export interface UserManagement {
  isImplemented(): boolean
  isValidUser(data: any): boolean

  createUser(ctx: DataHandle, data: any): Promise<any>
  updateUserById(ctx: DataHandle, id: string, data: any): Promise<any | null>
  deleteUser(ctx: DataHandle, id: string): Promise<boolean>
  /** Rotates the public identifier, which invalidates every token of that user. */
  resetExternalId(ctx: DataHandle, id: string): Promise<string>

  retrieveUserById(ctx: DataHandle, id: string): Promise<any | null>
  retrieveUserByExternalId(ctx: DataHandle, externalId: string): Promise<any | null>
  retrieveUserByEmail(ctx: DataHandle, email: string): Promise<any | null>
  retrieveUserByUsername(ctx: DataHandle, username: string): Promise<any | null>
  retrieveUserByResetPasswordToken(ctx: DataHandle, token: string): Promise<any | null>
  retrieveUserByConfirmationToken(ctx: DataHandle, token: string): Promise<any | null>
  /** Constant-time comparison, also for an email that does not exist. */
  retrieveUserByPassword(ctx: DataHandle, email: string, password: string): Promise<any | null>

  changePassword(ctx: DataHandle, email: string, password: string, oldPassword: string): Promise<any>
  /** Mints a reset token carrying its own `<epochSeconds>.` expiry prefix. */
  forgotPassword(ctx: DataHandle, email: string, ttlSeconds?: number): Promise<string | null>
  resetPassword(ctx: DataHandle, user: any, password: string): Promise<any>
  userConfirmation(ctx: DataHandle, user: any): Promise<any>

  blockUserById(ctx: DataHandle, id: string, reason: string): Promise<any>
  unblockUserById(ctx: DataHandle, id: string): Promise<any>

  countQuery(ctx: DataHandle, data: VQuery): Promise<number>
  findQuery(ctx: DataHandle, data: VQuery): Promise<VFindResult<any>>

  saveMfaSecret(ctx: DataHandle, userId: string, secret: string): Promise<boolean>
  retrieveMfaSecret(ctx: DataHandle, userId: string): Promise<string | null>
  enableMfa(ctx: DataHandle, userId: string): Promise<boolean>
  disableMfa(ctx: DataHandle, userId: string): Promise<boolean>
  /** Emergency reset performed by an administrator, by id — never by email (enumeration). */
  forceDisableMfa(ctx: DataHandle, userId: string): Promise<boolean>
}

export interface TokenManagement {
  isImplemented(): boolean
  isValidToken(data: any): boolean

  createToken(ctx: DataHandle, data: any): Promise<any>
  updateTokenById(ctx: DataHandle, id: string, token: any): Promise<any | null>
  removeTokenById(ctx: DataHandle, id: string): Promise<boolean>
  resetExternalId(ctx: DataHandle, id: string): Promise<string>

  retrieveTokenById(ctx: DataHandle, id: string): Promise<any | null>
  retrieveTokenByExternalId(ctx: DataHandle, externalId: string): Promise<any | null>

  blockTokenById(ctx: DataHandle, id: string, reason: string): Promise<any>
  unblockTokenById(ctx: DataHandle, id: string): Promise<any>

  countQuery(ctx: DataHandle, data: VQuery): Promise<number>
  findQuery(ctx: DataHandle, data: VQuery): Promise<VFindResult<any>>
}

/**
 * The audit trail. Renamed from `DataBaseManagement`, which promised to manage a database
 * and only ever wrote changes; `synchronizeSchemas()` is gone with it, because a schema
 * rebuilt from metadata cannot coexist with versioned migrations.
 */
export interface TrackingManagement {
  isImplemented(): boolean
  /**
   * The tracked row as it stands, for the baseline of the diff. `null` when the row does
   * not exist or when the table is not one this handle knows (docs/MANAGERS_V5.md §7).
   */
  retrieveBy(ctx: DataHandle, entityName: string, entityId: string): Promise<any | null>
  addChange(ctx: DataHandle, change: NewChange): Promise<any>
}

/** What the tracker asks to be recorded. Append-only: a change is never updated. */
export interface NewChange {
  entityName: string
  entityId: string
  status: 'create' | 'update' | 'delete'
  userId?: string | null
  tokenId?: string | null
  /** The impersonation session behind the write, when there was one (T-4.2). */
  impersonationId?: string | null
  contents: Array<{ key: string; old?: unknown; new?: unknown }>
}

/**
 * A system user acting as a tenant user, recorded before it can happen (T-4.2).
 *
 * In v4 an impersonation left a claim in a token and nothing else: no record, twenty-four
 * hours of validity, no way to revoke it, and the privilege check guarding it compared a
 * field the entity did not have (defect D-18). The row is the difference between an audited
 * capability and a back door with a comment.
 */
export interface Impersonation {
  id: string
  systemUserId: string
  tenantId: string
  targetUserId: string
  /** Free text, required. An impersonation without a stated reason is refused. */
  reason: string
  ip?: string | null
  userAgent?: string | null
  createdAt: Date | string
  expiresAt: Date | string
  revokedAt?: Date | string | null
}

export interface ImpersonationManagement {
  isImplemented(): boolean
  /** Written BEFORE any token is issued: the record is the permission, not the receipt. */
  openImpersonation(ctx: ControlHandle, data: Omit<Impersonation, 'id' | 'createdAt' | 'revokedAt'>): Promise<Impersonation>
  getImpersonation(ctx: ControlHandle, id: string): Promise<Impersonation | null>
  /** Idempotent: revoking an already revoked session is not an error, it is the same state. */
  revokeImpersonation(ctx: ControlHandle, id: string): Promise<boolean>
  findQuery(ctx: ControlHandle, data: VQuery): Promise<VFindResult<Impersonation>>
}

export interface MfaManagement {
  generateSetup(appName: string, email: string): Promise<{ secret: string; uri: string; qrCode: string }>
  /** The matched time-step delta when valid, null when invalid: the delta rejects replays. */
  verify(token: string, secret: string): Promise<number | null> | number | null
}

// Callback type signature: (uploadOrId, req, res) => void
export type TransferCallback = (data: any, req: any, res: any) => void

export interface TransferManagement {
  isImplemented(): boolean
  getPath(): string
  getServer(): any
  onUploadCreate(callback: TransferCallback): void
  onUploadFinish(callback: TransferCallback): void
  onUploadTerminate(callback: TransferCallback): void
  handle(req: any, res: any): Promise<void>
  isValid(req: FastifyRequest): Promise<boolean>
}

/**
 * The registry and the life cycle of containers. Every registry method takes a
 * ControlHandle: passing a TenantHandle does not compile.
 *
 * `resolveTenant(req)` and `switchContext(tenant, db)` of v4 are gone. Resolution moved to
 * the core, which reads and verifies the token and hands down only the identifier; context
 * switching disappeared entirely, because v5 never mutates session state (T-3.1).
 */
export interface TenantManagement {
  isImplemented(): boolean

  listTenants(ctx: ControlHandle, query?: VQuery): Promise<VFindResult<Tenant>>
  getTenant(ctx: ControlHandle, id: string): Promise<Tenant | null>
  getTenantBySlug(ctx: ControlHandle, slug: string): Promise<Tenant | null>
  createTenant(ctx: ControlHandle, data: any): Promise<Tenant>
  updateTenant(ctx: ControlHandle, id: string, data: any): Promise<Tenant | null>
  suspendTenant(ctx: ControlHandle, id: string, reason?: string): Promise<boolean>
  restoreTenant(ctx: ControlHandle, id: string): Promise<boolean>
  /** Soft-deletes the registry row only. It does NOT remove data: that is destroyContainer. */
  softDeleteTenant(ctx: ControlHandle, id: string): Promise<boolean>

  openContainer(tenantId: string): Promise<TenantHandle>
  closeContainer(handle: TenantHandle): Promise<void>
  migrateContainer(tenantId: string, target?: string): Promise<string>
  exportContainer(tenantId: string, destination: string): Promise<any>
  /** Irreversible. Only ever called after a successful export (T-6.3). */
  destroyContainer(tenantId: string): Promise<boolean>
  inspectContainer(tenantId: string): Promise<any>
}

/** Platform administrators, in the control plane. They are never tenant users. */
export interface SystemUserManagement {
  isImplemented(): boolean
  createSystemUser(ctx: ControlHandle, data: any): Promise<any>
  updateSystemUserById(ctx: ControlHandle, id: string, data: any): Promise<any | null>
  deleteSystemUser(ctx: ControlHandle, id: string): Promise<boolean>
  retrieveSystemUserById(ctx: ControlHandle, id: string): Promise<any | null>
  retrieveSystemUserByEmail(ctx: ControlHandle, email: string): Promise<any | null>
  retrieveSystemUserByExternalId(ctx: ControlHandle, externalId: string): Promise<any | null>
  retrieveSystemUserByPassword(ctx: ControlHandle, email: string, password: string): Promise<any | null>
  blockSystemUserById(ctx: ControlHandle, id: string, reason: string): Promise<any>
  unblockSystemUserById(ctx: ControlHandle, id: string): Promise<any>
  countQuery(ctx: ControlHandle, data: VQuery): Promise<number>
  findQuery(ctx: ControlHandle, data: VQuery): Promise<VFindResult<any>>
}

declare module 'fastify' {
  export interface FastifyRequest {
    user?: AuthenticatedUser
    token?: AuthenticatedToken
    startedAt?: Date
    data(): Data & VQuery
    parameters(): Data
    roles(): string[]
    hasRole(role: Role): boolean
    payloadSize?: number
    trackingData?: any
    /** The control plane. Present whenever a data layer is loaded. */
    control?: ControlHandle
    /** The container of this request's tenant. Absent on a single-tenant deployment. */
    tenant?: TenantHandle
    /** The registry row of this request's tenant. A record, never a connection. */
    tenantInfo?: Tenant
    /**
     * The platform administrator behind a control-scope request (T-4.1).
     *
     * Deliberately NOT `req.user`: a system user is not a tenant user, and one field holding
     * either would put the two identities back in the same slot, which is the shape the
     * whole phase exists to remove.
     */
    systemUser?: any
    /** What this request borrowed from the data layer, and gives back exactly once (T-3.1). */
    dataScope?: DataRequestScope
    /**
     * The live impersonation session behind this request, when the token carries `imp`
     * (T-4.2). Verified against the control plane on every request: a JWT that is still
     * cryptographically valid is not a session that is still allowed.
     */
    impersonation?: Impersonation
    /**
     * Reset token minted by `POST /auth/forgot-password`, handed to the
     * `global.postForgotPassword` middleware so the consumer can deliver it
     * (e.g. email a reset link). Set only when the account exists and is valid.
     * MUST NOT be serialized into the response: the endpoint answers a generic
     * `{ok:true}` to avoid account enumeration.
     */
    resetToken?: string
    /** Raw request body, populated by `fastify-raw-body` when enabled on the route. */
    rawBody?: string | Buffer
    /** Multipart helpers, populated by `@fastify/multipart`. */
    isMultipart(): boolean
    file(options?: any): Promise<any>
    files(options?: any): AsyncIterableIterator<any>
  }
  export interface FastifyReply {
    payloadSize?: number
  }
}

export interface FastifyRequest extends FastifyRequest {
  user?: AuthenticatedUser
  token?: AuthenticatedToken
  startedAt?: Date
  data(): Data & VQuery
  parameters(): Data
  roles(): string[]
  hasRole(role: Role): boolean
  payloadSize?: number
  trackingData?: any
  control?: ControlHandle
  tenant?: TenantHandle
  tenantInfo?: Tenant
  /** Reset token minted by `POST /auth/forgot-password` — see the `fastify` module augmentation above. */
  resetToken?: string
  /** Raw request body, populated by `fastify-raw-body` when enabled on the route. */
  rawBody?: string | Buffer
  /** Multipart helpers, populated by `@fastify/multipart`. */
  isMultipart(): boolean
  file(options?: any): Promise<any>
  files(options?: any): AsyncIterableIterator<any>
}

export interface FastifyReply extends FastifyReply {
  payloadSize?: number
}

export interface global {}

declare global {
  var log: any
  var server: any
  var config: GeneralConfig
  var transferConfig: TransferConfig
  var transferPath: string | null
  var roles: Roles
  /** The control-scope catalogue. Separate map, separate namespace (T-4.1). */
  var systemRoles: SystemRoles
  var tracking: TrackChangesList
  var trackingConfig: Data
  // `connection`, `entity` and `repository` were the v4 ambient globals of the data layer.
  // They are gone (T-3.3): a global connection is a context nobody declared, and reading it
  // is how a request served whatever the pool happened to hold (D-01, D-06). Whoever needs
  // the control plane receives a ControlHandle, whoever needs a tenant a TenantHandle, and
  // both arrive on the request.
  var routes: ConfiguredRoute[]
  var cache: any
}

export { global }
