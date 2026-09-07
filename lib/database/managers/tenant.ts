import { eq, isNull, and } from 'drizzle-orm'
import type { TenantManagement, ControlHandle, Tenant, VQuery, TenantHandle } from '../../../types/global.js'
import { executeFind } from '../query/index.js'
import { control, table, column } from './runtime.js'

//
// The registry and the container life cycle (T-2.5).
//
// Every registry method demands a ControlHandle, and the compiler enforces it: in v4 these
// queries ran on `global.connection`, i.e. whatever connection the pool handed over, which is
// how `GET /tenants` could list a `tenant` table copied inside a customer's schema (D-01).
//
// The container half — create, export, destroy, migrate — is declared here and delegated to
// the provider, because "where the data is" is the adapter's business. What is NOT here on
// purpose: destroyContainer stays unimplemented until T-6.3 puts the two-phase flow and the
// mandatory export in front of it. An irreversible operation with no ceremony is worse than a
// missing one.
//
export interface TenantProvider {
  createContainer?(tenant: Tenant): Promise<void>
  openContainer(tenantId: string): Promise<TenantHandle>
  closeContainer?(handle: TenantHandle): Promise<void>
}

const NAME = 'tenantManager'

export function createTenantManager(provider: TenantProvider): TenantManagement {
  const registry = (ctx: unknown, what: string) => {
    const handle = control(ctx, `${NAME}.${what}`)
    return { handle, tenant: table(handle, 'tenant') }
  }

  const notImplemented = (what: string, task: string) => {
    throw new Error(`${NAME}.${what} arrives with ${task}: it is not implemented in this build`)
  }

  return {
    isImplemented: () => true,

    async listTenants(ctx: ControlHandle, query?: VQuery) {
      const { handle, tenant } = registry(ctx, 'listTenants')
      return (await executeFind(handle, tenant, (query ?? {}) as never, { dialect: handle.dialect })) as never
    },

    async getTenant(ctx: ControlHandle, id: string) {
      const { handle, tenant } = registry(ctx, 'getTenant')
      const rows = await handle.db.select().from(tenant).where(eq(column(tenant, 'id'), id as never)).limit(1)
      return (rows[0] as Tenant) ?? null
    },

    async getTenantBySlug(ctx: ControlHandle, slug: string) {
      const { handle, tenant } = registry(ctx, 'getTenantBySlug')
      const rows = await handle.db
        .select()
        .from(tenant)
        .where(and(eq(column(tenant, 'slug'), slug as never), isNull(column(tenant, 'deletedAt'))))
        .limit(1)
      return (rows[0] as Tenant) ?? null
    },

    async createTenant(ctx: ControlHandle, data: any) {
      const { handle, tenant } = registry(ctx, 'createTenant')

      const rows = await handle.db
        .insert(tenant)
        .values({
          name: String(data.name),
          slug: String(data.slug),
          strategy: String(data.strategy ?? 'schema'),
          engine: String(data.engine ?? handle.dialect),
          // Sanitised once, before it is stored, by the caller (docs/SCHEMA_V5.md §4): the
          // stored value and the used value are the same string, which v4 did not guarantee.
          locator: String(data.locator ?? data.slug),
          config: data.config ?? {},
          status: 'active'
        })
        .returning()

      const created = rows[0] as Tenant
      if (provider.createContainer) await provider.createContainer(created)
      return created
    },

    async updateTenant(ctx: ControlHandle, id: string, data: any) {
      const { handle, tenant } = registry(ctx, 'updateTenant')
      const values: Record<string, unknown> = { ...data, updatedAt: new Date() }
      // What says where the data is cannot be edited in place: moving a container is a
      // migration with an export, not a field update.
      delete values.id
      delete values.locator
      delete values.engine
      delete values.strategy

      const rows = await handle.db.update(tenant).set(values).where(eq(column(tenant, 'id'), id as never)).returning()
      return (rows[0] as Tenant) ?? null
    },

    async suspendTenant(ctx: ControlHandle, id: string) {
      const { handle, tenant } = registry(ctx, 'suspendTenant')
      const rows = await handle.db
        .update(tenant)
        .set({ status: 'suspended', updatedAt: new Date() })
        .where(eq(column(tenant, 'id'), id as never))
        .returning()
      return rows.length > 0
    },

    async restoreTenant(ctx: ControlHandle, id: string) {
      const { handle, tenant } = registry(ctx, 'restoreTenant')
      const rows = await handle.db
        .update(tenant)
        .set({ status: 'active', deletedAt: null, updatedAt: new Date() })
        .where(eq(column(tenant, 'id'), id as never))
        .returning()
      return rows.length > 0
    },

    async softDeleteTenant(ctx: ControlHandle, id: string) {
      const { handle, tenant } = registry(ctx, 'softDeleteTenant')
      const rows = await handle.db
        .update(tenant)
        .set({ deletedAt: new Date(), status: 'archived', updatedAt: new Date() })
        .where(eq(column(tenant, 'id'), id as never))
        .returning()
      return rows.length > 0
    },

    openContainer: async (tenantId: string) => await provider.openContainer(tenantId),

    async closeContainer(handle: TenantHandle) {
      if (provider.closeContainer) await provider.closeContainer(handle)
    },

    migrateContainer: async (tenantId: string) => notImplemented('migrateContainer', 'phase 5, migrations') as never,
    exportContainer: async () => notImplemented('exportContainer', 'T-6.2') as never,
    destroyContainer: async () => notImplemented('destroyContainer', 'T-6.3, which puts a two-phase flow and a mandatory export in front of it') as never,
    inspectContainer: async () => notImplemented('inspectContainer', 'T-6.2') as never
  }
}
