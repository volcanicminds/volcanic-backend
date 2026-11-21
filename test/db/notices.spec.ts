/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The seen marks of the administrators' notices on a migrated container: kept per reader and
// per scope, a second mark keeps the first, and only the cleared marks of the named sources go.
// PGlite always, Postgres with DATABASE_URL.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import type { NoticeReader } from '../../types/global.js'
import { createNoticeManager } from '../../lib/database/managers/notice.js'
import { DATABASE_URL, migratedPglite, migratedPostgres, type Migrated } from './fixtures/migrated.js'

;(global as any).log = {}

const ANNA: NoticeReader = { id: 'id-1', scope: 'tenant' }
const OPERATOR: NoticeReader = { id: 'id-1', scope: 'system' }
const BRUNO: NoticeReader = { id: 'id-2', scope: 'tenant' }

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`notices · seen marks on ${name} (T-7.18)`, function () {
    this.timeout(30000)
    let db: Migrated
    const marks = createNoticeManager()

    before(async () => (db = await open()))
    after(async () => await db?.close())

    it('keeps a mark per reader and per scope, in the container it is written to', async () => {
      await marks.markSeen(db.control, ANNA, ['rag:1', 'rag:2'])
      expect((await marks.seenOf(db.control, ANNA, ['rag:1', 'rag:2', 'rag:3'])).sort()).toEqual(['rag:1', 'rag:2'])
      // The same id in the other table, another reader, another container: none of them see it.
      expect(await marks.seenOf(db.control, OPERATOR, ['rag:1'])).toEqual([])
      expect(await marks.seenOf(db.control, BRUNO, ['rag:1'])).toEqual([])
      expect(await marks.seenOf(db.tenant, ANNA, ['rag:1'])).toEqual([])
      expect(await marks.seenOf(db.control, ANNA, [])).toEqual([])
    })

    it('keeps the first mark when the same notice is marked again', async () => {
      await marks.markSeen(db.tenant, BRUNO, ['rag:x'])
      const read = () => (db.tenant as any).db.execute(sql`select seen_at from notice_seen where reader = ${BRUNO.id}`)
      const first = await read()
      await marks.markSeen(db.tenant, BRUNO, ['rag:x', 'rag:x'])
      const again = await read()
      const rows = (result: any) => (result.rows ?? result).map((row: any) => String(row.seen_at))
      expect(rows(again)).toEqual(rows(first))
    })

    it('forgets the cleared marks of the named sources only, and of the reader only', async () => {
      await marks.markSeen(db.tenant, ANNA, ['rag:keep', 'rag:gone', 'rag_x:other', 'other:gone'])
      await marks.markSeen(db.tenant, OPERATOR, ['rag:gone'])
      // `rag_x` would match a LIKE 'rag_%': the prefix is compared as text.
      expect(await marks.forgetCleared(db.tenant, ANNA, ['rag'], ['rag:keep'])).toBe(1)
      expect((await marks.seenOf(db.tenant, ANNA, ['rag:keep', 'rag:gone', 'rag_x:other', 'other:gone'])).sort()).toEqual([
        'other:gone',
        'rag:keep',
        'rag_x:other'
      ])
      expect(await marks.seenOf(db.tenant, OPERATOR, ['rag:gone'])).toEqual(['rag:gone'])
      // A source with nothing current loses every mark of the reader.
      expect(await marks.forgetCleared(db.tenant, ANNA, ['rag', 'rag_x'], [])).toBe(2)
      expect(await marks.forgetCleared(db.tenant, ANNA, [], [])).toBe(0)
      expect(await marks.seenOf(db.tenant, ANNA, ['other:gone'])).toEqual(['other:gone'])
    })
  })
}

behaviours('PGlite', () => migratedPglite())

if (DATABASE_URL) {
  behaviours('Postgres', () => migratedPostgres({ control: 'test_notice_ctl', tenant: 'test_notice_acme' }))
}
