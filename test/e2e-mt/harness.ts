/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Multi-tenant E2E harness. Boots the real Fastify app with multi_tenant ENABLED
// on top of an embedded PGlite database (full Postgres → real schema isolation).
//
// Multi-tenancy is read from `global.config.options.multi_tenant` at loader time
// (lib/loader/tenant.ts), and start() only runs preload() when global.config is
// unset — so we populate config/roles/translation OURSELVES before booting, with
// the flag flipped on. This must run in its OWN mocha process (separate npm
// script) since it owns the singletons global.config/server/connection and the
// shared PGlite instance.
//
import * as loaderConfig from '../../lib/loader/general.js'
import * as loaderRoles from '../../lib/loader/roles.js'
import * as loaderTranslation from '../../lib/loader/translation.js'
import { start as startServer } from '../../index.js'
import { start as startDatabase, closeEmbedded, TenantManager, userManager } from '../../typeorm.js'
import { UserSchema, UserClass } from '../e2e/userEntity.js'
import { TenantSchema } from './tenantEntity.js'

export const HEADER = 'x-tenant-id'

// Two isolated tenants, each with its own admin seeded into its own schema.
export const ACME = {
  slug: 'acme',
  dbSchema: 'tenant_acme',
  adminEmail: 'admin@acme.test',
  adminPassword: 'Acme-pw-123456'
}
export const GLOBEX = {
  slug: 'globex',
  dbSchema: 'tenant_globex',
  adminEmail: 'admin@globex.test',
  adminPassword: 'Globex-pw-12345'
}

let ds: any
let server: any
let tm: any

export async function setup() {
  if (server) return server

  // Populate the globals start() would otherwise build via preload(), but with
  // multi-tenant turned on BEFORE the tenant loader reads it.
  const cfg = await loaderConfig.load()
  ;(cfg.options as any).multi_tenant = {
    enabled: true,
    resolver: 'header',
    header_key: HEADER,
    query_key: 'tid'
  }
  ;(global as any).config = cfg
  ;(global as any).roles = await loaderRoles.load()
  ;(global as any).t = loaderTranslation.load()

  ds = await startDatabase({
    type: 'pglite',
    synchronize: false,
    logging: false,
    entities: [UserSchema, TenantSchema]
  })
  await ds.synchronize() // public schema: Tenant registry (+ User table, unused there)
  ;(global as any).entity = { User: UserClass }

  // Inject the real TypeORM managers (the app's defaults are "Not implemented"
  // null-objects); the TenantManager resolves/creates tenant schemas on the live DS.
  server = await startServer({ userManager, tenantManager: new TenantManager(ds) })
  await server.ready()

  // Provision the two tenant schemas (each seeds its own admin in its own schema).
  tm = server['tenantManager']
  await tm.createTenant(ACME)
  await tm.createTenant(GLOBEX)

  // createTenant seeds the tenant admin UNCONFIRMED (it expects the email-confirm
  // flow). Confirm them directly so they can log in. Schema-qualified UPDATEs are
  // independent of the current search_path. (Table is `user_class`: the UserSchema
  // target class drives the table name.)
  await ds.query(`UPDATE ${ACME.dbSchema}.user_class SET confirmed = true`)
  await ds.query(`UPDATE ${GLOBEX.dbSchema}.user_class SET confirmed = true`)

  // createTenant syncs each tenant schema through an ephemeral DataSource. On the
  // embedded PGlite engine every DataSource shares ONE connection, so that sync
  // leaves the shared connection's search_path pointing at the last tenant schema.
  // The Tenant registry lives in `public`, so reset it before serving requests.
  await resetSearchPath()

  return server
}

// On embedded PGlite every request multiplexes a SINGLE connection whose
// search_path is mutated per request (tenant schema switch) and reset on the
// async `finish` event. Across rapid requests that reset races the next request's
// tenant resolution (which reads the `public.tenant` registry). Tests run
// sequentially, so we reset to `public` before each registry-dependent request to
// stay deterministic. NOTE: this race is exactly why schema-per-tenant on PGlite
// is unsafe under real concurrency — production multi-tenant needs real Postgres
// (one pooled connection per request).
export async function resetSearchPath() {
  await ds.query('SET search_path TO public')
}

export async function teardown() {
  if (server) await server.close()
  if (ds?.isInitialized) await ds.destroy()
  await closeEmbedded()
  ;(global as any).config = undefined
}

export function app() {
  return server
}
export function tenantManager() {
  return tm
}

/** Logs in through the real /auth/login route for a given tenant, returns the bearer token. */
export async function login(tenantSlug: string, email: string, password: string): Promise<string> {
  await resetSearchPath()
  const res = await server.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { [HEADER]: tenantSlug },
    payload: { email, password }
  })
  if (res.statusCode !== 200) throw new Error(`login failed (${res.statusCode}): ${res.body}`)
  return JSON.parse(res.body).token
}

export function authHeader(token: string, tenantSlug?: string) {
  return tenantSlug
    ? { authorization: `Bearer ${token}`, [HEADER]: tenantSlug }
    : { authorization: `Bearer ${token}` }
}
