/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-object-type */
import { FastifyRequest, FastifyReply } from 'fastify'
export { FastifyInstance } from 'fastify'
import { MfaPolicy } from '../lib/config/constants.js'
import { VQuery, VFindResult, VHeaders } from './orm.js'

export { MfaPolicy, VQuery, VFindResult, VHeaders }

export interface AuthenticatedUser {
  /**
   * The row's own identifier (T-6.1).
   *
   * v4 exposed `getId()`, an ORM entity method that had leaked into the framework's public
   * surface. v5 hands back plain rows, so the identifier is a field: the ORM is not part of
   * the API, and a data row that answers method calls is the ORM pretending otherwise. The
   * gap only showed end to end, where `req.user.getId()` was not a function and the failure
   * surfaced three layers away as an unexplained 401.
   */
  id: string
  username: string
  email: string
  roles: Role[]
  externalId: string
  mfaEnabled?: boolean
}

export interface AuthenticatedToken {
  /** The row's own identifier. See `AuthenticatedUser.id`: v5 hands back rows, not entities. */
  id: string
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
  | 'access-log'

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
  /**
   * The path the resource lives under, when it is not the first segment of the route (T-10.20).
   *
   * `/system/users` is a CRUD on the platform's operators, but its first segment is `system`,
   * which it shares with the platform login and the console manifest: grouped there, its six
   * methods never take the shape of a resource and the console has no operators screen. Declared
   * per route rather than per file, because one routes.ts can serve a resource and a handful of
   * paths that are not it.
   */
  prefix?: string
  titleField?: string | string[]
  subtitleField?: string | string[]
  globalSearch?: string[] // omni-search fields (OR)
}

// Structural hints (manifest L1) authored in routes.ts, grouped under `config.manifest`
// to keep them separate from the operational route config (Fastify schema, controller, …).
export interface ManifestHints {
  group?: string // sidebar group hint
  resource?: ResourceHints // resource-level hints (name, titleField, …)
  input?: ActionInputHints // per route: what the body schema of a custom action cannot say
}

/**
 * What a console's action dialog needs beyond the route's body schema (T-10.16).
 *
 * The fields, their types and the schema's `required` come from the schema itself; this adds only
 * presentation, and `required` for a field whose absence the controller refuses with its own code
 * (a schema `required` would answer first with a generic FST_ERR_VALIDATION).
 */
export interface ActionInputHints {
  /** Body properties the dialog does not ask for: filled by the console, or optional and noise. */
  exclude?: string[]
  fields?: Record<string, { widget?: string; label?: string; placeholder?: string; required?: boolean }>
  submitLabel?: string
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
  /** Reserved to the framework (T-12.17): a consumer's route that declares it stops the boot. */
  tenantFrom?: 'flow-state'
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
  /**
   * Which plane the route acts on: 'tenant' (the default) or 'control'.
   * Also accepted inside `config`, and on the file-level config as the default for the file.
   */
  scope?: 'tenant' | 'control'
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
  /**
   * Continuous replication of every container, through the port of T-7.3.
   *
   * `{ url: 's3://bucket/prefix' }` or any destination Litestream accepts. Declaring it and
   * not having the binary is fatal: a container the deployment believes is being copied and
   * is not is worse than one nobody promised to copy.
   */
  replica?: { url: string; binary?: string }
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
    // MFA Configs. The emergency reset of the admin's MFA is environment-only
    // (`MFA_ADMIN_FORCED_RESET_EMAIL`/`_UNTIL`): the two keys typed here until T-10.6 were
    // read by nobody, so setting them compiled and did nothing.
    mfa_policy?: MfaPolicy | string
    /**
     * The control plane's own policy, never weaker than `mfa_policy` (T-10.19). Absent means the
     * deployment value. A tenant declares its own in the `config` of its registry row.
     */
    system_mfa_policy?: MfaPolicy | string
    // Lifetime of a /auth/forgot-password reset token, in seconds (default 3600).
    reset_password_token_ttl?: number
    /** Seconds an impersonation session lasts (T-4.2). Default 1800, hard maximum 14400. */
    impersonation_ttl?: number
    /**
     * Who may create an account in a tenant (F49): `invite`, `approval`, `open`. `allowed` is a list
     * or a comma-separated string; `default` must be one of them. Refused at boot when it is not.
     */
    accountCreation?: { allowed: string[] | string; default: string }
    /** Where container exports are written (T-6.2). Configuration, never a request field. */
    export_directory?: string
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
    /**
     * The session registry and the rotation of refresh tokens (T-11.13).
     *
     * `enabled: false` gives back the stateless renewal of v4, where a refresh token cannot be
     * consumed and a logout only clears cookies. It is a decision a deployment can take, not a
     * default: without the block the registry is on wherever a data layer is injected.
     */
    sessions?: {
      enabled?: boolean
      /** Seconds without a renewal before the session ends. Default 2592000 (30 days). */
      idleTtl?: number
      /** Seconds a session may live however often it renews. Default 15552000 (180 days). */
      absoluteTtl?: number
      /** Seconds the just-rotated secret stays acceptable, for tabs renewing together. Default 10. */
      graceSeconds?: number
    }
    /**
     * The access log (F44). Each key has an environment variable that wins over it, so a
     * deployment can tighten retention or drop addresses without a release.
     */
    accessLog?: {
      /** `truncate` keeps an IPv4 /24 or an IPv6 /48, `none` stores no address. `ACCESS_LOG_IP`. */
      ip?: 'truncate' | 'none'
      /** Days a tenant-plane row is kept. Default 90. `ACCESS_LOG_RETENTION_DAYS`. */
      retentionDays?: number
      /** Days a control-plane row is kept. Default 180. `ACCESS_LOG_CONTROL_RETENTION_DAYS`. */
      controlRetentionDays?: number
    }
    // In-memory per-route response cache (opt-in per route via `cache`).
    cache?: {
      enabled?: boolean // master switch, opt-in: off unless exactly `true` (lib/util/cache.ts)
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
  /**
   * `false` when the route declared `scope: 'control'`, `true` otherwise. Derived by the router,
   * never authored (T-10.34).
   *
   * The name is the v4 spelling that the router REFUSES in an author's config
   * (lib/loader/router.ts), and it is kept here on purpose: this is the resolved boolean the
   * hooks, the cache and `dataContext` read from `routeOptions.config`, not the field a route
   * writes. Renaming it touches 46 places for no change in behaviour; confusing the two is the
   * only risk, and this comment is where that confusion ends.
   */
  tenantContext: boolean
  tenantFrom?: 'flow-state'
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
  input?: ActionInputHints // action input hint (manifest), per route only
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
  /** Whether the password has aged past `PASSWORD_EXPIRATION_DAYS`. Reads the row, asks nothing. */
  isPasswordToBeChanged(user: any): boolean

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
  /** Ends the wait of an account under `approval` (F49); false when it was not waiting. */
  approveUserById(ctx: DataHandle, id: string): Promise<boolean>

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

/**
 * The first phase of destroying a customer's data (T-6.3): a permission with a fuse.
 *
 * One tenant, one operator, ten minutes, one use. The token is never stored, only its hash:
 * the single copy went out in the response to phase 1.
 */
export interface DestructionRequest {
  id: string
  tenantId: string
  systemUserId: string
  tokenHash: string
  preview: Record<string, unknown>
  createdAt: Date | string
  expiresAt: Date | string
  consumedAt?: Date | string | null
  exportRef?: string | null
}

export interface DestructionManagement {
  isImplemented(): boolean
  openRequest(
    ctx: ControlHandle,
    data: { tenantId: string; systemUserId: string; token: string; preview: Record<string, unknown>; expiresAt: Date | string }
  ): Promise<DestructionRequest>
  /** Null for unknown, expired and already spent alike: none of the three is actionable. */
  findLiveRequest(ctx: ControlHandle, tenantId: string, token: string): Promise<DestructionRequest | null>
  /** Spends it, and records the export that had to succeed first. Called before the drop. */
  consumeRequest(ctx: ControlHandle, id: string, exportRef: string): Promise<DestructionRequest | null>
}

/** Which plane the subject of a session belongs to. */
export type SessionScope = 'tenant' | 'control'

/**
 * A live session (T-11.1, decisions F18 to F24 in EVO_FASE_11.md).
 *
 * One row per session, not per token: `sid` never changes, and what rotates at every renewal
 * is the secret, with `generation` counting the rotations. That is what makes "close this
 * device" and "close the family, a stolen token came back" the same operation.
 *
 * The secrets are deliberately absent from this type. Only their SHA-256 is written down, and
 * nothing outside the manager has any business reading even that.
 */
export interface Session {
  id: string
  sid: string
  /** The subject's `externalId`: the same value the access token carries in `sub`. */
  subjectId: string
  scope: SessionScope
  generation: number
  lastUsedAt: Date | string
  /** Moves forward at every renewal. */
  idleExpiresAt: Date | string
  /** Never moves: without it, a session renewed often enough would never end. */
  absoluteExpiresAt: Date | string
  rotatedAt?: Date | string | null
  revokedAt?: Date | string | null
  revokedReason?: string | null
  ip?: string | null
  userAgent?: string | null
  impersonationId?: string | null
  /** The methods the login satisfied (F45). Null for a session opened before the flow engine. */
  authMethods?: string[] | null
  createdAt: Date | string
}

/**
 * What a presented refresh secret turned out to be.
 *
 * `grace` is the generation just replaced, still inside the tolerance window: two browser tabs
 * renewing in the same instant present the same secret, and calling that a theft throws out
 * the user this whole mechanism exists to protect. `reused` is the same situation outside the
 * window, which nobody can explain innocently.
 */
export type SessionLookup =
  | { outcome: 'current'; session: Session }
  | { outcome: 'grace'; session: Session }
  | { outcome: 'reused'; session: Session }
  | { outcome: 'expired'; session: Session }
  | { outcome: 'revoked'; session: Session }
  | { outcome: 'unknown' }

/**
 * The registry of live sessions (T-11.1 → T-11.5).
 *
 * Every method takes a `DataHandle` because the session lives in the container of its subject
 * (F19): a tenant user's session in the tenant container, a platform identity's in the control
 * plane. The core never chooses that handle by itself, the caller does, exactly as for users.
 */
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
      authMethods?: string[] | null
    }
  ): Promise<Session>
  /** Classifies a presented secret. A malformed or unknown secret is an answer, not a throw. */
  findBySecret(ctx: DataHandle, secret: string, graceSeconds: number): Promise<SessionLookup>
  /**
   * Spends the current generation and writes the next one, moving `lastUsedAt` and the idle
   * clock. Null when the generation is no longer the current one, which is how two renewals
   * racing each other end with one winner instead of two live secrets.
   */
  rotate(
    ctx: DataHandle,
    sid: string,
    generation: number,
    next: { secret: string; idleExpiresAt: Date | string }
  ): Promise<Session | null>
  /** Idempotent: revoking an already revoked session is the same state, not an error. */
  revokeSession(ctx: DataHandle, sid: string, reason: string): Promise<boolean>
  /** Returns how many were closed. The blunt instrument that is not `externalId` (F26). */
  revokeAllOfSubject(ctx: DataHandle, subjectId: string, reason: string): Promise<number>
  listOfSubject(ctx: DataHandle, subjectId: string): Promise<Session[]>
  /** Removes rows no renewal can use any more. Called lazily and by the CLI (T-11.12). */
  purgeExpired(ctx: DataHandle, before?: Date | string): Promise<number>
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

// ---------------------------------------------------------------------------------------
// Composable authentication (EVO_FASE_12.md, F33 to F47)
//
// A login is a flow: one `identify` stage that says who the subject is, then the ordered stages
// of the first flow whose roles meet the subject's. Every method is an `Authenticator`; the
// engine is the only caller, and it is the one that writes the flow row, counts attempts and
// issues the session. An authenticator reads the flow and answers.
// ---------------------------------------------------------------------------------------

/** The two planes a flow runs on: the users of a tenant, and the platform's own identities. */
export type AuthPlane = 'tenant' | 'control'

/** An identifier establishes who the subject is; a verifier proves something more about a known one. */
export type AuthenticatorKind = 'identifier' | 'verifier'

/** A refusal is always a code, never a sentence: the console translates, the backend does not. */
export type AuthRefusalCode = Uppercase<string>

/** The subject as the engine sees it, the same shape on both planes. */
export interface AuthSubject {
  /** The row's own identifier. */
  id: string
  /** What the session and the access token carry in `sub`. */
  externalId: string
  email: string
  /** Role codes: the tenant catalogue on the tenant plane, `system:*` codes on the control plane. */
  roles: readonly string[]
  /** The ids of the methods this subject has enrolled, e.g. `['totp']`. */
  factors: readonly string[]
  confirmed: boolean
  blocked: boolean
}

export type ChallengeChannel = 'email' | 'sms'

/** A code sent somewhere. The destination is masked (`d***@a***.com`) and derived by the server. */
export interface ChallengeDescriptor {
  channel: ChallengeChannel
  destination: string
  expiresAt: string
  /** When the next send is allowed; null when the sends of this flow are spent. */
  resendAt: string | null
}

/** What a subject needs to configure an authenticator app during an in-flow enrolment. */
export interface EnrolmentSetup {
  secret: string
  uri: string
  qrCode?: string
}

/** Where the browser goes next for a method that leaves the site, as a link or as a posted form. */
export type AuthAction =
  | { type: 'redirect'; url: string }
  | { type: 'post'; url: string; fields: Readonly<Record<string, string>> }

/** One method a stage offers. Codes and identifiers only: labels belong to the console. */
export interface StageOption {
  id: string
  kind: AuthenticatorKind
  challenge?: ChallengeDescriptor
  /** `true` when the stage demands an enrolment; the setup once the enrolment has started. */
  enrol?: boolean | EnrolmentSetup
  action?: AuthAction
}

/** The stage a partial authentication (202) is waiting on. */
export interface StageDescriptor {
  options: readonly StageOption[]
}

/**
 * What an authenticator answers.
 *
 * `satisfied` on a success names the methods it proves besides its own: an OIDC login whose
 * provider is trusted for its second factor also satisfies `idp-mfa`. `pending` is an external
 * round trip that has not come back yet. `external`, on the success of a `complete`, is what the
 * engine writes into the flow for the next step to cash: a return never issues a session.
 */
export type AuthResult =
  | { outcome: 'success'; subject?: AuthSubject; satisfied?: readonly string[]; external?: ExternalAuthResult }
  | { outcome: 'challenge'; challenge: ChallengeDescriptor }
  | { outcome: 'redirect'; binding: 'redirect'; url: string }
  | { outcome: 'redirect'; binding: 'post'; url: string; fields: Readonly<Record<string, string>> }
  | { outcome: 'pending' }
  | {
      outcome: 'fail'
      reason: AuthRefusalCode
      /**
       * The flow survives this failure: a wrong code with attempts left, a code that expired, a send
       * over a ceiling. Without it a failure before the subject is proven ends the flow.
       */
      recoverable?: boolean
      /** Attempts left on the flow, when the method counted this one itself. */
      remaining?: number
      /** When a refused send may be asked for again. */
      retryAt?: Date | string | null
    }

/** The fields a step carries, as the client sent them. Credentials never leave this object. */
export type AuthInput = Readonly<Record<string, unknown>>

/** The input of a return from outside (a GET query or a posted form), already flattened. */
export type AuthReturnInput = Readonly<Record<string, string>>

/** The managers an authenticator may call, named as they are decorated on the server. */
export interface AuthManagers {
  readonly userManager: UserManagement
  readonly systemUserManager: SystemUserManagement
  readonly mfaManager: MfaManagement
  readonly sessionManager: SessionManagement
  readonly authFlowManager: AuthFlowManagement
  readonly externalIdentityManager: ExternalIdentityManagement
  readonly identityProviderManager: IdentityProviderManagement
  readonly challengeDeliveryManager: ChallengeDeliveryManagement
  readonly accessLogManager: AccessLogManagement
  readonly settingManager: SettingManagement
}

/**
 * The code operations of the flow of this request, bound by the engine to its credential. An
 * authenticator sends and checks codes through these, and never sees the flow secret that keys them.
 */
export interface FlowChallenges {
  /** Stores the code as an HMAC keyed by the flow secret, under the flow's and the subject's ceilings. */
  record(data: { method: string; code: string; expiresAt: Date; limits: ChallengeLimits }): Promise<ChallengeRecord>
  /** One conditional statement: a right code is good once, a wrong one spends an attempt. */
  consume(code: string): Promise<ChallengeConsumption>
  /** Names the subject an unproven flow sends to, so its sends count against that subject (F37). */
  nominate(subjectId: string): Promise<boolean>
}

/**
 * The round trip of a method that leaves the request (F39), bound by the engine to its flow. The
 * authenticator hands what the return will need; the engine keeps it encrypted in the row and
 * answers the `state` to send, built with the routing the authenticator never sees.
 */
export interface FlowRoundTrip {
  begin(external: AuthFlowExternal): Promise<string | null>
}

/** A provider ready for a login (F38): its settings, where they came from, and its secret if any. */
export interface ResolvedIdentityProvider {
  key: string
  type: IdentityProviderType
  source: 'deployment' | 'tenant'
  settings: OidcProviderSettings
  clientSecret: string | null
}

/** Everything an authenticator is told. Nothing implicit: the handle is explicit, as for managers. */
export interface AuthContext {
  readonly plane: AuthPlane
  readonly handle: DataHandle
  /** The registry row on a multi-tenant tenant plane; null on the control plane and in single tenant. */
  readonly tenant: Tenant | null
  /** Known once the identify stage has passed. */
  readonly subject: AuthSubject | null
  /** The effective policy of this plane and tenant, the floor already applied. */
  readonly policy: MfaPolicy
  readonly managers: AuthManagers
  readonly flow: Readonly<AuthFlow> | null
  /** The limits of the deployment (F37), the environment already applied. */
  readonly limits: Readonly<AuthFlowLimits>
  /** Null without a flow row, or where the request presented no credential for it. */
  readonly challenges: FlowChallenges | null
  /**
   * Who may create an account here (F49), read when it is needed: the just-in-time provisioning
   * of a provider asks it. Absent, the most closed mode applies.
   */
  readonly accountCreation?: () => Promise<'invite' | 'approval' | 'open'>
  /** The provider this plane and tenant log in with under `key`, or null when there is none. */
  readonly provider?: (key: string) => Promise<ResolvedIdentityProvider | null>
  /** Null outside a flow row. */
  readonly roundTrip?: FlowRoundTrip | null
  /** Writes an access of this flow; best effort, as the engine's own. */
  readonly record?: (entry: Omit<AccessLogEntry, 'scope' | 'flowId'>) => Promise<void>
}

/**
 * One authentication method (T-12.2).
 *
 * `initiate` starts what cannot finish in one request: it sends a code, or answers with the
 * address of an external provider. `complete` receives the return from that provider, which
 * arrives without the flow credential and is bound to the flow by its `state`. A method that has
 * neither closes in the request that calls `verify`.
 */
export interface Authenticator {
  readonly id: string
  /** Both, for a method that plays either role: `email-otp` identifies, or verifies a known subject. */
  readonly kind: AuthenticatorKind | readonly AuthenticatorKind[]
  readonly planes: readonly AuthPlane[]
  initiate?(ctx: AuthContext, input: AuthInput): Promise<AuthResult>
  verify(ctx: AuthContext, input: AuthInput): Promise<AuthResult>
  complete?(ctx: AuthContext, input: AuthReturnInput): Promise<AuthResult>
  /** The return parameter that carries the flow `state` (`st1.<routing>.<secret>`). Default `state`. */
  readonly stateParam?: string
  /** Whether an optional stage applies to this subject. */
  isEnrolled?(ctx: AuthContext, subject: AuthSubject): boolean | Promise<boolean>
  /** Starts an in-flow enrolment; the engine keeps the secret in the flow row, never on the client. */
  enrol?(ctx: AuthContext, subject: AuthSubject): Promise<EnrolmentSetup>
}

/** The authenticators of both planes (T-12.3). Built-ins first, then a consumer's, replacing by `id`. */
export interface AuthenticatorRegistry {
  register(authenticator: Authenticator): void
  get(plane: AuthPlane, id: string): Authenticator | undefined
  list(plane: AuthPlane): Authenticator[]
}

/** The settings of an OIDC provider that are not secret. */
export interface OidcProviderSettings {
  issuer: string
  clientId: string
  /** Explicit, never derived from the `Host` header. */
  redirectUri: string
  scopes?: string[]
  tokenAuthMethod?: 'client_secret_basic' | 'client_secret_post'
  /** Link an existing account by email: needs `email_verified` and a domain in `emailDomains`. */
  linkByEmail?: boolean
  emailDomains?: string[]
  /** Just-in-time provisioning, tenant plane only. The roles never include `admin`. */
  jit?: { enabled: boolean; roles: string[] }
  /** Whether the provider's own second factor counts (`idp-mfa`). Absent: it does not. */
  mfa?: { trust: 'amr' | 'acr'; values: string[] }
}

/** One stage: `anyOf` is the OR, the list of stages is the AND. */
export interface AuthStage {
  anyOf: string[]
  /** Applies only to a subject already enrolled in one of its methods. */
  optional?: boolean
}

/** Chosen after identification: the first whose roles meet the subject's. `'*'` is last. */
export interface AuthFlowDefinition {
  roles: string[]
  /** The identifiers this flow accepts; absent means every one of `identify`. */
  identifiers?: string[]
  stages: AuthStage[]
}

/** A provider declared by the deployment in `authFlows.ts`. The secret is a variable name, never a value. */
export interface DeploymentProvider extends OidcProviderSettings {
  type: 'oidc'
  clientSecretEnv: string
}

/** The flows of one plane. A project's block replaces the framework's whole, never merged. */
export interface AuthPlaneFlows {
  identify: string[]
  flows: AuthFlowDefinition[]
  /** Where a return from an external provider sends the browser back to. */
  returnUrl?: string
  providers?: Record<string, DeploymentProvider>
}

/** Seconds and counts. The environment wins over the file (`AUTH_FLOW_TTL`, `AUTH_OTP_*`). */
export interface AuthFlowLimits {
  /** Absolute lifetime of a flow. Never extended. */
  flowTtl: number
  /** Lifetime of one sent code. */
  otpTtl: number
  /** Wrong codes before the flow dies. */
  otpMaxAttempts: number
  /** Sends within one flow. */
  otpMaxSends: number
}

/** `config/authFlows.ts` as written by a project: every key optional. */
export interface AuthFlowsConfig {
  tenant?: AuthPlaneFlows
  control?: AuthPlaneFlows
  limits?: Partial<AuthFlowLimits>
}

/** What the loader leaves on `global.authFlows`: both planes, every limit, frozen. */
export interface ResolvedAuthFlows {
  readonly tenant: AuthPlaneFlows
  readonly control: AuthPlaneFlows
  readonly limits: Readonly<AuthFlowLimits>
}

/** What a flow holds from outside: decrypted by the manager, never written in clear. */
export interface AuthFlowExternal {
  provider?: string
  codeVerifier?: string
  nonce?: string
  /** A path of the client to land on after the return, never a URL: only a path is kept. */
  returnTo?: string
  /** The TOTP secret of an in-flow enrolment, until the code confirms it. */
  enrolmentSecret?: string
}

/** The validated claims a return from a provider left in the flow, to be cashed by the next step. */
export interface ExternalAuthResult {
  provider: string
  issuer: string
  subject: string
  email?: string | null
  emailVerified?: boolean
  amr?: string[]
  acr?: string | null
}

/**
 * What a failed return left in the flow (F39): the refusal the next step answers with. The return
 * is a navigation that can carry no answer the console reads, so the answer waits in the row for
 * the one request that can: the step made with the flow credential.
 */
export interface ExternalAuthFailure {
  method: string
  code: AuthRefusalCode
}

/**
 * A flow row (F37). The hashes of the flow secret, of the code and of `state` are deliberately
 * absent, as the secrets are from `Session`.
 */
export interface AuthFlow {
  id: string
  flowId: string
  scope: SessionScope
  /** Null until the subject is proven: only a proven flow holds the subject's slot. */
  subjectId: string | null
  /** The subject an unproven flow sends codes to, so its sends are counted. */
  candidateSubjectId: string | null
  flowName: string | null
  stageIndex: number
  satisfied: string[]
  challengeMethod: string | null
  challengeExpiresAt: Date | string | null
  challengeAttempts: number
  challengeSends: number
  lastSentAt: Date | string | null
  external: AuthFlowExternal | null
  externalResult: ExternalAuthResult | null
  /** Set by a failed return; the next step ends the flow with its code. */
  externalFailure?: ExternalAuthFailure | null
  version: number
  ip?: string | null
  userAgent?: string | null
  createdAt: Date | string
  expiresAt: Date | string
}

export type AuthFlowLookup =
  | { outcome: 'current'; flow: AuthFlow }
  | { outcome: 'expired'; flow: AuthFlow }
  | { outcome: 'unknown' }

/** The ceilings of one send: per flow, and per subject across every flow in each window. */
export interface ChallengeLimits {
  perFlow: number
  perSubject: ReadonlyArray<{ max: number; windowSeconds: number }>
}

export type ChallengeRecord =
  | { outcome: 'sent'; sends: number; resendAt: Date | string | null }
  | { outcome: 'limit'; scope: 'flow' | 'subject'; retryAt: Date | string | null }

/** One verification reserved against the flow's ceiling before it runs, so parallel guesses cannot exceed it. */
export type AttemptRecord = { outcome: 'counted'; remaining: number } | { outcome: 'exhausted' }

export type ChallengeConsumption =
  | { outcome: 'ok' }
  | { outcome: 'invalid'; remaining: number }
  | { outcome: 'exhausted' }
  | { outcome: 'expired' }

/**
 * The flow store (F37, T-12.12). The row lives in the container of its subject, like `session`.
 * Every change is one conditional statement: a read followed by a write would let two steps
 * racing each other both win.
 */
export interface AuthFlowManagement {
  isImplemented(): boolean
  /** A proven subject evicts its previous flow in the same statement. The clear secret is hashed. */
  openFlow(
    ctx: DataHandle,
    data: {
      flowId: string
      scope: SessionScope
      secret: string
      subjectId?: string | null
      candidateSubjectId?: string | null
      flowName?: string | null
      expiresAt: Date | string
      ip?: string | null
      userAgent?: string | null
    }
  ): Promise<AuthFlow>
  /** A malformed or unknown secret is an answer, not a throw. */
  findBySecret(ctx: DataHandle, flowId: string, secret: string): Promise<AuthFlowLookup>
  findByState(ctx: DataHandle, state: string): Promise<AuthFlow | null>
  /** Optimistic on `version`: null when another step moved the flow first. */
  advance(
    ctx: DataHandle,
    flowId: string,
    version: number,
    patch: {
      subjectId?: string | null
      candidateSubjectId?: string | null
      flowName?: string | null
      stageIndex?: number
      satisfied?: string[]
    }
  ): Promise<AuthFlow | null>
  /** Stores the code as an HMAC keyed by the flow secret, and applies both ceilings atomically. */
  recordChallenge(
    ctx: DataHandle,
    flowId: string,
    data: { secret: string; method: string; code: string; expiresAt: Date | string; limits: ChallengeLimits }
  ): Promise<ChallengeRecord>
  /** One conditional `UPDATE`: two concurrent submissions of the right code have one winner. */
  consumeChallenge(
    ctx: DataHandle,
    flowId: string,
    data: { secret: string; code: string; maxAttempts: number }
  ): Promise<ChallengeConsumption>
  /**
   * Counts one verification of a method the store does not check itself (a TOTP code): one
   * conditional `UPDATE` on the same counter as `consumeChallenge`, run before the code is tested.
   */
  recordAttempt(ctx: DataHandle, flowId: string, data: { secret: string; maxAttempts: number }): Promise<AttemptRecord>
  bindExternal(ctx: DataHandle, flowId: string, data: { state?: string | null; external: AuthFlowExternal }): Promise<boolean>
  recordExternalResult(ctx: DataHandle, flowId: string, result: ExternalAuthResult): Promise<boolean>
  /** Written once, like a result, and it spends `state` the same way: a return answers once. */
  recordExternalFailure(ctx: DataHandle, flowId: string, failure: ExternalAuthFailure): Promise<boolean>
  completeFlow(ctx: DataHandle, flowId: string): Promise<boolean>
  cancelFlow(ctx: DataHandle, flowId: string): Promise<boolean>
  purgeExpired(ctx: DataHandle, before?: Date | string): Promise<number>
}

/** A link between an identity at a provider and a subject (F40). Unique on the four keys, never on the email. */
export interface ExternalIdentity {
  id: string
  scope: SessionScope
  /** The subject's `externalId`, as `session.subjectId`. */
  subjectId: string
  provider: string
  issuer: string
  subject: string
  emailAtLink?: string | null
  createdAt: Date | string
  lastUsedAt?: Date | string | null
}

export interface ExternalIdentityKey {
  scope: SessionScope
  provider: string
  issuer: string
  subject: string
}

export interface ExternalIdentityManagement {
  isImplemented(): boolean
  findLink(ctx: DataHandle, key: ExternalIdentityKey): Promise<ExternalIdentity | null>
  createLink(ctx: DataHandle, data: ExternalIdentityKey & { subjectId: string; emailAtLink?: string | null }): Promise<ExternalIdentity>
  listOfSubject(ctx: DataHandle, subjectId: string, scope: SessionScope): Promise<ExternalIdentity[]>
  /** Removes the link only when it belongs to `subjectId`. */
  removeLink(ctx: DataHandle, id: string, subjectId: string): Promise<boolean>
  touch(ctx: DataHandle, id: string): Promise<boolean>
}

/** Settings of a container, one JSON value per key (F49). Never a secret. */
export interface SettingManagement {
  isImplemented(): boolean
  /** The stored value, or null when the key was never written. */
  get(ctx: DataHandle, key: string): Promise<unknown>
  set(ctx: DataHandle, key: string, value: unknown, updatedBy?: string | null): Promise<void>
  remove(ctx: DataHandle, key: string): Promise<boolean>
}

export type IdentityProviderType = 'oidc'

/** A tenant's own provider, in the control plane registry (F38). Never in `tenant.config`. */
export interface IdentityProvider {
  id: string
  tenantId: string
  key: string
  type: IdentityProviderType
  status: 'active' | 'disabled'
  config: OidcProviderSettings
  createdAt: Date | string
  updatedAt: Date | string
}

/** What only `get` returns: the client secret, decrypted by the data layer. */
export interface IdentityProviderWithSecret extends IdentityProvider {
  clientSecret: string | null
}

export interface IdentityProviderManagement {
  isImplemented(): boolean
  list(ctx: ControlHandle, tenantId: string): Promise<IdentityProvider[]>
  get(ctx: ControlHandle, tenantId: string, key: string): Promise<IdentityProviderWithSecret | null>
  create(
    ctx: ControlHandle,
    data: {
      tenantId: string
      key: string
      type: IdentityProviderType
      status?: 'active' | 'disabled'
      config: OidcProviderSettings
      clientSecret?: string | null
    }
  ): Promise<IdentityProvider>
  update(
    ctx: ControlHandle,
    tenantId: string,
    key: string,
    patch: { status?: 'active' | 'disabled'; config?: OidcProviderSettings; clientSecret?: string | null }
  ): Promise<IdentityProvider | null>
  remove(ctx: ControlHandle, tenantId: string, key: string): Promise<boolean>
  /** Every provider of the tenant, with its secret; answers how many rows went. */
  removeAll(ctx: ControlHandle, tenantId: string): Promise<number>
}

export type ChallengePurpose = 'identify' | 'verify'

/**
 * One code to deliver (F43). The consumer composes subject and text: the backend hands over data,
 * not presentation. `to` is always the address on file, never one taken from a request body.
 */
export interface ChallengeDelivery {
  channel: ChallengeChannel
  to: string
  code: string
  purpose: ChallengePurpose
  expiresAt: Date | string
  plane: AuthPlane
  tenantId: string | null
  subjectId: string
  locale?: string | null
}

export interface ChallengeDeliveryManagement {
  isImplemented(): boolean
  deliver(message: ChallengeDelivery): Promise<void>
}

/** The closed vocabulary of the access log (F44). A successful renewal is deliberately not an event. */
export type AccessEvent =
  | 'login.succeeded'
  | 'login.failed'
  | 'flow.started'
  | 'stage.passed'
  | 'stage.failed'
  | 'challenge.sent'
  | 'challenge.refused'
  | 'flow.expired'
  | 'flow.exhausted'
  | 'idp.linked'
  | 'idp.unlinked'
  | 'idp.provisioned'
  | 'idp.rejected'
  | 'account.pending'
  | 'account.approved'
  | 'mfa.enrolled'
  | 'mfa.disabled'
  | 'logout'
  | 'session.revoked'
  | 'session.reuse_detected'
  | 'tokens.invalidated'

/** One access, as written. Never a password, a code, a secret, a token or a claim. */
export interface AccessLogEntry {
  event: AccessEvent
  outcome: 'success' | 'failure'
  scope: SessionScope
  code?: string | null
  /** The subject's `externalId`; null when the subject is not known. */
  subjectId?: string | null
  methods?: string[]
  provider?: string | null
  flowId?: string | null
  sid?: string | null
  /** Truncated by the manager (/24, /48), or dropped with `ACCESS_LOG_IP=none`. */
  ip?: string | null
}

export interface AccessLogRecord extends AccessLogEntry {
  id: string
  occurredAt: Date | string
}

export interface AccessLogManagement {
  isImplemented(): boolean
  /** Refuses an event outside the vocabulary. */
  record(ctx: DataHandle, entry: AccessLogEntry): Promise<AccessLogRecord>
  /**
   * `scope` is a condition the query cannot relax, `_logic` included: without tenants both planes
   * write into the same container, and each reads only its own rows.
   */
  findQuery(ctx: DataHandle, query: VQuery, scope?: SessionScope): Promise<VFindResult<AccessLogRecord>>
  countQuery(ctx: DataHandle, query: VQuery, scope?: SessionScope): Promise<number>
  /** Rows older than `before`, of one scope or of both. */
  purgeBefore(ctx: DataHandle, before: Date | string, scope?: SessionScope): Promise<number>
  /** Rows past the retention of their own scope (90 and 180 days by default), in one statement. */
  purgeExpired(ctx: DataHandle, now?: Date): Promise<number>
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

  // The second factor of tenant destruction (T-6.3). See docs/SCHEMA_V5.md §3.2.
  saveMfaSecret(ctx: ControlHandle, userId: string, secret: string): Promise<boolean>
  retrieveMfaSecret(ctx: ControlHandle, userId: string): Promise<string | null>
  enableMfa(ctx: ControlHandle, userId: string): Promise<boolean>
  disableMfa(ctx: ControlHandle, userId: string): Promise<boolean>
  recordMfaCounter(ctx: ControlHandle, userId: string, counter: number): Promise<boolean>
  countQuery(ctx: ControlHandle, data: VQuery): Promise<number>
  findQuery(ctx: ControlHandle, data: VQuery): Promise<VFindResult<any>>
}

declare module 'fastify' {
  export interface FastifyRequest {
    user?: AuthenticatedUser
    token?: AuthenticatedToken
    startedAt?: Date
    /** Query string and body merged, the body winning on a shared key (defect D-29). */
    data(): Data & VQuery
    /** Only the query string. */
    queryData(): Data & VQuery
    /** Only the body. */
    bodyData(): Data & VQuery
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
    /**
     * Confirmation token minted by `POST /auth/register` for the account it created, handed to the
     * `global.postAuth` middleware so the consumer can deliver it (e.g. email a confirmation link
     * that calls `POST /auth/confirm-email`). Unset when the address was already registered, so a
     * consumer that delivers it before answering makes the two registrations differ in latency:
     * deliver after the response. MUST NOT be serialized into the response.
     */
    confirmationToken?: string
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
  /**
   * What the ROUTER writes onto a route's config, which is not what an author writes in the route
   * file: `scope: 'control'` becomes `tenantContext: false` (lib/loader/router.ts), and the roles
   * a route requires are threaded as objects rather than codes.
   *
   * The hooks read these on every request and read them off an untyped object until now, so a
   * renamed field would have been found by a failing request and not by the compiler (F7).
   */
  export interface FastifyContextConfig {
    tenantContext?: boolean
    /** Reserved to the framework's return routes: the tenant is read from the flow `state` (T-12.17). */
    tenantFrom?: 'flow-state'
    requiredRoles?: Role[]
    /** The route's own method and path, threaded by the router so a refusal can name them. */
    method?: string
    url?: string
    scope?: 'tenant' | 'control'
    tracking?: { strict?: boolean }
    cache?: NormalizedRouteCache
  }
  /**
   * The managers a consumer injects through `start(decorators)`, declared where Fastify can see
   * them (F7, the `noImplicitAny` work).
   *
   * They were reached as `req.server['userManager']` and typed as nothing: a string index on an
   * instance that declares no such property, which is an implicit `any` in the one place where a
   * wrong call is most expensive. Declaring them here types every call site at once, without
   * touching a single one of them, and turns a contract that lived in `index.ts` and in the
   * documentation into something the compiler checks.
   *
   * None of them is optional, and that is the honest shape: `start()` decorates every one before
   * the server accepts a request, with the no-op defaults where a consumer injected nothing. A
   * build without a data layer therefore has all of them; what it does not have is an implementation,
   * and asking one of those is an error that says so. Declaring them optional would put a
   * `possibly undefined` on hundreds of call sites to describe a state that never happens.
   */
  export interface FastifyInstance {
    userManager: UserManagement
    tokenManager: TokenManagement
    trackingManager: TrackingManagement
    tenantManager: TenantManagement
    systemUserManager: SystemUserManagement
    impersonationManager: ImpersonationManagement
    destructionManager: DestructionManagement
    sessionManager: SessionManagement
    mfaManager: MfaManagement
    transferManager: TransferManagement
    authFlowManager: AuthFlowManagement
    externalIdentityManager: ExternalIdentityManagement
    identityProviderManager: IdentityProviderManagement
    challengeDeliveryManager: ChallengeDeliveryManagement
    accessLogManager: AccessLogManagement
    settingManager: SettingManagement
    /** Not a manager: the authenticators of both planes, built by `start()` (T-12.3). */
    authRegistry: AuthenticatorRegistry
  }
}

export interface FastifyRequest extends FastifyRequest {
  user?: AuthenticatedUser
  token?: AuthenticatedToken
  startedAt?: Date
  data(): Data & VQuery
  queryData(): Data & VQuery
  bodyData(): Data & VQuery
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
  /** Confirmation token minted by `POST /auth/register`: see the `fastify` module augmentation above. */
  confirmationToken?: string
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
  /** The flows of both planes (`config/authFlows.ts`), frozen, read by the manifest and the engine. */
  var authFlows: ResolvedAuthFlows
  /**
   * The i18n instance loaded at boot (`lib/loader/translation.ts`).
   *
   * It was used as `global.t` in several places and declared nowhere, so every one of those was
   * an implicit any on a global (F7).
   */
  var t: any
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
