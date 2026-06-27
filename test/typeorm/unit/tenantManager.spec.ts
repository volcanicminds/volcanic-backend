/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { TenantManager } from '../../../lib/database/typeorm/loader/tenantManager.js'

// resolveTenant() is pure request/tenant-resolution logic (no schema work), so we
// drive it with a fake DataSource whose Tenant repository returns a canned record.
// These tests pin the SECURITY contract: header is mandatory, and a JWT-bound
// tenant must match the header (anti-spoofing / IDOR).
function managerWith(tenantRecord: any) {
  const fakeDs: any = {
    getRepository: () => ({ findOne: async () => tenantRecord })
  }
  return new TenantManager(fakeDs)
}

function setMultiTenant(enabled: boolean, header_key = 'x-tenant-id') {
  ;(global as any).config = { options: { multi_tenant: { enabled, header_key } } }
}

describe('TenantManager.resolveTenant (security contract)', () => {
  const activeTenant = { id: 't1', slug: 'acme', status: 'active', dbSchema: 'tenant_acme' }

  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('returns null in single-tenant mode (disabled)', async () => {
    setMultiTenant(false)
    const tm = managerWith(activeTenant)
    expect(await tm.resolveTenant({ headers: { 'x-tenant-id': 'acme' } })).toBeNull()
  })

  it('returns null when the tenant header is missing (header is mandatory)', async () => {
    setMultiTenant(true)
    const tm = managerWith(activeTenant)
    expect(await tm.resolveTenant({ headers: {} })).toBeNull()
  })

  it('resolves an active tenant from the header', async () => {
    setMultiTenant(true)
    const tm = managerWith(activeTenant)
    const t: any = await tm.resolveTenant({ headers: { 'x-tenant-id': 'acme' } })
    expect(t?.slug).toBe('acme')
  })

  it('blocks tenant spoofing: JWT tid must match the header', async () => {
    setMultiTenant(true)
    const tm = managerWith(activeTenant)
    // token bound to tenant X requesting tenant Y via header => rejected
    const t = await tm.resolveTenant({ headers: { 'x-tenant-id': 'globex' }, user: { tid: 'acme' } })
    expect(t).toBeNull()
  })

  it('allows the request when JWT tid matches the header', async () => {
    setMultiTenant(true)
    const tm = managerWith(activeTenant)
    const t: any = await tm.resolveTenant({ headers: { 'x-tenant-id': 'acme' }, user: { tid: 'acme' } })
    expect(t?.slug).toBe('acme')
  })

  it('returns null when the tenant is not found', async () => {
    setMultiTenant(true)
    const tm = managerWith(null)
    expect(await tm.resolveTenant({ headers: { 'x-tenant-id': 'ghost' } })).toBeNull()
  })

  it('returns null when the tenant is not active', async () => {
    setMultiTenant(true)
    const tm = managerWith({ ...activeTenant, status: 'suspended' })
    expect(await tm.resolveTenant({ headers: { 'x-tenant-id': 'acme' } })).toBeNull()
  })

  it('honours a custom header_key', async () => {
    setMultiTenant(true, 'x-org')
    const tm = managerWith(activeTenant)
    const t: any = await tm.resolveTenant({ headers: { 'x-org': 'acme' } })
    expect(t?.slug).toBe('acme')
  })
})
