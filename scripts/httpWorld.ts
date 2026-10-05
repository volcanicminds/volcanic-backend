/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The whole server, booted the way a consumer boots it (preload, data layer, start), listening
// on 127.0.0.1 and an ephemeral port, with an administrator logged in and users to list. Shared
// by the HTTP bench (scripts/bench-http.ts) and the query budget (test/budget/queryBudget.spec.ts),
// so the requests the bench times are the requests whose statements the test counts.
//
// Two tenancies. `single`: no `tenants` block, every request on the one container. `schema`: one
// tenant provisioned through POST /tenants, its administrator's token naming it, so every request
// pays the tenant resolution a fleet pays. PGlite serves both outside production; Postgres needs
// a URL, and gets throwaway schemas named after `prefix`.
//
// What it sets, process environment and framework globals alike, it puts back on close: the test
// runs inside a mocha process shared with other suites.
//
import bcrypt from 'bcrypt'
import { sql } from 'drizzle-orm'
import { preload, start as startServer } from '../index.js'
import { start as startDataLayer, PostgresProvider } from '../db.js'
import { table, type RuntimeHandle } from '../lib/database/managers/runtime.js'

export type Tenancy = 'single' | 'schema'

export interface WorldOptions {
  engine: 'pglite' | 'postgres'
  tenancy: Tenancy
  /** Postgres only. */
  url?: string
  /** Postgres only: the schemas are `<prefix>_control` and `<prefix>_t1`. */
  prefix?: string
  poolMax?: number
  /** Postgres only: schemas a previous run left behind. A bench refuses them, a test drops them. */
  leftovers?: 'refuse' | 'drop'
  /** Users seeded besides the administrator, so a list has pages to read. */
  users?: number
}

export interface HttpWorld {
  server: any
  /** `http://127.0.0.1:<port>`. */
  origin: string
  headers(as: Scenario['as']): Record<string, string>
  close(): Promise<void>
}

/** A request the bench times and the budget counts. */
export interface Scenario {
  name: string
  url: string
  as: 'anonymous' | 'admin'
}

export const SCENARIOS: Scenario[] = [
  // The floor: routing, the hooks of every request, serialization. No subject, no statement.
  { name: 'health', url: '/health', as: 'anonymous' },
  // A credential resolved to its subject, and the subject answered.
  { name: 'users.me', url: '/users/me', as: 'admin' },
  // A Magic Query list with its count, behind the admin role.
  { name: 'users.list', url: '/users?_pageSize=25', as: 'admin' }
]

const ADMIN = { email: 'admin@world.test', password: 'World-pw-123456' }
const TENANT = { name: 'World', slug: 'world' }
const HEADER = 'x-tenant-id'

const ENV: Record<string, string> = {
  AUTH_MODE: 'BEARER',
  JWT_SECRET: 'world-secret-not-for-production-32-chars',
  MFA_DB_SECRET: 'world-secret-not-for-production-32x',
  ADMIN_EMAIL: ADMIN.email,
  ADMIN_PASSWORD: ADMIN.password,
  HOST: '127.0.0.1',
  PORT: '0'
}

const GLOBALS = [
  'config',
  't',
  'roles',
  'systemRoles',
  'authFlows',
  'server',
  'cache',
  'tracking',
  'trackingConfig',
  'routes',
  'transferPath',
  'transferConfig'
]

async function login(server: any, url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url,
    headers,
    payload: { method: 'password', email: ADMIN.email, password: ADMIN.password }
  })
  if (res.statusCode !== 200) throw new Error(`login on ${url} failed (${res.statusCode}): ${res.body}`)
  return JSON.parse(res.body).token
}

async function seedUsers(handle: RuntimeHandle, count: number) {
  if (!count) return
  // Nobody logs in as them: one hash at a low cost serves every row.
  const hash = await bcrypt.hash(ADMIN.password, 4)
  const users = table(handle, 'user') as any
  const rows = Array.from({ length: count }, (_, i) => ({ email: `u${i + 1}@world.test`, password: hash }))
  for (let i = 0; i < rows.length; i += 500) await handle.db.insert(users).values(rows.slice(i, i + 500))
}

export async function openWorld(options: WorldOptions): Promise<HttpWorld> {
  const { engine, tenancy, prefix = 'world', poolMax = 10, users = 0 } = options
  if (engine === 'postgres' && !options.url) throw new Error('a Postgres world needs a url')

  const savedEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]))
  const savedGlobals = Object.fromEntries(GLOBALS.map((k) => [k, (global as any)[k]]))
  const savedLevel = (global as any).log?.level
  Object.assign(process.env, ENV)
  // A logged request measures the logger: at the development default every statement is a line.
  if ((global as any).log) (global as any).log.level = 'silent'

  const schemas = { control: engine === 'pglite' ? 'public' : `${prefix}_control`, tenant: `${prefix}_t1` }
  let admin: PostgresProvider | null = null
  let ownsSchemas = false
  let layer: any = null
  let server: any = null

  const close = async () => {
    try {
      if (server) await server.close()
      if (layer) await layer.shutdown()
      if (admin && ownsSchemas) for (const schema of [schemas.control, schemas.tenant]) await admin.dropSchema(schema)
      if (admin) await admin.shutdown()
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      for (const [k, v] of Object.entries(savedGlobals)) (global as any)[k] = v
      if (savedLevel) (global as any).log.level = savedLevel
    }
  }

  try {
    if (engine === 'postgres') {
      admin = new PostgresProvider({ url: options.url, schema: 'public', poolMax: 1 })
      const names = [schemas.control, schemas.tenant]
      // The handle is a Drizzle database; ControlHandle names it opaquely for consumers.
      const control = admin.control() as unknown as { execute(q: unknown): Promise<{ rows: Array<{ name: string }> }> }
      const { rows } = await control.execute(
        sql`select schema_name as name from information_schema.schemata where schema_name in (${sql.join(
          names.map((s) => sql`${s}`),
          sql`, `
        )})`
      )
      if (rows.length && options.leftovers !== 'drop') {
        const found = rows.map((r) => r.name).join(', ')
        throw new Error(`Schemas ${found} already exist on the database: drop them, or point the run elsewhere`)
      }
      ownsSchemas = true
      for (const schema of names) await admin.dropSchema(schema)
      await admin.createSchema(schemas.control)
    }

    await preload()
    const config = (global as any).config
    config.options.control =
      engine === 'pglite'
        ? { engine: 'pglite' }
        : { engine: 'postgres', url: options.url, schema: schemas.control, pool: { max: poolMax } }
    config.options.tenants =
      tenancy === 'schema' ? { strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER } : null

    layer = await startDataLayer()
    await layer.migrations.apply({ locator: schemas.control })
    server = await startServer(layer)

    let token: string
    if (tenancy === 'single') {
      token = await login(server, '/auth/flow/start')
      await seedUsers(layer.provider.control(), users)
    } else {
      const system = await login(server, '/system/auth/flow/start')
      const res = await server.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${system}` },
        payload: {
          ...TENANT,
          strategy: 'schema',
          engine: 'postgres',
          locator: schemas.tenant,
          admin: { email: ADMIN.email, password: ADMIN.password, adminConfirmed: true }
        }
      })
      if (res.statusCode >= 300) throw new Error(`POST /tenants failed (${res.statusCode}): ${res.body}`)
      token = await login(server, '/auth/flow/start', { [HEADER]: TENANT.slug })
      await seedUsers(await layer.provider.forLocator(schemas.tenant, JSON.parse(res.body).id), users)
    }

    return {
      server,
      origin: `http://127.0.0.1:${server.server.address().port}`,
      // The tenant comes from the token: a client holding one sends no header.
      headers: (as): Record<string, string> => (as === 'admin' ? { authorization: `Bearer ${token}` } : {}),
      close
    }
  } catch (error) {
    await close()
    throw error
  }
}
