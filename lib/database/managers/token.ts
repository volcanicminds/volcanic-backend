import { eq, sql } from 'drizzle-orm'
import type { TokenManagement, DataHandle, VQuery } from '../../../types/global.js'
import { executeFind, executeCount } from '../query/index.js'
import { runtime, table, column } from './runtime.js'

//
// Machine credentials (T-2.5). Same shape as the user manager, one difference that matters:
// `expiresAt` is written as given and never defaulted here. A credential without an expiry
// must be a decision taken at the API, not an omission that quietly becomes permanent
// (docs/API_V5.md §4).
//
const NAME = 'tokenManager'

export function createTokenManager(): TokenManagement {
  const tokens = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    return { handle, token: table(handle, 'token') }
  }

  // async for the same reason as in user.ts: promise-returning methods reject, never throw.
  const one = async (ctx: unknown, what: string, field: string, value: unknown) => {
    const { handle, token } = tokens(ctx, what)
    const rows = await handle.db.select().from(token).where(eq(column(token, field), value as never)).limit(1)
    return rows[0] ?? null
  }

  return {
    isImplemented: () => true,
    isValidToken: (data: any) => !!data?.name,

    async createToken(ctx: DataHandle, data: any) {
      const { handle, token } = tokens(ctx, 'createToken')
      const rows = await handle.db
        .insert(token)
        .values({
          name: String(data.name),
          description: data.description ?? null,
          roles: data.roles ?? [],
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null
        })
        .returning()
      return rows[0]
    },

    async updateTokenById(ctx: DataHandle, id: string, data: any) {
      const { handle, token } = tokens(ctx, 'updateTokenById')
      const values: Record<string, unknown> = { ...data, updatedAt: new Date() }
      delete values.id
      if (values.expiresAt) values.expiresAt = new Date(values.expiresAt as string)

      const rows = await handle.db
        .update(token)
        .set({ ...values, version: sql`${column(token, 'version')} + 1` })
        .where(eq(column(token, 'id'), id as never))
        .returning()
      return rows[0] ?? null
    },

    async removeTokenById(ctx: DataHandle, id: string) {
      const { handle, token } = tokens(ctx, 'removeTokenById')
      const rows = await handle.db
        .update(token)
        .set({ deletedAt: new Date() })
        .where(eq(column(token, 'id'), id as never))
        .returning()
      return rows.length > 0
    },

    async resetExternalId(ctx: DataHandle, id: string) {
      const { handle, token } = tokens(ctx, 'resetExternalId')
      const externalId = crypto.randomUUID()
      await handle.db.update(token).set({ externalId }).where(eq(column(token, 'id'), id as never))
      return externalId
    },

    retrieveTokenById: async (ctx, id) => await one(ctx, 'retrieveTokenById', 'id', id),
    retrieveTokenByExternalId: async (ctx, externalId) => await one(ctx, 'retrieveTokenByExternalId', 'externalId', externalId),

    async blockTokenById(ctx: DataHandle, id: string, reason: string) {
      const { handle, token } = tokens(ctx, 'blockTokenById')
      await handle.db
        .update(token)
        .set({ blocked: true, blockedReason: reason, blockedAt: new Date(), updatedAt: new Date() })
        .where(eq(column(token, 'id'), id as never))
      return true
    },

    async unblockTokenById(ctx: DataHandle, id: string) {
      const { handle, token } = tokens(ctx, 'unblockTokenById')
      await handle.db
        .update(token)
        .set({ blocked: false, blockedReason: null, blockedAt: null, updatedAt: new Date() })
        .where(eq(column(token, 'id'), id as never))
      return true
    },

    async countQuery(ctx: DataHandle, data: VQuery) {
      const { handle, token } = tokens(ctx, 'countQuery')
      return await executeCount(handle, token, data as never, { dialect: handle.dialect })
    },

    async findQuery(ctx: DataHandle, data: VQuery) {
      const { handle, token } = tokens(ctx, 'findQuery')
      return (await executeFind(handle, token, data as never, { dialect: handle.dialect })) as never
    }
  }
}
