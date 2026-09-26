import { and, asc, eq } from 'drizzle-orm'
import type {
  ControlHandle,
  IdentityProvider,
  IdentityProviderManagement,
  IdentityProviderType,
  OidcProviderSettings
} from '../../../types/global.js'
import { encrypt, decrypt } from '../crypto.js'
import { control, table, column } from './runtime.js'

//
// A tenant's own identity providers (F38), in the control plane registry and never in
// `tenant.config`, which is serialized to whoever reads the tenant.
//
// The client secret is encrypted with the function that encrypts the MFA seed (`../crypto.ts`,
// key `MFA_DB_SECRET` with `JWT_SECRET` as fallback) and decrypted here, because the core may not
// import the data layer's crypto. Only `get` returns it: `list`, `create` and `update` answer the
// provider without it, so a listing route cannot leak it by forgetting to strip a field.
//
const NAME = 'identityProviderManager'

interface ProviderRow {
  id: string
  tenantId: string
  key: string
  type: IdentityProviderType
  status: 'active' | 'disabled'
  config: OidcProviderSettings
  secretEnc: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

const toProvider = (row: ProviderRow): IdentityProvider => ({
  id: row.id,
  tenantId: row.tenantId,
  key: row.key,
  type: row.type,
  status: row.status,
  config: row.config,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

export function createIdentityProviderManager(): IdentityProviderManagement {
  const providers = (ctx: unknown, what: string) => {
    const handle = control(ctx, `${NAME}.${what}`)
    return { handle, provider: table(handle, 'identityProvider') }
  }
  const whereKey = (provider: ReturnType<typeof providers>['provider'], tenantId: string, key: string) =>
    and(eq(column(provider, 'tenantId'), String(tenantId) as never), eq(column(provider, 'key'), String(key) as never))

  return {
    isImplemented: () => true,

    async list(ctx: ControlHandle, tenantId: string) {
      const { handle, provider } = providers(ctx, 'list')
      const rows = await handle.db
        .select()
        .from(provider)
        .where(eq(column(provider, 'tenantId'), String(tenantId) as never))
        .orderBy(asc(column(provider, 'key')))
      return (rows as ProviderRow[]).map(toProvider)
    },

    async get(ctx: ControlHandle, tenantId: string, key: string) {
      const { handle, provider } = providers(ctx, 'get')
      const rows = await handle.db.select().from(provider).where(whereKey(provider, tenantId, key)).limit(1)
      const row = rows[0] as ProviderRow | undefined
      if (!row) return null
      return { ...toProvider(row), clientSecret: row.secretEnc ? await decrypt(row.secretEnc) : null }
    },

    async create(ctx: ControlHandle, data) {
      const { handle, provider } = providers(ctx, 'create')
      const rows = await handle.db
        .insert(provider)
        .values({
          tenantId: String(data.tenantId),
          key: String(data.key),
          type: data.type,
          status: data.status ?? 'active',
          config: data.config,
          secretEnc: data.clientSecret ? await encrypt(String(data.clientSecret)) : null
        })
        .returning()
      return toProvider(rows[0] as ProviderRow)
    },

    /** `clientSecret`: absent keeps the stored one, null removes it, a string replaces it. */
    async update(ctx: ControlHandle, tenantId: string, key: string, patch) {
      const { handle, provider } = providers(ctx, 'update')
      const set: Record<string, unknown> = { updatedAt: new Date() }
      if (patch.status !== undefined) set.status = patch.status
      if (patch.config !== undefined) set.config = patch.config
      if (patch.clientSecret !== undefined) {
        set.secretEnc = patch.clientSecret ? await encrypt(String(patch.clientSecret)) : null
      }
      const rows = await handle.db.update(provider).set(set).where(whereKey(provider, tenantId, key)).returning()
      return rows[0] ? toProvider(rows[0] as ProviderRow) : null
    },

    async remove(ctx: ControlHandle, tenantId: string, key: string) {
      const { handle, provider } = providers(ctx, 'remove')
      const rows = await handle.db
        .delete(provider)
        .where(whereKey(provider, tenantId, key))
        .returning({ id: column(provider, 'id') })
      return rows.length > 0
    },

    async removeAll(ctx: ControlHandle, tenantId: string) {
      const { handle, provider } = providers(ctx, 'removeAll')
      const rows = await handle.db
        .delete(provider)
        .where(eq(column(provider, 'tenantId'), String(tenantId) as never))
        .returning({ id: column(provider, 'id') })
      return rows.length
    }
  }
}
