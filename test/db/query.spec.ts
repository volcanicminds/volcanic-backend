/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-2.4, against a container migrated on PGlite: the right rows for a query it accepts, a 400
// with the right code for one it refuses (docs/MAGIC_QUERY_V5.md §11).
//
// The error cases carry most of the value here. Each one of them is a v4 behaviour that
// answered a different question instead of refusing: a skipped sort field, a degraded
// `_logic`, a range split by an ISO timestamp, an empty value turned into the string
// `notFound`, a filter on a password hash.
//
import { eq, sql } from 'drizzle-orm'
import { expect } from 'expect'
import { PgDialect } from 'drizzle-orm/pg-core'
import { appTables as pgTables } from '../../lib/database/schema/pg.js'
import { parseQuery, executeFind, executeCount } from '../../lib/database/query/index.js'
import { migratedPglite, type Migrated } from './fixtures/migrated.js'

const pg = pgTables('public')
const options = { allowWithDeleted: false }

let db: Migrated
let handle: any

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e: any) {
    return e.code
  }
  return 'NO_ERROR'
}

const find = (params: any, o: any = {}) => executeFind(handle, pg.user, params, { ...options, ...o })

describe('database/query (T-2.4)', () => {
  // The control plane is `public`, so `pg.user` is the table these rows land in.
  before(async () => {
    db = await migratedPglite()
    handle = db.control
    await handle.execute(sql`
      insert into "user" (id, external_id, email, username, password, created_at, updated_at, deleted_at) values
        ('1', 'x-1', 'Anna@acme.test',    'anna',    'hash-a', to_timestamp(1), to_timestamp(1), null),
        ('2', 'x-2', 'bruno@acme.test',   'bruno',   'hash-b', to_timestamp(2), to_timestamp(2), null),
        ('3', 'x-3', 'carla@acme.test',   'carla',   'hash-c', to_timestamp(3), to_timestamp(3), null),
        ('4', 'x-4', 'deleted@acme.test', 'deleted', 'hash-d', to_timestamp(4), to_timestamp(4), to_timestamp(4))
    `)
  })

  after(async () => await db?.close())

  describe('filtering', () => {
    it('matches exactly, and case matters unless the operator says otherwise', async () => {
      expect((await find({ 'email:eq': 'Anna@acme.test' })).records.length).toBe(1)
      // v4 answered this differently depending on an environment variable.
      expect((await find({ 'email:eq': 'anna@acme.test' })).records.length).toBe(0)
      expect((await find({ 'email:eqi': 'anna@acme.test' })).records.length).toBe(1)
    })

    it('treats wildcards in a value as text, not as pattern', async () => {
      // `amount:contains=50%` searched for everything starting with 50 in v4.
      expect((await find({ 'email:contains': 'acme' })).records.length).toBe(3)
      expect((await find({ 'email:contains': 'ac%me' })).records.length).toBe(0)
      expect((await find({ 'email:like': '%acme%' })).records.length).toBe(3)
    })

    it('reads a range written with .., and refuses one written any other way', async () => {
      expect((await find({ 'createdAt:between': '1500..3500' })).records.length).toBe(2)
      expect(codeOf(() => parseQuery(pg.user, { 'createdAt:between': '2026-01-01:2026-12-31' }, options))).toBe(
        'QUERY_INVALID_RANGE'
      )
    })

    it('hides soft-deleted rows unless the route allows asking for them', async () => {
      expect((await find({})).records.length).toBe(3)
      expect((await find({ _withDeleted: 'true' }, { allowWithDeleted: true })).records.length).toBe(4)
      expect(codeOf(() => parseQuery(pg.user, { _withDeleted: 'true' }, options))).toBe('QUERY_WITH_DELETED_NOT_ALLOWED')
    })

    it('counts what the filter matches, ignoring the page', async () => {
      expect(await executeCount(handle, pg.user, { 'email:contains': 'acme' }, options)).toBe(3)
    })

    it('applies a route restriction the URL cannot argue with (extraWhere)', async () => {
      // v4 carried this as a fourth argument of executeFindQuery, and consumers used it for
      // row-level security. It is AND-ed last, so no `_logic` a caller writes can reach around
      // it: the OR below matches everyone and still returns only the row the route allows.
      const only = { extraWhere: eq(pg.user.id, '2') }
      expect((await find({}, only)).records.map((r: any) => r.id)).toEqual(['2'])
      expect(await executeCount(handle, pg.user, {}, { ...options, ...only })).toBe(1)

      const wideOpen = { 'email:contains[a]': 'acme', 'id:eq[b]': '1', _logic: 'a OR b' }
      expect((await find(wideOpen, only)).records.map((r: any) => r.id)).toEqual(['2'])
    })
  })

  describe('reserved parameters', () => {
    it('sorts with a leading minus and refuses a field that does not exist', async () => {
      const down = await find({ _sort: '-createdAt' })
      expect(down.records.map((r: any) => r.id)).toEqual(['3', '2', '1'])
      // v4 logged a warning and returned an unsorted list.
      expect(codeOf(() => parseQuery(pg.user, { _sort: '-nope' }, options))).toBe('QUERY_UNKNOWN_FIELD')
    })

    it('pages from 1 and reports what it applied', async () => {
      const page = await find({ _page: '2', _pageSize: '2', _sort: 'createdAt' })
      expect(page.records.map((r: any) => r.id)).toEqual(['3'])
      expect(page.headers).toEqual({ 'v-count': 1, 'v-total': 3, 'v-page': 2, 'v-pageSize': 2, 'v-pageCount': 2 })
    })

    it('clamps an oversized page instead of trusting it', () => {
      const parsed = parseQuery(pg.user, { _pageSize: '10000' }, { ...options, maxPageSize: 100 })
      expect(parsed.pageSize).toBe(100)
    })

    it('refuses a page number below one', () => {
      expect(codeOf(() => parseQuery(pg.user, { _page: '0' }, options))).toBe('QUERY_INVALID_PAGE')
    })
  })

  describe('_logic', () => {
    it('combines aliased conditions', async () => {
      const found = await find({
        'username:eq[a]': 'anna',
        'username:eq[b]': 'bruno',
        _logic: 'a OR b'
      })
      expect(found.records.map((r: any) => r.id).sort()).toEqual(['1', '2'])
    })

    it('respects AND before OR, and parentheses over both', async () => {
      const params = {
        'username:eq[a]': 'anna',
        'username:eq[b]': 'bruno',
        'email:contains[c]': 'acme',
        _logic: '(a OR b) AND c'
      }
      expect((await find(params)).records.length).toBe(2)
    })

    it('reports every way it can be wrong, instead of degrading to AND', () => {
      const base = { 'username:eq[a]': 'anna', 'username:eq[b]': 'bruno' }
      expect(codeOf(() => parseQuery(pg.user, { ...base, _logic: 'a AND' }, options))).toBe('QUERY_LOGIC_INVALID')
      expect(codeOf(() => parseQuery(pg.user, { ...base, _logic: 'a AND (b' }, options))).toBe('QUERY_LOGIC_INVALID')
      expect(codeOf(() => parseQuery(pg.user, { ...base, _logic: 'a AND zzz' }, options))).toBe(
        'QUERY_LOGIC_UNKNOWN_ALIAS'
      )
      expect(codeOf(() => parseQuery(pg.user, { ...base, _logic: 'a' }, options))).toBe('QUERY_LOGIC_UNUSED_ALIAS')
      expect(codeOf(() => parseQuery(pg.user, { 'username:eq': 'anna', _logic: 'a' }, options))).toBe(
        'QUERY_LOGIC_MISSING_ALIAS'
      )
    })

    it('stops on an expression built to exhaust the parser', () => {
      const deep = '('.repeat(50) + 'a' + ')'.repeat(50)
      expect(codeOf(() => parseQuery(pg.user, { 'username:eq[a]': 'anna', _logic: deep }, options))).toBe(
        'QUERY_LOGIC_TOO_COMPLEX'
      )
      const long = 'a OR '.repeat(200) + 'a'
      expect(codeOf(() => parseQuery(pg.user, { 'username:eq[a]': 'anna', _logic: long }, options))).toBe(
        'QUERY_LOGIC_TOO_COMPLEX'
      )
    })
  })

  describe('refusals', () => {
    it('never lets a sensitive field into a query', () => {
      // v4 allowed filtering on the password hash, which is an oracle.
      expect(codeOf(() => parseQuery(pg.user, { 'password:contains': 'hash' }, options))).toBe('QUERY_SENSITIVE_FIELD')
      expect(codeOf(() => parseQuery(pg.user, { _sort: 'password' }, options))).toBe('QUERY_SENSITIVE_FIELD')
      expect(codeOf(() => parseQuery(pg.user, { _fields: 'password' }, options))).toBe('QUERY_SENSITIVE_FIELD')
    })

    it('refuses an unknown field, an unknown operator and a wrongly cased one', () => {
      expect(codeOf(() => parseQuery(pg.user, { 'nope:eq': 'x' }, options))).toBe('QUERY_UNKNOWN_FIELD')
      expect(codeOf(() => parseQuery(pg.user, { 'email:nope': 'x' }, options))).toBe('QUERY_UNKNOWN_OPERATOR')
      // Operator names are matched exactly, case included: v4 accepted :ISEMPTY.
      expect(codeOf(() => parseQuery(pg.user, { 'email:CONTAINS': 'x' }, options))).toBe('QUERY_UNKNOWN_OPERATOR')
      // And the refusal names the operator that was meant (T-10.33).
      expect(() => parseQuery(pg.user, { 'email:CONTAINS': 'x' }, options)).toThrow(/did you mean 'contains'/)
      expect(() => parseQuery(pg.user, { 'roles:arraycontains': 'x' }, options)).toThrow(/did you mean 'arrayContains'/)
    })

    it('refuses an empty value and a repeated condition', () => {
      expect(codeOf(() => parseQuery(pg.user, { 'email:contains': '' }, options))).toBe('QUERY_EMPTY_VALUE')
      expect(codeOf(() => parseQuery(pg.user, { 'roles:in': 'a,,b' }, options))).toBe('QUERY_EMPTY_VALUE')

      // The same field and operator twice with no alias is ambiguous, and v4 silently kept the
      // last one, so a caller narrowing a search got a different result than the URL says.
      // A query string can carry a repeated key, so this is reachable from outside.
      expect(codeOf(() => parseQuery(pg.user, { 'email:contains': ['a', 'b'] as never }, options))).toBe(
        'QUERY_DUPLICATE_CONDITION'
      )
    })

    it('refuses a value the column cannot hold, rather than coercing it into one it can', () => {
      // Coercion follows the COLUMN, not the shape of the string (docs/MAGIC_QUERY_V5.md §6).
      // Each of these is a value that looks fine until the column is consulted.
      expect(codeOf(() => parseQuery(pg.user, { 'confirmed:eq': 'yes' }, options))).toBe('QUERY_INVALID_VALUE')
      expect(codeOf(() => parseQuery(pg.user, { 'mfaLastUsedCounter:eq': 'many' }, options))).toBe(
        'QUERY_INVALID_VALUE'
      )
      expect(codeOf(() => parseQuery(pg.user, { 'createdAt:eq': 'last tuesday' }, options))).toBe(
        'QUERY_INVALID_VALUE'
      )
      // And the one that must NOT be refused, or the rule would be "digits are dates": all
      // digits on a date column is epoch milliseconds, which is what a client sends back.
      expect(codeOf(() => parseQuery(pg.user, { 'createdAt:eq': '1700000000000' }, options))).toBe('NO_ERROR')
    })

    it('refuses a relation the route does not join', () => {
      expect(codeOf(() => parseQuery(pg.user, { _relations: 'client' }, options))).toBe('QUERY_RELATION_NOT_ALLOWED')
      expect(codeOf(() => parseQuery(pg.user, { 'client.name:eq': 'acme' }, options))).toBe(
        'QUERY_RELATION_NOT_ALLOWED'
      )
    })
  })

  describe('operators', () => {
    it('matches case-insensitively with ILIKE', () => {
      const parsed = parseQuery(pg.user, { 'email:containsi': 'acme' }, options)
      expect(new PgDialect().sqlToQuery(parsed.where!).sql).toContain('ilike')
    })

    it('offers the array and json operators', () => {
      for (const operator of [
        'arrayContains',
        'arrayContainedBy',
        'arrayOverlaps',
        'jsonHasKey',
        'jsonHasAllKeys',
        'jsonHasAnyKey'
      ]) {
        expect(codeOf(() => parseQuery(pg.user, { [`roles:${operator}`]: 'admin' }, options))).toBe('NO_ERROR')
      }
    })

    it('does not carry :raw over from v4', () => {
      expect(codeOf(() => parseQuery(pg.user, { 'email:raw': "= 'x' or 1=1" }, options))).toBe('QUERY_UNKNOWN_OPERATOR')
    })
  })
})
