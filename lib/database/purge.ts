import type { ControlHandle, DataHandle, Tenant, VFindResult, VQuery } from '../../types/global.js'

//
// The fan-out behind `npx volcanic sessions|auth-flows|access-log --purge [--tenants]`.
//
// Here and not in the CLI so it can be proved: the loop that pages the registry is the part that
// goes wrong quietly, because a fixed ceiling skips the containers past it without saying so.
//

export interface PurgeTarget {
  purgeExpired(ctx: DataHandle): Promise<number>
}

export interface PurgeLayer {
  provider: { control(): ControlHandle | Promise<ControlHandle>; tenant(id: string): DataHandle | Promise<DataHandle> }
  tenantManager: { listTenants(ctx: ControlHandle, query?: VQuery): Promise<VFindResult<Tenant>> }
}

export interface PurgeResult {
  removed: number
  containers: number
}

export const PURGE_PAGE_SIZE = 100

/** The control plane always, then every active container when `tenants` is set. */
export async function purgeContainers(layer: PurgeLayer, target: PurgeTarget, options: { tenants?: boolean } = {}): Promise<PurgeResult> {
  const control = await layer.provider.control()
  let removed = await target.purgeExpired(control)
  let containers = 1
  if (!options.tenants) return { removed, containers }

  // Paged, and filtered by the registry rather than here: a fleet is not something to read in one
  // query. The page ends the loop when it comes back short, so the size of the fleet is never an
  // assumption.
  for (let page = 1; ; page++) {
    const result = await layer.tenantManager.listTenants(control, {
      'status:eq': 'active',
      _page: page,
      _pageSize: PURGE_PAGE_SIZE
    } as VQuery)
    const records = result?.records ?? []
    for (const tenant of records) {
      removed += await target.purgeExpired(await layer.provider.tenant(tenant.id))
      containers += 1
    }
    if (records.length < PURGE_PAGE_SIZE) break
  }
  return { removed, containers }
}
