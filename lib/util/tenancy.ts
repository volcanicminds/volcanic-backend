/* eslint-disable @typescript-eslint/no-explicit-any */
//
// One place answers "does this deployment have tenants?", so the answer cannot drift
// between the router, the hooks, the cache and the manifest — in v4 six call sites each
// read `options.multi_tenant?.enabled` on their own.
//
// v5 shape (docs/CONFIGURATION_V5.md §1): the `tenants` block is absent for a single-tenant
// deployment and present, with a strategy, when tenants exist. There is no `enabled` flag:
// declaring the block IS enabling it, so the two cannot contradict each other.
//
import type { DataHandle, TenantsConfig } from '../../types/global.js'

export function tenantsConfig(): TenantsConfig | null {
  const tenants = (global as any).config?.options?.tenants
  return tenants ?? null
}

export function isTenancyEnabled(): boolean {
  return !!tenantsConfig()?.strategy
}

/**
 * The data handle of a request: the tenant container when tenancy is on, the control plane
 * when it is not. One helper so the choice is made in one place — and so that a call site
 * without a context is a compile error, not a silent read of whatever the pool handed over
 * (that was defect D-01 and invariant 3).
 */
export function dataContext(req: any): DataHandle {
  return (req.tenant ?? req.control) as DataHandle
}
