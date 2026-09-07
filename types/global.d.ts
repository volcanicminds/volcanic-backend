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
  /** 'tenant' (default) or 'control': which plane the route acts on. */
  scope?: 'tenant' | 'control'
  /** @deprecated the v4 spelling of `scope`; `scope: 'control'` is `tenantContext: false`. */
  tenantContext?: boolean
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

export interface JobSchedule {
  active: boolean // boolean (required)
  type?: string // cron|interval, default: interval
  async?: boolean // boolean, default: true
  preventOverrun?: boolean // boolean, default: true

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
  entity: string
  changeEntity: string
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
  retrieveBy(ctx: DataHandle, entityName: string, entityId: string): Promise<any>
  addChange(ctx: DataHandle, change: any): Promise<any>
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
  var tracking: TrackChangesList
  var trackingConfig: Data
  var connection: any
  var entity: any
  var repository: any
  var routes: ConfiguredRoute[]
  var cache: any
}

export { global }
