//
// A tenant's container outside a request: borrowed, used, given back.
//
// A request receives its tenant's handle from resolution, a job from the scheduler. Any other
// work on a tenant (a script started with the server, a test reading what a route wrote, a
// consumer of a queue) takes it here, on the same lease: a connection of its own would sit outside
// the provider's bound on open containers, and an export or a destruction would not know about it.
//
import type { FastifyInstance } from 'fastify'
import type { ControlHandle, DataHandle, DataProvider, Tenant, TenantManagement } from '../../types/global.js'
import { isTenancyEnabled } from './tenancy.js'
import { runInTenant } from './requestContext.js'

/** The registry row of `slug`, refused unless active: never another container in its place. */
export async function activeTenant(tm: TenantManagement, control: ControlHandle, slug: string): Promise<Tenant> {
  const tenant = await tm.getTenantBySlug(control, slug)
  if (!tenant) throw new Error(`Tenant '${slug}' is not in the registry`)
  if (tenant.status !== 'active') throw new Error(`Tenant '${tenant.slug}' is ${tenant.status}`)
  return tenant
}

/**
 * `fn` on the tenant's container, borrowed under a lease named by `label` and given back whatever
 * `fn` does. `fn` runs inside the tenant, so its log lines and spans name it.
 */
export async function lendTenant<T>(
  provider: DataProvider,
  tenant: Tenant,
  label: string,
  fn: (handle: DataHandle) => T | Promise<T>
): Promise<T> {
  const scope = { requestId: `${label}:${tenant.id}:${Date.now()}` }
  try {
    const handle = await provider.tenant(tenant, scope)
    return await runInTenant(tenant.id, () => fn(handle as DataHandle))
  } finally {
    await provider.releaseRequestScope(scope)
  }
}

/**
 * Runs `fn` on the container of the active tenant `slug`, outside a request or a job, and gives
 * the container back when `fn` settles. The handle is valid until then: one kept past it may be
 * closed by the provider's bound on open containers.
 *
 * Refused without tenants, without a data layer, and for a tenant missing or not active.
 */
export async function withTenant<T>(
  server: FastifyInstance,
  slug: string,
  fn: (handle: DataHandle, tenant: Tenant) => T | Promise<T>
): Promise<T> {
  if (!isTenancyEnabled()) throw new Error(`No tenants are configured: there is no container for tenant '${slug}'`)
  const decorated = server as unknown as Record<string, unknown>
  const provider = decorated['provider'] as DataProvider | undefined
  if (!provider) throw new Error('No data layer is loaded: a tenant container cannot be lent')
  const tm = decorated['tenantManager'] as TenantManagement | undefined
  if (!tm?.isImplemented?.()) throw new Error('Tenancy is declared but no tenant manager can resolve it')

  const tenant = await activeTenant(tm, await provider.control(), slug)
  return lendTenant(provider, tenant, `withTenant:${slug}`, (handle) => fn(handle, tenant))
}
