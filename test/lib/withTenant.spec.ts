/* eslint-disable @typescript-eslint/no-explicit-any */
//
// A tenant's container outside a request: the scheduler's lease, for work that is neither.
//
// The observable is what the provider saw: which row it lent, under which scope, and whether the
// scope came back. A handle that is never given back pins its container past the provider's bound.
//
import { expect } from 'expect'
import { withTenant } from '../../lib/util/withTenant.js'
import { currentTenantId } from '../../lib/util/requestContext.js'

const REGISTRY: any[] = [
  { id: 'id-acme', slug: 'acme', status: 'active', locator: 'tenant_acme' },
  { id: 'id-dormant', slug: 'dormant', status: 'suspended', locator: 'tenant_dormant' }
]

function fakeServer() {
  const lent: any[] = []
  const released: string[] = []
  const provider = {
    control: async () => ({ kind: 'control' }),
    tenant: async (row: any, scope?: any) => {
      lent.push({ tenantId: row.id, scope })
      return { kind: 'tenant', tenantId: row.id } as any
    },
    releaseRequestScope: async (scope: any) => void released.push(scope.requestId),
    shutdown: async () => {}
  }
  const tenantManager = {
    isImplemented: () => true,
    getTenantBySlug: async (_ctx: any, slug: string) => REGISTRY.find((t) => t.slug === slug) ?? null
  }
  return { server: { provider, tenantManager } as any, lent, released }
}

describe('withTenant · a tenant container outside a request', () => {
  const saved = (global as any).config

  beforeEach(() => {
    ;(global as any).config = { options: { tenants: { strategy: 'schema' } } }
  })

  after(() => {
    ;(global as any).config = saved
  })

  it('lends the named tenant’s container, runs inside the tenant, and gives it back once fn settles', async () => {
    const { server, lent, released } = fakeServer()
    const result = await withTenant(server, 'acme', async (handle, tenant) => {
      await new Promise((resolve) => setImmediate(resolve))
      // Still held while fn works: a lease given back early lets the bound close the container under it.
      expect(released).toEqual([])
      return [(handle as any).tenantId, tenant.slug, currentTenantId()]
    })

    expect(result).toEqual(['id-acme', 'acme', 'id-acme'])
    expect(lent.length).toBe(1)
    expect(released).toEqual([lent[0].scope.requestId])
  })

  it('gives the container back when fn throws, and rethrows', async () => {
    const { server, released } = fakeServer()
    await expect(
      withTenant(server, 'acme', async () => {
        throw new Error('the work failed')
      })
    ).rejects.toThrow('the work failed')
    expect(released.length).toBe(1)
  })

  it('refuses a tenant missing or not active, lending nothing', async () => {
    const { server, lent } = fakeServer()
    await expect(withTenant(server, 'nowhere', () => 'ran')).rejects.toThrow("Tenant 'nowhere' is not in the registry")
    await expect(withTenant(server, 'dormant', () => 'ran')).rejects.toThrow("Tenant 'dormant' is suspended")
    expect(lent).toEqual([])
  })

  it('refuses without tenants and without a data layer, instead of handing the control plane', async () => {
    const { server, lent } = fakeServer()
    ;(global as any).config = { options: {} }
    await expect(withTenant(server, 'acme', () => 'ran')).rejects.toThrow(/No tenants are configured/)

    ;(global as any).config = { options: { tenants: { strategy: 'schema' } } }
    await expect(withTenant({} as any, 'acme', () => 'ran')).rejects.toThrow(/No data layer is loaded/)
    expect(lent).toEqual([])
  })
})
