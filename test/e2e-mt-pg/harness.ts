/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Isolation bench on REAL Postgres — T-0.2 of EVO_FRAMEWORK.md, specified in
// docs/TESTING_V5.md §2.
//
// Why it exists: every other suite runs on PGlite, which returns the same single
// connection from `connect()`. Without a pool the whole D-01 class of defects (session
// state surviving into the next request) is not merely unobserved, it is unobservable.
//
// Two rules govern this file:
//
//   1. It talks to the framework through its PUBLIC surface only: HTTP for behaviour,
//      plain `pg` for setup and for looking at the database from outside. It never
//      imports the data layer, so it survives the change of ORM unchanged.
//   2. It never works around a defect. In v4 the multi-tenant harness confirmed seeded
//      admins with a raw UPDATE and reset `search_path` by hand between requests; both
//      hid a real defect (D-08, D-01). Nothing of the sort belongs here: if a tenant
//      cannot be provisioned through the API and used immediately, that IS the finding.
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

/** A connection to the database from OUTSIDE the application, for setup and inspection. */
export function sql(): pg.Pool {
  if (!admin) admin = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  return admin
}

/** Drops whatever a previous run left behind: every run starts from a known state. */
async function resetDatabase() {
  const db = sql()
  for (const schema of [ACME.locator, GLOBEX.locator]) {
    await db.query(`drop schema if exists "${schema}" cascade`)
  }
  await db.query('drop schema if exists public cascade')
  await db.query('create schema public')
}

/** The marker row the probe routes read. Same table name in every container. */
async function seedWidget(schema: string, tag: string) {
  const db = sql()
  await db.query(`create table if not exists "${schema}".widget (tag text)`)
  await db.query(`delete from "${schema}".widget`)
  await db.query(`insert into "${schema}".widget (tag) values ($1)`, [tag])
}

export async function setup() {
  if (server) return server

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
    strategy: 'schema',
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
      `data layer not available yet: expected ${dataLayerPath} to export start() and the managers ` +
        `(T-1.3 of EVO_FRAMEWORK.md, contract in docs/MANAGERS_V5.md). Underlying error: ${e?.message}`
    )
  }

  const managers = await dataLayer.start()

  // What a deployment does before the first request: bring the control plane to the current
  // schema version (T-5.2, `npm run db:migrate`). Not a workaround for a defect, which this
  // harness never contains: a database nobody migrated has no tables, and a framework that
  // created them on boot from its entity metadata is exactly what v5 removed.
  await managers.migrations.apply({ locator: 'public' })

  server = await startServer(managers)
  await server.ready()

  await seedWidget('public', CONTROL_TAG)
  return server
}

export async function teardown() {
  if (server) await server.close()
  if (admin) await admin.end()
  admin = null
  server = null
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
    url: '/system/auth/login',
    payload: { email: SYSTEM.email, password: SYSTEM.password }
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
      strategy: 'schema',
      engine: 'postgres',
      locator: t.locator,
      admin: { email: t.adminEmail, password: t.adminPassword, adminConfirmed: true }
    }
  })
  if (res.statusCode >= 300) throw new Error(`createTenant(${t.slug}) failed (${res.statusCode}): ${res.body}`)
  await seedWidget(t.locator, t.tag)
  return JSON.parse(res.body)
}

/** Logs a tenant user in through the real route, with the tenant taken from the header. */
export async function login(slug: string, email: string, password: string): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { [HEADER]: slug },
    payload: { email, password }
  })
  if (res.statusCode !== 200) throw new Error(`login ${slug} failed (${res.statusCode}): ${res.body}`)
  return JSON.parse(res.body).token
}

export const bearer = (token: string, slug?: string) =>
  slug ? { authorization: `Bearer ${token}`, [HEADER]: slug } : { authorization: `Bearer ${token}` }
