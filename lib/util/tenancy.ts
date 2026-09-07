/* eslint-disable @typescript-eslint/no-explicit-any */
//
// One place answers "does this deployment have tenants?", so the answer cannot drift
// between the router, the hooks, the cache and the manifest. In v4 six call sites each read
// `options.multi_tenant?.enabled` on their own.
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

/** Raised instead of reading a container nobody asked for. Never caught inside the framework. */
export class NoDataContextError extends Error {
  readonly code = 'NO_DATA_CONTEXT'
  constructor(message: string) {
    super(message)
    this.name = 'NoDataContextError'
  }
}

/**
 * The data handle of a request, chosen by what the ROUTE declared (T-3.3).
 *
 * Invariant 3 in one function: in a deployment with tenants, a query without an explicit
 * context is an error, never a read of the control plane. So there are exactly three cases
 * and none of them is a fallback:
 *
 *   - the route declares `scope: 'control'`: it gets the control plane because it asked for
 *     it, not because a tenant was missing;
 *   - no tenants are configured: the application data lives in the control plane, and that
 *     is what single tenant means (docs/CONFIGURATION_V5.md §1);
 *   - tenants are configured and this is a tenant route: the container, or nothing.
 *
 * v4 wrote the third case as `req.db ?? global.connection.manager`, which is why a request
 * that lost its context read whatever the pool handed over (D-06). Reaching the throw below
 * means the resolution of T-3.2 was bypassed, so it is a bug in the framework and it is
 * reported as one rather than served.
 */
export function dataContext(req: any): DataHandle {
  const declaresControl = req?.routeOptions?.config?.tenantContext === false

  if (declaresControl || !isTenancyEnabled()) {
    if (!req?.control) {
      throw new NoDataContextError(
        'No control plane on this request: the data layer is not loaded, or `start()` was called without it'
      )
    }
    return req.control as DataHandle
  }

  if (!req?.tenant) {
    throw new NoDataContextError(
      `No tenant container on ${req?.method} ${req?.url}: a tenant route reached its handler without a resolved tenant. ` +
        'The control plane is not a substitute (invariant 3): declare `scope: control` if the route acts on the platform.'
    )
  }
  return req.tenant as DataHandle
}
