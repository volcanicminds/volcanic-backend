import { and, eq, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm'
import type { DataHandle, NoticeManagement, NoticeReader } from '../../../types/global.js'
import { runtime, table, column } from './runtime.js'

//
// Which notice each reader has seen, in the container of the reader (lib/util/notices.ts).
//
// The column `scope` holds 'tenant' for a `user` and 'system' for a `system_user`: the control
// container of a deployment without tenants holds both, and an id of one table must never
// read the marks of the other.
//
const NAME = 'noticeManager'

const scopeOf = (reader: NoticeReader) => (reader.scope === 'system' ? 'system' : 'tenant')

export function createNoticeManager(): NoticeManagement {
  const marks = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    const seen = table(handle, 'noticeSeen')
    const col = (name: string) => column(seen, name) as never
    return { handle, seen, col }
  }

  const ofReader = (col: (name: string) => never, reader: NoticeReader): SQL =>
    and(eq(col('reader'), String(reader.id) as never), eq(col('scope'), scopeOf(reader) as never)) as SQL

  return {
    isImplemented: () => true,

    async seenOf(ctx: DataHandle, reader: NoticeReader, notices: readonly string[]) {
      if (notices.length === 0) return []
      const { handle, seen, col } = marks(ctx, 'seenOf')
      const rows = await handle.db
        .select({ notice: col('notice') })
        .from(seen)
        .where(and(ofReader(col, reader), inArray(col('notice'), [...notices] as never[])))
      return rows.map((row: { notice: string }) => row.notice)
    },

    async markSeen(ctx: DataHandle, reader: NoticeReader, notices: readonly string[]) {
      if (notices.length === 0) return
      const { handle, seen } = marks(ctx, 'markSeen')
      const scope = scopeOf(reader)
      await handle.db
        .insert(seen)
        .values([...new Set(notices)].map((notice) => ({ notice, reader: String(reader.id), scope })))
        .onConflictDoNothing()
    },

    async forgetCleared(ctx: DataHandle, reader: NoticeReader, sources: readonly string[], current: readonly string[]) {
      if (sources.length === 0) return 0
      const { handle, seen, col } = marks(ctx, 'forgetCleared')
      // `starts_with` and not LIKE: `_` is a LIKE wildcard and a legal character of a source name.
      const ofSources = or(...sources.map((source) => sql`starts_with(${col('notice')}, ${`${source}:`})`)) as SQL
      const cleared = current.length ? notInArray(col('notice'), [...current] as never[]) : undefined
      const rows = await handle.db
        .delete(seen)
        .where(and(ofReader(col, reader), ofSources, cleared))
        .returning({ notice: col('notice') })
      return rows.length
    }
  }
}
