//
// One place answers "does this deployment have tenants?", so the answer cannot drift
// between the router, the hooks, the cache and the manifest — in v4 six call sites each
// read `options.multi_tenant?.enabled` on their own.
//
// v5 shape (docs/CONFIGURATION_V5.md §1): the `tenants` block is absent for a single-tenant
// deployment and present, with a strategy, when tenants exist. There is no `enabled` flag:
// declaring the block IS enabling it, so the two cannot contradict each other.
//
import type { TenantsConfig } from '../../types/global.js'

export function tenantsConfig(): TenantsConfig | null {
  const tenants = (global as any).config?.options?.tenants
  return tenants ?? null
}

export function isTenancyEnabled(): boolean {
  return !!tenantsConfig()?.strategy
}
