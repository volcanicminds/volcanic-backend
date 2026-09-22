/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.5: what provisioning and exporting a container refuse.
//
// Four refusals no test had ever fired, and one of them exists because of a defect with a
// number: v4 SAVED the container name raw and USED it sanitised, so a registry row could
// name a schema that does not exist (D-20). v5 refuses a name that changes under
// sanitisation rather than quietly adjusting it — a rule whose whole value is that it fires.
//
import { expect } from 'expect'
import fastify from 'fastify'
import { create, exportContainer } from '../../lib/api/tenants/controller/tenants.js'
import { getData, getParams } from '../../lib/util/common.js'
import { buildAuthenticatorRegistry, createAuthenticatorRegistry } from '../../lib/auth/registry.js'
import { passwordAuthenticator } from '../../lib/auth/builtins.js'

;(global as any).log = {}

const ACME: any = { id: 'id-acme', slug: 'acme', status: 'active', locator: 'tenant_acme', schemaVersion: '0001_init' }

async function build(over: any = {}) {
  ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' }, export_directory: '/tmp' } }

  const created: any[] = []

  const server: any = fastify()
  server.decorate('tenantManager', {
    isImplemented: () => true,
    getTenant: async (_c: any, id: string) => (id === ACME.id ? ACME : null),
    getTenantBySlug: async (_c: any, slug: string) => (over.slugTaken && slug === 'acme' ? ACME : null),
    createTenant: async (_c: any, data: any) => {
      created.push(data)
      return { ...ACME, ...data }
    }
  })
  server.decorate('userManager', {
    isImplemented: () => true,
    createUser: async (_c: any, data: any) => ({ id: 'u1', ...data })
  })
  if (over.mfa) server.decorate('mfaManager', { isImplemented: () => true })
  server.decorate('authFlowManager', { isImplemented: () => over.noFlowStore !== true })
  if (over.registry) server.decorate('authRegistry', over.registry)
  server.decorate('migrations', { apply: async () => '0001_init', version: async () => '0001_init' })
  server.decorate('provider', {
    createContainer: async () => {},
    dropContainer: async () => {},
    forLocator: async () => ({ kind: 'tenant' }),
    // A data layer that cannot export: the file-per-container engines can, a shared-schema
    // Postgres deployment without pg_dump cannot.
    ...(over.canExport === false ? {} : { exportContainer: async () => ({ path: '/tmp/acme.sql', bytes: 2048 }) })
  })

  server.addHook('onRequest', async (req: any) => {
    req.data = () => getData(req)
    req.parameters = () => getParams(req)
    req.control = { kind: 'control' }
    req.systemUser = { id: 'sys-1', email: 'root@system.test' }
  })

  server.post('/tenants', { config: { tenantContext: false } }, create)
  server.post('/tenants/:id/export', { config: { tenantContext: false } }, exportContainer)

  await server.ready()
  return { server, created }
}

const provision = (server: any, payload: any) => server.inject({ method: 'POST', url: '/tenants', payload })

describe('tenants · what provisioning refuses (T-9.5)', () => {
  after(() => {
    ;(global as any).config = undefined
  })

  it('refuses a container name that would not survive sanitisation, instead of adjusting it', async () => {
    const { server, created } = await build()

    for (const locator of ['Tenant-Acme', 'tenant acme', 'tenant";drop table user;--', 'tenant.acme']) {
      const res = await provision(server, {
        slug: 'acme',
        name: 'Acme',
        locator,
        admin: { email: 'admin@acme.test', password: 'Str0ng-passw0rd!' }
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).code).toBe('TENANT_LOCATOR_INVALID')
    }

    // Refusing and adjusting look the same from a happy path and differ exactly where D-20
    // lived: adjusting writes one name and uses another.
    expect(created.length).toBe(0)
    await server.close()
  })

  it('accepts a name that is already what sanitisation would make it', async () => {
    const { server, created } = await build()
    const res = await provision(server, {
      slug: 'acme',
      name: 'Acme',
      locator: 'tenant_acme',
      admin: { email: 'admin@acme.test', password: 'Str0ng-passw0rd!' }
    })
    expect(res.statusCode).toBeLessThan(400)
    expect(created[0].locator).toBe('tenant_acme')
    await server.close()
  })

  it('answers 503 AUTH_FLOW_NOT_AVAILABLE to MANDATORY when this build keeps no flows (T-12.7, F46)', async () => {
    // The floor puts a second step in every login of that tenant, and a step without a row counts
    // no attempts: written anyway, the policy would lock the customer out at the first login.
    const { server, created } = await build({ mfa: true, noFlowStore: true })
    const res = await provision(server, {
      slug: 'acme',
      name: 'Acme',
      config: { mfa_policy: 'MANDATORY' },
      admin: { email: 'admin@acme.test', password: 'Str0ng-passw0rd!' }
    })
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).code).toBe('AUTH_FLOW_NOT_AVAILABLE')
    expect(created.length).toBe(0)
    await server.close()
  })

  it('answers 409 TENANT_EXISTS instead of provisioning a second container for one slug', async () => {
    // The slug is how a request names its tenant, so two rows holding it is not a duplicate
    // record, it is an ambiguous address.
    const { server, created } = await build({ slugTaken: true })

    const res = await provision(server, {
      slug: 'acme',
      name: 'Acme again',
      admin: { email: 'admin@acme.test', password: 'Str0ng-passw0rd!' }
    })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).code).toBe('TENANT_EXISTS')
    expect(created.length).toBe(0)
    await server.close()
  })

  it('answers 503 MFA_POLICY_UNSUPPORTED to MANDATORY when the tenant plane has nothing to enrol a user in (T-12.7)', async () => {
    // The MFA manager is there, so MFA_NOT_AVAILABLE does not fire; what is missing is the method
    // the engine enrols a user without a factor in. Written anyway, the policy would send every
    // such user of this customer into a stage nobody can pass.
    const tenantPlaneBare = createAuthenticatorRegistry()
    tenantPlaneBare.register(passwordAuthenticator)
    const { server, created } = await build({ mfa: true, registry: tenantPlaneBare })

    const payload = {
      slug: 'acme',
      name: 'Acme',
      config: { mfa_policy: 'MANDATORY' },
      admin: { email: 'admin@acme.test', password: 'Str0ng-passw0rd!' }
    }
    const res = await provision(server, payload)
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).code).toBe('MFA_POLICY_UNSUPPORTED')
    expect(created.length).toBe(0)
    await server.close()

    // The same write on a build whose registry has the built-ins goes through.
    const whole = await build({ mfa: true, registry: buildAuthenticatorRegistry() })
    const accepted = await provision(whole.server, payload)
    expect(accepted.statusCode).toBeLessThan(400)
    expect(whole.created.length).toBe(1)
    await whole.server.close()
  })

  it('answers 503 EXPORT_NOT_AVAILABLE when the data layer cannot produce one', async () => {
    // 503 and not 500: nothing failed. The deployment cannot do it, which is a different
    // sentence and a different thing for the operator to go and fix.
    const { server } = await build({ canExport: false })

    const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/export`, payload: {} })
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).code).toBe('EXPORT_NOT_AVAILABLE')
    await server.close()
  })
})
