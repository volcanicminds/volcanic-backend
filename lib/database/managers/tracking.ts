import { eq } from 'drizzle-orm'
import type { TrackingManagement, DataHandle } from '../../../types/global.js'
import { runtime, table, tableIfKnown, column } from './runtime.js'

//
// The audit trail (T-2.5, and the persistence half of T-3.5).
//
// v4 called this the database manager and it only ever wrote changes; worse, in multi-tenant
// it was called without a context, the write threw, the tracker swallowed the exception into
// a log line, and the audit trail was silently empty (D-05). Here the context is a parameter,
// so a call without one cannot compile, and a failed write raises.
//
// A correction to docs/MANAGERS_V5.md §7, made per the precedence rule of EVO_FRAMEWORK.md
// §0: the specification typed `retrieveBy` as returning `Change[]`, the audit history of an
// entity. Its only caller is the tracker, and what the tracker needs is the row as it stands
// BEFORE the request writes to it, which is what the v4 method returned. A method whose
// declared type does not match the single job it exists for is a defect of the document, so
// the document was corrected rather than the caller bent around it.
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

    async addChange(ctx: DataHandle, data: any) {
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
