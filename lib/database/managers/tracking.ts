import { eq } from 'drizzle-orm'
import type { TrackingManagement, DataHandle, NewChange } from '../../../types/global.js'
import { runtime, table, tableIfKnown, column } from './runtime.js'

//
// The audit trail.
//
// The context is a parameter, so a call without one cannot compile, and a failed write raises:
// an audit write that fails quietly leaves the trail empty and nobody told.
//
// `retrieveBy` returns the row as it stands BEFORE the request writes to it, not the audit
// history of the entity: its only caller is the tracker, and that row is what the tracker needs.
//
const NAME = 'trackingManager'

export function createTrackingManager(): TrackingManagement {
  const changes = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    return { handle, change: table(handle, 'change') }
  }

  /**
   * The tracked row as it stands now, for the baseline of the diff.
   *
   * `null` means "no baseline", and it covers two situations the caller does not need to
   * tell apart: the row does not exist (a create), or the table is not one this handle
   * knows, i.e. it belongs to the consumer's own schema. In the second case the consumer
   * supplies the baseline itself by setting `req.trackingData`; the framework does not
   * guess, and it does not pretend the previous values were empty.
   */
  async function retrieveBy(ctx: DataHandle, entityName: string, entityId: string) {
    const handle = runtime(ctx, `${NAME}.retrieveBy`)
    const entity = tableIfKnown(handle, entityName)
    if (!entity) return null

    const id = column(entity, 'id')
    if (!id) return null

    const rows = await handle.db.select().from(entity).where(eq(id, entityId as never)).limit(1)
    return rows[0] ?? null
  }

  return {
    isImplemented: () => true,

    retrieveBy,

    async addChange(ctx: DataHandle, data: NewChange) {
      const { handle, change } = changes(ctx, 'addChange')
      const rows = await handle.db
        .insert(change)
        .values({
          userId: data.userId ?? null,
          tokenId: data.tokenId ?? null,
          impersonationId: data.impersonationId ?? null,
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
