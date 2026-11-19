/* eslint-disable @typescript-eslint/no-explicit-any */
//
// A list query keeps its statement per shape (lib/database/query/index.ts). A kept statement
// that carried anything of the request that built it would answer the next request with the
// wrong rows, or with a column its route hides: each test below states one way that could
// happen and checks it does not. On PGlite; the per-container and the connection checks are in
// prepared.spec.ts.
//
// The reference for "the right rows" is the same query with `extraWhere: true`, which is never
// kept and builds its SQL for the request alone.
//
import { customType, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { eq, sql } from 'drizzle-orm'
import { expect } from 'expect'
import { appTables as pgTables } from '../../lib/database/schema/pg.js'
import { executeFind, executeCount } from '../../lib/database/query/index.js'
import { preparedCount, MAX_STATEMENTS_PER_TABLE } from '../../lib/database/prepared.js'
import { migratedPglite, type Migrated } from './fixtures/migrated.js'

const pg = pgTables('public')
const base = { allowWithDeleted: false }
const uncached = { extraWhere: sql`true` }

let db: Migrated
let handle: any

const find = (params: any, o: any = {}) => executeFind<any>(handle, pg.user, params, { ...base, ...o })
const ids = async (params: any, o: any = {}) => (await find(params, o)).records.map((r: any) => r.id)
const kept = () => preparedCount(handle.db, pg.user)

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn()
  } catch (e: any) {
    return e.code ?? `UNCODED: ${e.message}`
  }
  return 'NO_ERROR'
}

describe('database/query · statements kept per shape', () => {
  before(async () => {
    db = await migratedPglite()
    handle = db.control
    await handle.execute(sql`
      insert into "user" (id, external_id, email, username, password, roles, blocked, created_at, updated_at, deleted_at) values
        ('1', 'x-1', 'Anna@acme.test',    'anna',    'hash-a', '{admin,public}', false, to_timestamp(1), to_timestamp(1), null),
        ('2', 'x-2', 'bruno@acme.test',   'bruno',   'hash-b', '{public}',       false, to_timestamp(2), to_timestamp(2), null),
        ('3', 'x-3', 'carla@acme.test',   'carla',   'hash-c', '{editor}',       true,  to_timestamp(3), to_timestamp(3), null),
        ('4', 'x-4', 'dario@beta.test',   null,      'hash-d', '{}',             false, to_timestamp(4), to_timestamp(4), null),
        ('5', 'x-5', '50%_off@beta.test', 'promo',   'hash-e', '{public}',       false, to_timestamp(5), to_timestamp(5), null),
        ('6', 'x-6', 'gone@acme.test',    'gone',    'hash-f', '{public}',       false, to_timestamp(6), to_timestamp(6), to_timestamp(6))
    `)
  })

  after(async () => await db?.close())

  describe('data', () => {
    // Every operator family, each shape asked twice with different values and once more with the
    // first: a statement that kept a value would repeat the first answer.
    const corpus: [string, Record<string, string>[]][] = [
      ['eq', [{ username: 'anna' }, { username: 'bruno' }]],
      ['neq', [{ 'username:neq': 'anna' }, { 'username:neq': 'carla' }]],
      ['eqi', [{ 'email:eqi': 'ANNA@ACME.TEST' }, { 'email:eqi': 'BRUNO@acme.test' }]],
      ['contains', [{ 'email:contains': 'acme' }, { 'email:contains': 'beta' }]],
      ['ncontainsi', [{ 'email:ncontainsi': 'ACME' }, { 'email:ncontainsi': 'BETA' }]],
      ['starts / ends', [{ 'email:starts': 'carla' }, { 'email:ends': 'beta.test' }]],
      ['like', [{ 'email:like': '%@acme%' }, { 'email:like': 'd%' }]],
      ['in, two values', [{ 'id:in': '1,2' }, { 'id:in': '3,4' }]],
      ['nin', [{ 'id:nin': '1,2' }, { 'id:nin': '4,5' }]],
      ['date, ISO and epoch', [{ 'createdAt:gt': '1970-01-01T00:00:02Z' }, { 'createdAt:gt': '4000' }]],
      ['between', [{ 'createdAt:between': '1000..2000' }, { 'createdAt:between': '3000..5000' }]],
      ['nbetween', [{ 'createdAt:nbetween': '1000..2000' }, { 'createdAt:nbetween': '3000..5000' }]],
      ['boolean', [{ blocked: 'true' }, { blocked: 'false' }]],
      ['null', [{ 'username:null': 'true' }, { 'username:null': 'false' }]],
      ['arrays', [{ 'roles:arrayContains': 'admin' }, { 'roles:arrayContains': 'public' }]],
      ['array overlap', [{ 'roles:arrayOverlaps': 'editor,admin' }, { 'roles:arrayOverlaps': 'public' }]],
      [
        '_logic',
        [
          { 'username:eq[a]': 'anna', 'username:eq[b]': 'carla', _logic: 'a OR b' },
          { 'username:eq[a]': 'bruno', 'username:eq[b]': 'promo', _logic: 'a OR b' }
        ]
      ]
    ]

    for (const [name, [first, second]] of corpus) {
      it(`binds the values of each request, never those of the one that built the statement: ${name}`, async () => {
        for (const params of [first, second, first]) {
          const reference = await find(params, uncached)
          const result = await find(params)
          expect(result.records).toEqual(reference.records)
          expect(result.headers).toEqual(reference.headers)
        }
        expect(await ids(first)).not.toEqual(await ids(second))
      })
    }

    it('counts with the values of each request', async () => {
      const count = (params: any) => executeCount(handle, pg.user, params, base)
      expect(await count({ 'email:contains': 'acme' })).toBe(3)
      expect(await count({ 'email:contains': 'beta' })).toBe(2)
      expect(await count({ 'email:contains': 'acme' })).toBe(3)
    })

    it('pages a kept statement with the page of each request', async () => {
      const page = (n: string) => ids({ _sort: 'createdAt', _pageSize: '2', _page: n })
      expect(await page('1')).toEqual(['1', '2'])
      expect(await page('2')).toEqual(['3', '4'])
      expect(await page('3')).toEqual(['5'])
      expect((await find({ _sort: 'createdAt', _pageSize: '2', _page: '2' })).headers).toEqual({
        'v-count': 2,
        'v-total': 5,
        'v-page': 2,
        'v-pageSize': 2,
        'v-pageCount': 3
      })
    })

    it('tells two _logic trees over the same conditions apart', async () => {
      const conditions = { 'email:contains[a]': 'acme', 'blocked:eq[b]': 'true' }
      expect(await ids({ ...conditions, _logic: 'a OR b', _sort: 'id' })).toEqual(['1', '2', '3'])
      expect(await ids({ ...conditions, _logic: 'a AND b', _sort: 'id' })).toEqual(['3'])
      expect(await ids({ ...conditions, _logic: 'a AND NOT b', _sort: 'id' })).toEqual(['1', '2'])
    })

    it('tells two sorts and two selections apart', async () => {
      expect(await ids({ _sort: 'createdAt' })).toEqual(['1', '2', '3', '4', '5'])
      expect(await ids({ _sort: '-createdAt' })).toEqual(['5', '4', '3', '2', '1'])
      expect(Object.keys((await find({ _fields: 'id' })).records[0])).toEqual(['id'])
      expect(Object.keys((await find({ _fields: 'id,email' })).records[0])).toEqual(['id', 'email'])
    })

    it('binds a value its column turns into SQL into the text, and keeps no statement for it', async () => {
      // A custom type may encode a value as SQL. Bound to a placeholder, that SQL would be sent as
      // the value itself, so such a query is built for the request alone.
      const lowered = customType<{ data: string }>({ dataType: () => 'text', toDriver: (v) => sql`lower(${v})` })
      const user = pgTable('user', { id: text('id').primaryKey(), email: lowered('email'), deletedAt: timestamp('deleted_at') })
      const before = preparedCount(handle.db, user)
      const emailOf = async (value: string) =>
        (await executeFind<any>(handle, user, { email: value }, base)).records.map((r: any) => r.id)
      expect(await emailOf('BRUNO@ACME.TEST')).toEqual(['2'])
      expect(await emailOf('CARLA@ACME.TEST')).toEqual(['3'])
      expect(preparedCount(handle.db, user)).toBe(before)
    })
  })

  describe('security', () => {
    it('never hands a column one route shows to a route that hides it', async () => {
      const hidesEmail = { sensitiveFields: ['password', 'email'] }
      for (const order of [
        ['shows', 'hides'],
        ['hides', 'shows']
      ]) {
        for (const route of order) {
          const { records } = await find({ 'id:in': '1,2,3' }, route === 'hides' ? hidesEmail : {})
          for (const record of records) {
            expect('password' in record).toBe(false)
            expect('email' in record).toBe(route === 'shows')
          }
        }
      }
      await find({ _fields: 'id,email' })
      expect(await codeOf(() => find({ _fields: 'id,email' }, hidesEmail))).toBe('QUERY_SENSITIVE_FIELD')
      expect(await codeOf(() => find({ 'email:contains': 'acme' }, hidesEmail))).toBe('QUERY_SENSITIVE_FIELD')
    })

    it('validates every request in full, when its shape is already kept', async () => {
      await find({ 'createdAt:gt': '1000' })
      expect(await codeOf(() => find({ 'createdAt:gt': 'not-a-date' }))).toBe('QUERY_INVALID_VALUE')
      await find({ 'id:in': '1,2' })
      expect(await codeOf(() => find({ 'id:in': '1,' }))).toBe('QUERY_EMPTY_VALUE')
      await find({ _withDeleted: 'true' }, { allowWithDeleted: true })
      expect(await codeOf(() => find({ _withDeleted: 'true' }))).toBe('QUERY_WITH_DELETED_NOT_ALLOWED')
      expect(await codeOf(() => find({ 'password:contains': 'hash' }))).toBe('QUERY_SENSITIVE_FIELD')
    })

    it('applies the page ceiling of each route to a shared statement', async () => {
      const small = await find({ _sort: 'id', _pageSize: '50' }, { maxPageSize: 2 })
      expect(small.records.length).toBe(2)
      expect(small.headers['v-pageSize']).toBe(2)
      const large = await find({ _sort: 'id', _pageSize: '50' })
      expect(large.records.length).toBe(5)
    })

    it('keeps soft-deleted rows out of a shape already read with _withDeleted', async () => {
      const allowed = { allowWithDeleted: true }
      expect(await ids({ 'email:contains': 'acme', _withDeleted: 'true', _sort: 'id' }, allowed)).toEqual(['1', '2', '3', '6'])
      expect(await ids({ 'email:contains': 'acme', _sort: 'id' }, allowed)).toEqual(['1', '2', '3'])
      expect(await ids({ 'email:contains': 'acme', _withDeleted: 'false', _sort: 'id' }, allowed)).toEqual(['1', '2', '3'])
    })

    it('keeps no statement for a route restriction, so each request gets its own rows', async () => {
      // extraWhere is how a consumer writes row-level security: the shape cannot tell one
      // user's condition from another's, so nothing of it is kept.
      const before = kept()
      const asUser = (id: string) => ({ extraWhere: eq(pg.user.id, id) })
      expect(await ids({ 'email:contains': 'test' }, asUser('1'))).toEqual(['1'])
      expect(await ids({ 'email:contains': 'test' }, asUser('2'))).toEqual(['2'])
      expect(await executeCount(handle, pg.user, { 'email:contains': 'test' }, { ...base, ...asUser('3') })).toBe(1)
      expect(kept()).toBe(before)
    })

    it('treats every value as a value, in a kept statement too', async () => {
      for (let round = 0; round < 2; round++) {
        expect(await ids({ username: "' or 1=1 --" })).toEqual([])
        expect(await ids({ 'email:contains': '%' })).toEqual(['5'])
        expect(await ids({ 'email:contains': '_' })).toEqual(['5'])
        expect(await ids({ 'email:contains': "'; drop table \"user\"; --" })).toEqual([])
      }
      expect(await executeCount(handle, pg.user, {}, base)).toBe(5)
    })

    it('refuses one alias for two conditions, instead of dropping one of them', async () => {
      // `_logic` resolves an alias to one condition: the other would vanish from the query.
      const params = { 'email:contains[a]': 'acme', 'username:eq[a]': 'carla', _logic: 'a' }
      expect(await codeOf(() => find(params))).toBe('QUERY_DUPLICATE_CONDITION')
      expect(await codeOf(() => find({ 'email:contains[a]': 'acme', 'username:eq[a]': 'carla' }))).toBe('QUERY_DUPLICATE_CONDITION')
    })
  })

  describe('the statements kept', () => {
    it('keeps one per shape: a value never adds one, a field, an operator, a sort or a list length does', async () => {
      const grows = async (params: any) => {
        const before = kept()
        await find(params)
        return kept() - before
      }
      expect(await grows({ 'username:starts': 'a', _sort: 'username' })).toBe(1)
      expect(await grows({ 'username:starts': 'b', _sort: 'username' })).toBe(0)
      expect(await grows({ 'username:ends': 'a', _sort: 'username' })).toBe(1)
      expect(await grows({ 'username:ends': 'a', _sort: '-username' })).toBe(1)
      expect(await grows({ 'username:ends': 'a', _sort: '-username', _fields: 'id' })).toBe(1)
      expect(await grows({ 'id:in': '1,2,3,4,5,6,7' })).toBe(1)
      expect(await grows({ 'id:in': '7,6,5,4,3,2,1' })).toBe(0)
      expect(await grows({ 'id:in': '1,2,3,4,5,6,7,8' })).toBe(1)
    })

    it('keeps no more than the bound, however many shapes a client makes up', async () => {
      for (let n = 1; n <= MAX_STATEMENTS_PER_TABLE + 20; n++) {
        await find({ 'id:in': Array.from({ length: n }, (_, i) => String(i + 1)).join(',') })
      }
      expect(kept()).toBeLessThanOrEqual(MAX_STATEMENTS_PER_TABLE)
      // The first shapes were dropped: asked again, they are built again and still right.
      expect(await ids({ 'id:in': '2', _sort: 'id' })).toEqual(['2'])
      expect(await ids({ 'id:in': '1,2,3', _sort: 'id' })).toEqual(['1', '2', '3'])
      expect(kept()).toBeLessThanOrEqual(MAX_STATEMENTS_PER_TABLE)
    })
  })
})
