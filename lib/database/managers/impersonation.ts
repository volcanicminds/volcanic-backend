import { eq, and, isNull, gt } from 'drizzle-orm'
import type { ImpersonationManagement, ControlHandle, Impersonation, VQuery } from '../../../types/global.js'
import { executeFind } from '../query/index.js'
import { control, table, column } from './runtime.js'

//
// The impersonation record (T-4.2, docs/SCHEMA_V5.md §3.3).
//
// It lives in the control plane, and every method takes a ControlHandle, so the trail of who
// entered a customer's data cannot be written or read from inside that customer's container.
// A tenant that could edit its own impersonation log would be auditing itself.
//
// Two properties are enforced here rather than left to the caller:
//
//   - a record is never updated except to revoke it. There is no `update`, because the point
//     of the row is that it says what was true when it was written;
//   - `getLive` answers only for a session that is neither revoked nor expired, so a caller
//     cannot forget to check one of the two.
//
const NAME = 'impersonationManager'

export function createImpersonationManager(): ImpersonationManagement {
  const records = (ctx: unknown, what: string) => {
    const handle = control(ctx, `${NAME}.${what}`)
    return { handle, impersonation: table(handle, 'impersonation') }
  }

  return {
    isImplemented: () => true,

    async openImpersonation(ctx: ControlHandle, data) {
      const { handle, impersonation } = records(ctx, 'openImpersonation')
      const rows = await handle.db
        .insert(impersonation)
        .values({
          systemUserId: String(data.systemUserId),
          tenantId: String(data.tenantId),
          targetUserId: String(data.targetUserId),
          reason: String(data.reason),
          ip: data.ip ?? null,
          userAgent: data.userAgent ?? null,
          expiresAt: new Date(data.expiresAt as never)
        })
        .returning()
      return rows[0] as Impersonation
    },

    /**
     * The record, only while it is still a live session.
     *
     * Revoked and expired answer the same `null` on purpose: both mean "this token buys
     * nothing any more", and a caller that had to tell them apart would sooner or later
     * check one and not the other.
     */
    async getImpersonation(ctx: ControlHandle, id: string) {
      const { handle, impersonation } = records(ctx, 'getImpersonation')
      const rows = await handle.db
        .select()
        .from(impersonation)
        .where(
          and(
            eq(column(impersonation, 'id'), id as never),
            isNull(column(impersonation, 'revokedAt')),
            gt(column(impersonation, 'expiresAt'), new Date() as never)
          )
        )
        .limit(1)
      return (rows[0] as Impersonation) ?? null
    },

    async revokeImpersonation(ctx: ControlHandle, id: string) {
      const { handle, impersonation } = records(ctx, 'revokeImpersonation')
      const rows = await handle.db
        .update(impersonation)
        .set({ revokedAt: new Date() })
        .where(and(eq(column(impersonation, 'id'), id as never), isNull(column(impersonation, 'revokedAt'))))
        .returning()
      return rows.length > 0
    },

    async findQuery(ctx: ControlHandle, data: VQuery) {
      const { handle, impersonation } = records(ctx, 'findQuery')
      return (await executeFind(handle, impersonation, data as never, { dialect: handle.dialect })) as never
    }
  }
}
