/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-object-type */
import { FastifyRequest, FastifyReply } from 'fastify'
export { FastifyInstance } from 'fastify'
import { EntityManager } from 'typeorm'
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
    // Multi-Tenant Configs
    multi_tenant?: {
      enabled: boolean
      resolver?: 'subdomain' | 'header' | 'query'
      header_key?: string
      query_key?: string
    }
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

export interface UserManagement {
  isImplemented(): boolean
  isValidUser(data: any): boolean
  createUser(data: any): any | null
  deleteUser(data: any): any | null
  resetExternalId(data: any): any | null
  updateUserById(id: string, user: any): any | null
  retrieveUserById(id: string): any | null
  retrieveUserByEmail(email: string): any | null
  retrieveUserByResetPasswordToken(code: string): any | null
  retrieveUserByConfirmationToken(code: string): any | null
  retrieveUserByUsername(username: string): any | null
  retrieveUserByExternalId(externalId: string): any | null
  retrieveUserByPassword(email: string, password: string): any | null
  changePassword(email: string, password: string, oldPassword: string): any | null
  /** Mints a reset token carrying its own `<epochSeconds>.` expiry prefix. */
  forgotPassword(email: string, runner?: any, ttlSeconds?: number): any | null
  resetPassword(user: any, password: string): any | null
  userConfirmation(user: any)
  blockUserById(id: string, reason: string): any | null
  unblockUserById(id: string): any | null
  countQuery(data: VQuery): any | null
  findQuery(data: VQuery): VFindResult<any> | null
  disableUserById(id: string): any | null

  // MFA Persistence Methods
  saveMfaSecret(userId: string, secret: string): Promise<boolean>
  retrieveMfaSecret(userId: string): Promise<string | null>
  enableMfa(userId: string): Promise<boolean>
  disableMfa(userId: string): Promise<boolean>

  // Emergency Reset
  forceDisableMfaForAdmin(email: string): Promise<boolean>
}

export interface TokenManagement {
  isImplemented(): boolean
  isValidToken(data: any): boolean
  createToken(data: any): any | null
  resetExternalId(id: string): any | null
  updateTokenById(id: string, token: any): any | null
  retrieveTokenById(id: string): any | null
  retrieveTokenByExternalId(id: string): any | null
  blockTokenById(id: string, reason: string): any | null
  unblockTokenById(id: string): any | null
  countQuery(data: VQuery): any | null
  findQuery(data: VQuery): VFindResult<any> | null
  removeTokenById(id: string): any | null
}

export interface DataBaseManagement {
  isImplemented(): boolean
  synchronizeSchemas(): any | null
  retrieveBy(entityName, entityId): any | null
  addChange(entityName, entityId, status, userId, contents, changeEntity): any | null
}

export interface MfaManagement {
  generateSetup(appName: string, email: string): Promise<{ secret: string; uri: string; qrCode: string }>
  // Returns the matched time-step delta (integer) when valid, or null when invalid.
  // The delta enables anti-replay protection (track the consumed step). Legacy managers returning a
  // boolean are still tolerated at runtime (treated as valid/invalid without replay tracking).
  verify(token: string, secret: string): number | null
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

export interface TenantManagement {
  isImplemented(): boolean
  resolveTenant(req: FastifyRequest): Promise<any | null>
  switchContext(tenant: any, db?: EntityManager): Promise<void>
  createTenant?(data: any): Promise<void>
  deleteTenant?(id: string): Promise<void>
  listTenants?(): Promise<any[]>
  getTenant?(id: string): Promise<any | null>
  updateTenant?(id: string, data: any): Promise<any | null>
  restoreTenant?(id: string): Promise<any | null>
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
    runner?: any
    tenant?: any
    /**
     * The Tenant-Aware EntityManager for this request.
     * MUST be used for all DB operations within this request scope.
     */
    db?: EntityManager
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
  runner?: any
  tenant?: any
  /**
   * The Tenant-Aware EntityManager for this request.
   * MUST be used for all DB operations within this request scope.
   */
  db?: EntityManager
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
