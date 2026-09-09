import type { TenantHandle, Tenant, GeneralConfig, DataProvider, DataRequestScope } from '../../types/global.js'

//
// The seams the adapters plug into (docs/MANAGERS_V5.md §9). Types only: no implementation
// lives here, and the core depends on these shapes rather than on an ORM — that boundary is
// enforced in CI by dependency-cruiser, and it is why swapping the engine is a phase of work
// instead of a rewrite of the framework.
//
/**
 * Declared in `types/global.d.ts` and re-exported here, not redeclared: the core cannot
 * import this file (dependency-cruiser) and two declarations of the same contract drift on
 * the first change. One name, one definition, two places allowed to see it.
 */
export type RequestScope = DataRequestScope

export interface ConnectionProvider extends DataProvider {
  /** Opens or reuses a tenant's container, honouring the LRU limit of T-7.1. */
  tenant(tenantId: string, scope?: RequestScope): Promise<TenantHandle>
}

export interface ContainerRef {
  readonly tenantId?: string
  readonly locator: string
}

export interface Migration {
  readonly id: string
  readonly name: string
}

export interface MigrationRunner {
  pending(container: ContainerRef): Promise<Migration[]>
  /** Applies the pending migrations and returns the version reached. Forward only. */
  apply(container: ContainerRef, target?: string): Promise<string>
  /** What the container has applied. Reads the container, never a central table. */
  version(container: ContainerRef): Promise<string | null>
  /**
   * What the CODE expects this container to be at: the newest migration of its set (T-5.4).
   *
   * Reads the folders and nothing else, so it answers without touching a database. That is
   * what makes it usable at boot, before anything is serving, and on every tenant resolution
   * without a query per request.
   */
  expected(container: ContainerRef): string | null
}

export interface ExportResult {
  readonly path: string
  readonly bytes: number
  readonly schemaVersion: string | null
}

export interface ContainerReport {
  readonly locator: string
  readonly sizeBytes: number
  readonly rowCounts: Record<string, number>
  readonly schemaVersion: string | null
  readonly lastExportAt?: string
}

export interface ContainerLifecycle {
  create(tenant: Tenant): Promise<void>
  export(tenant: Tenant, destination: string): Promise<ExportResult>
  /** Irreversible, and only ever reached after a successful export (T-6.3). */
  destroy(tenant: Tenant): Promise<void>
  inspect(tenant: Tenant): Promise<ContainerReport>
}

/** What a data layer must hand back to the framework when it starts. */
export interface DataLayer {
  provider: ConnectionProvider
  migrations: MigrationRunner
  containers: ContainerLifecycle
  managers: Record<string, unknown>
}

export type DataLayerOptions = GeneralConfig['options']
