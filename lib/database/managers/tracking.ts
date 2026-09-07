import { and, eq, desc } from 'drizzle-orm'
import type { TrackingManagement, DataHandle } from '../../../types/global.js'
import { runtime, table, column } from './runtime.js'

//
// The audit trail (T-2.5, and the persistence half of T-3.5).
//
// v4 called this the database manager and it only ever wrote changes; worse, in multi-tenant
// it was called without a context, the write threw, the tracker swallowed the exception into
// a log line, and the audit trail was silently empty (D-05). Here the context is a parameter,
// so a call without one cannot compile, and a failed write raises.
//
const NAME = 'trackingManager'

export function createTrackingManager(): TrackingManagement {
  const changes = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    return { handle, change: table(handle, 'change') }
  }

  return {
    isImplemented: () => true,

    async retrieveBy(ctx: DataHandle, entityName: string, entityId: string) {
      const { handle, change } = changes(ctx, 'retrieveBy')
      return await handle.db
        .select()
        .from(change)
        .where(and(eq(column(change, 'entityName'), entityName as never), eq(column(change, 'entityId'), entityId as never)))
        .orderBy(desc(column(change, 'createdAt')))
    },

    async addChange(ctx: DataHandle, data: any) {
      const { handle, change } = changes(ctx, 'addChange')
      const rows = await handle.db
        .insert(change)
        .values({
          userId: data.userId ?? null,
          tokenId: data.tokenId ?? null,
          status: String(data.status),
          entityName: String(data.entityName),
          entityId: String(data.entityId),
          contents: data.contents ?? {}
        })
        .returning()
      return rows[0]
    }
  }
}
