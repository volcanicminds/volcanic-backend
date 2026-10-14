/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Isolation bench on REAL Postgres, specified in docs/TESTING_V5.md §2.
//
// Why it exists: every other suite runs on PGlite, which returns the same single
// connection from `connect()`. Without a pool the whole class of defects where session
// state survives into the next request is not merely unobserved, it is unobservable.
//
// Two rules govern this file:
//
//   1. It talks to the framework through its PUBLIC surface only: HTTP for behaviour,
//      plain `pg` for setup and for looking at the database from outside. It never
//      imports the data layer, so it does not depend on the ORM.
//   2. It never works around a defect: no raw UPDATE to confirm a seeded admin, no
//      `search_path` reset by hand between requests. If a tenant cannot be provisioned
//      through the API and used immediately, that IS the finding.
//
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import * as loaderConfig from '../../lib/loader/general.js'
import * as loaderRoles from '../../lib/loader/roles.js'
import * as loaderTranslation from '../../lib/loader/translation.js'
import { start as startServer } from '../../index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.resolve(__dirname, './fixtures/app')

export const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://volcanic:volcanic@127.0.0.1:55432/volcanic'
export const HEADER = 'x-tenant-id'

/** The platform administrator, seeded on an empty control plane from ADMIN_EMAIL. */
export const SYSTEM = { email: 'super@system.test', password: 'Super-pw-123456' }

export const ACME = {
  name: 'Acme',
  slug: 'acme',
  locator: 'tenant_acme',
  adminEmail: 'admin@acme.test',
  adminPassword: 'Acme-pw-123456',
  tag: 'ACME PRIVATE ROW'
}
export const GLOBEX = {
  name: 'Globex',
  slug: 'globex',
  locator: 'tenant_globex',
  adminEmail: 'admin@globex.test',
  adminPassword: 'Globex-pw-12345',
  tag: 'GLOBEX PRIVATE ROW'
}
export const CONTROL_TAG = 'CONTROL PLANE'

let server: any
let admin: pg.Pool | null = null
let originalCwd: string
let strategy: 'schema' | 'container' = 'schema'
let shutdownDataLayer: (() => Promise<void>) | null = null

/** A connection to the database from OUTSIDE the application, for setup and inspection. */
export function sql(): pg.Pool {
  if (!admin) admin = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  return admin
}

/** The URL of another database on the same server: a tenant's, under the `container` strategy. */
export function databaseUrlOf(database: string): string {
  const url = new URL(DATABASE_URL)
  url.pathname = `/${database}`
  return url.toString()
}

/** Runs `fn` on a client of a tenant's own database, closed afterwards. */
export async function inTenantDatabase<T>(locator: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrlOf(locator) })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** Drops whatever a previous run left behind, under either strategy: every run starts from a known state. */
async function resetDatabase() {
  const db = sql()
  for (const locator of [ACME.locator, GLOBEX.locator]) {
    await db.query(`drop schema if exists "${locator}" cascade`)
    await db.query(`drop database if exists "${locator}" with (force)`)
  }
  await db.query('drop schema if exists public cascade')
  await db.query('create schema public')
}

/** The marker row the probe routes read. Same table name in every container. */
async function seedWidget(locator: string, tag: string) {
  const seed = async (db: { query: pg.Pool['query'] }, schema: string) => {
    await db.query(`create table if not exists "${schema}".widget (tag text)`)
    await db.query(`delete from "${schema}".widget`)
    await db.query(`insert into "${schema}".widget (tag) values ($1)`, [tag])
  }
  if (strategy === 'container' && locator !== 'public') {
    await inTenantDatabase(locator, (client) => seed(client as never, 'public'))
    return
  }
  await seed(sql(), locator)
}

/**
 * `extra`: what a consumer wires next to the data layer, a `challengeDeliveryManager` for one.
 * `options.strategy`: how tenants are kept, a schema each (the default) or a database each.
 */
export async function setup(extra: Record<string, unknown> = {}, options: { strategy?: 'schema' | 'container' } = {}) {
  if (server) return server

  strategy = options.strategy ?? 'schema'
  await resetDatabase()

  originalCwd = process.cwd()
  process.chdir(FIXTURE_DIR) // the router discovers ./src/api of the fixture app

  const cfg = await loaderConfig.load()
  // The v5 configuration shape: two declared blocks (docs/CONFIGURATION_V5.md §1).
  ;(cfg.options as any).control = {
    engine: 'postgres',
    url: DATABASE_URL,
    schema: 'public',
    pool: { max: Number(process.env.DB_POOL_MAX) || 1 }
  }
  ;(cfg.options as any).tenants = {
    strategy,
    engine: 'postgres',
    resolver: 'header',
    headerKey: HEADER
  }
  ;(global as any).config = cfg
  ;(global as any).roles = await loaderRoles.load()
  // The control catalogue, exactly as index.ts loads it: a control route resolves its roles
  // against this map and never against the tenant one (T-4.1).
  ;(global as any).systemRoles = await loaderRoles.loadSystem()
  ;(global as any).t = loaderTranslation.load()

  // The data layer is loaded through a variable specifier so this file keeps
  // type-checking while `db.ts` does not exist yet (T-1.3 creates it). Until then the
  // suite fails here, which is the point: it must be red before the rewrite and green
  // after it, with no edit in between.
  const dataLayerPath = '../../db.js'
  let dataLayer: any
  try {
    dataLayer = await import(dataLayerPath)
  } catch (e: any) {
    throw new Error(
      `data layer not available: expected ${dataLayerPath} to export start() and the managers ` +
        `(contract in docs/MANAGERS_V5.md). Underlying error: ${e?.message}`
    )
  }

  const managers = await dataLayer.start()
  shutdownDataLayer = managers.shutdown

  // What a deployment does before the first request: bring the control plane to the current
  // schema version (T-5.2, `npm run db:migrate`). Not a workaround for a defect, which this
  // harness never contains: a database nobody migrated has no tables, and a framework that
  // created them on boot from its entity metadata is exactly what v5 removed.
  await managers.migrations.apply({ locator: 'public' })

  server = await startServer({ ...managers, ...extra })
  await server.ready()

  await seedWidget('public', CONTROL_TAG)
  return server
}

export async function teardown() {
  if (server) await server.close()
  // The server does not own the data layer's pools: left open, they outlive the suite and hold
  // connections to databases the next suite drops.
  if (shutdownDataLayer) await shutdownDataLayer()
  shutdownDataLayer = null
  if (admin) await admin.end()
  admin = null
  server = null
  strategy = 'schema'
  ;(global as any).config = undefined
  if (originalCwd) process.chdir(originalCwd)
}

export function app() {
  return server
}

export async function inject(opts: any) {
  return server.inject(opts)
}

/** Logs the platform administrator in, on the control scope (docs/API_V5.md §5). */
export async function systemToken(): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/system/auth/flow/start',
    payload: { method: 'password', email: SYSTEM.email, password: SYSTEM.password }
  })
  if (res.statusCode !== 200) throw new Error(`system login failed (${res.statusCode}): ${res.body}`)
  return JSON.parse(res.body).token
}

/**
 * Provisions a tenant through the public API and seeds its marker row. No manager call,
 * no raw fix-up: if this cannot be done through the API, the framework is broken and the
 * bench must say so.
 */
export async function createTenant(token: string, t: typeof ACME): Promise<any> {
  const res = await server.inject({
    method: 'POST',
    url: '/tenants',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: t.name,
      slug: t.slug,
      strategy,
      engine: 'postgres',
      locator: t.locator,
      admin: { email: t.adminEmail, password: t.adminPassword, adminConfirmed: true }
    }
  })
  if (res.statusCode >= 300) throw new Error(`createTenant(${t.slug}) failed (${res.statusCode}): ${res.body}`)
  await seedWidget(t.locator, t.tag)
  return JSON.parse(res.body)
}

/** Logs a tenant user in through the real login flow, with the tenant taken from the header. */
export async function login(slug: string, email: string, password: string): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/auth/flow/start',
    headers: { [HEADER]: slug },
    payload: { method: 'password', email, password }
  })
  if (res.statusCode !== 200) throw new Error(`login ${slug} failed (${res.statusCode}): ${res.body}`)
  return JSON.parse(res.body).token
}

export const bearer = (token: string, slug?: string) =>
  slug ? { authorization: `Bearer ${token}`, [HEADER]: slug } : { authorization: `Bearer ${token}` }
