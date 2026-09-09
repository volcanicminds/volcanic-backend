/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-5.4: the instance does not serve traffic on a schema its code does not match.
//
// The failure this removes is the quiet one. A process that boots against an older schema
// does not crash: it answers requests, writes rows into columns that mean something else, and
// is found out later by the data. So what is asserted here is the REFUSAL, and the fact that
// the two planes are refused differently on purpose: the control plane stops the process, a
// tenant container stops only itself.
//
import { expect } from 'expect'
import fastify from 'fastify'
import { assertControlSchemaCurrent, migrationChecks } from '../../lib/loader/schemaVersion.js'
import { apply } from '../../lib/loader/tenant.js'

;(global as any).log = {}

const serverWith = (migrations: any) => {
  const s: any = { migrations }
  return s
}

const withConfig = (options: any) => {
  ;(global as any).config = { options }
}

describe('loader/schemaVersion · the control plane (T-5.4)', () => {
  afterEach(() => {
    ;(global as any).config = undefined
  })

  const runner = (applied: string | null, expected: string | null = '0002_latest') => ({
    expected: () => expected,
    version: async () => applied
  })

  it('boots when the schema is the one the code expects', async () => {
    withConfig({ control: { schema: 'public' } })
    let fatal: string | null = null
    await assertControlSchemaCurrent(serverWith(runner('0002_latest')), { onFatal: (m) => (fatal = m) })
    expect(fatal).toBe(null)
  })

  it('refuses to start when the control plane is behind', async () => {
    withConfig({ control: { schema: 'public' } })
    let fatal: string | null = null
    await assertControlSchemaCurrent(serverWith(runner('0001_old')), { onFatal: (m) => (fatal = m) })

    // Not a warning: a process that serves on a schema it does not match writes rows into
    // columns that mean something else, and nothing says so until the data does.
    expect(fatal).toMatch(/is at 0001_old and this code expects 0002_latest/)
    expect(fatal).toMatch(/db:migrate/)
  })

  it('refuses to start on an empty database, and says what to run', async () => {
    withConfig({ control: { schema: 'public' } })
    let fatal: string | null = null
    await assertControlSchemaCurrent(serverWith(runner(null)), { onFatal: (m) => (fatal = m) })
    expect(fatal).toMatch(/is at no migration/)
  })

  it('does not read an unreachable database as up to date, or as behind', async () => {
    withConfig({ control: { schema: 'public' } })
    let fatal: string | null = null
    await assertControlSchemaCurrent(
      serverWith({
        expected: () => '0002_latest',
        version: async () => {
          throw new Error('connect ECONNREFUSED')
        }
      }),
      { onFatal: (m) => (fatal = m) }
    )
    expect(fatal).toMatch(/cannot read the schema version/)
    expect(fatal).toMatch(/ECONNREFUSED/)
  })

  it('serves anyway when the deployment turned the check off', async () => {
    withConfig({
      control: { schema: 'public' },
      tenants: { strategy: 'schema', engine: 'postgres', migrations: { refuseStartIfControlBehind: false } }
    })
    let fatal: string | null = null
    await assertControlSchemaCurrent(serverWith(runner('0001_old')), { onFatal: (m) => (fatal = m) })
    expect(fatal).toBe(null)
  })

  it('says nothing when there is no data layer to be behind', async () => {
    withConfig({})
    let fatal: string | null = null
    await assertControlSchemaCurrent({} as any, { onFatal: (m) => (fatal = m) })
    expect(fatal).toBe(null)
  })

  it('defaults both checks to on, which is invariant 2', () => {
    withConfig({})
    expect(migrationChecks()).toEqual({ onResolve: true, onBoot: true })

    withConfig({ tenants: { strategy: 'schema', migrations: { checkOnResolve: false } } })
    expect(migrationChecks().onResolve).toBe(false)
    expect(migrationChecks().onBoot).toBe(true)
  })
})

//
// The tenant half. One container being behind must not take the other nine hundred down.
//
const REGISTRY: Record<string, any> = {}
const tenant = (slug: string) => {
  REGISTRY[slug] = { id: `id-${slug}`, slug, status: 'active', locator: `tenant_${slug}` }
  return REGISTRY[slug]
}

async function serverWithTenants(migrations: any, tenants: any) {
  ;(global as any).config = {
    options: { tenants: { strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: 'x-tenant-id', ...tenants } }
  }

  const server: any = fastify()
  server.decorate('provider', {
    control: async () => ({ kind: 'control' }),
    tenant: async (tenantId: string) => ({ kind: 'tenant', tenantId }),
    releaseRequestScope: async () => {},
    shutdown: async () => {}
  })
  server.decorate('tenantManager', {
    isImplemented: () => true,
    getTenantBySlug: async (_c: any, slug: string) => REGISTRY[slug] ?? null,
    getTenant: async (_c: any, id: string) => Object.values(REGISTRY).find((t) => t.id === id) ?? null
  })
  server.decorate('migrations', migrations)
  await apply(server)
  server.get('/data', { config: { tenantContext: true } }, async (req: any) => ({ tenant: req.tenantInfo?.slug }))
  await server.ready()
  return server
}

const get = (server: any, slug: string) =>
  server.inject({ method: 'GET', url: '/data', headers: { 'x-tenant-id': slug } })

describe('loader/tenant · a container behind its schema (T-5.4)', () => {
  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('refuses that tenant, and keeps serving the others', async () => {
    const good = tenant('current-a')
    const behind = tenant('behind-a')
    const versions: Record<string, string> = { [good.id]: '0002_latest', [behind.id]: '0001_old' }

    const server = await serverWithTenants(
      { expected: () => '0002_latest', version: async (c: any) => versions[c.tenantId] },
      {}
    )

    const refused = await get(server, behind.slug)
    expect(refused.statusCode).toBe(503)
    expect(JSON.parse(refused.body).code).toBe('SCHEMA_BEHIND')

    // The other nine hundred keep serving: this is why it is checked here and not at boot.
    const served = await get(server, good.slug)
    expect(served.statusCode).toBe(200)
    await server.close()
  })

  it('serves it again as soon as it is migrated, without a restart', async () => {
    const t = tenant('catching-up')
    let at = '0001_old'
    const server = await serverWithTenants({ expected: () => '0002_latest', version: async () => at }, {})

    expect((await get(server, t.slug)).statusCode).toBe(503)
    at = '0002_latest'
    // The failing answer is never cached: migrating a container takes effect on its next
    // request rather than after a deploy.
    expect((await get(server, t.slug)).statusCode).toBe(200)
    await server.close()
  })

  it('asks the container once, then remembers it is current', async () => {
    const t = tenant('cached')
    let reads = 0
    const server = await serverWithTenants(
      {
        expected: () => '0002_latest',
        version: async () => {
          reads++
          return '0002_latest'
        }
      },
      {}
    )

    for (let i = 0; i < 5; i++) expect((await get(server, t.slug)).statusCode).toBe(200)
    // A container cannot move backwards without a restore, which is an operational event and
    // a restart: five requests, one question.
    expect(reads).toBe(1)
    await server.close()
  })

  it('does not check at all when the deployment turned it off', async () => {
    const t = tenant('unchecked')
    let reads = 0
    const server = await serverWithTenants(
      {
        expected: () => '0002_latest',
        version: async () => {
          reads++
          return '0000_ancient'
        }
      },
      { migrations: { checkOnResolve: false } }
    )

    expect((await get(server, t.slug)).statusCode).toBe(200)
    expect(reads).toBe(0)
    await server.close()
  })
})
