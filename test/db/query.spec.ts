/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-2.4. The same battery on both dialects: identical results where the capability exists,
// a 400 with the right code where it does not (docs/MAGIC_QUERY_V5.md §11).
//
// The error cases carry most of the value here. Each one of them is a v4 behaviour that
// answered a different question instead of refusing: a skipped sort field, a degraded
// `_logic`, a range split by an ISO timestamp, an empty value turned into the string
// `notFound`, a filter on a password hash.
//
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sql } from 'drizzle-orm'
import { expect } from 'expect'
import { getTableConfig, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { PgDialect } from 'drizzle-orm/pg-core'
import { appTables as sqliteTables } from '../../lib/database/schema/sqlite.js'
import { appTables as pgTables } from '../../lib/database/schema/pg.js'
import { parseQuery, executeFind, executeCount } from '../../lib/database/query/index.js'

const lite = sqliteTables()
const pg = pgTables('public')
const options = { dialect: 'sqlite' as const, allowWithDeleted: false }

let handle: any

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e: any) {
    return e.code
  }
  return 'NO_ERROR'
}

const find = (params: any, o: any = {}) => executeFind(handle, lite.user, params, { ...options, ...o })

// The fixture table is generated FROM the schema, not written by hand: a hand-written copy
// drifts, and then the query tests pass against a table the framework does not have. Real
// migrations arrive in phase 5 and replace this.
const createTableSql = (table: any) => {
  const config = getTableConfig(table)
  const columns = config.columns
    .map((c: any) => `"${c.name}" ${c.getSQLType()}${c.primary ? ' primary key' : ''}`)
    .join(', ')
  return `create table "${config.name}" (${columns})`
}

before(() => {
  const db = new Database(':memory:')
  db.pragma('case_sensitive_like = ON')
  db.exec(createTableSql(lite.user))
  db.exec(`
    insert into user (id, email, username, password, created_at, updated_at) values
      ('1', 'Anna@acme.test',  'anna',  'hash-a', 1000, 1000),
      ('2', 'bruno@acme.test', 'bruno', 'hash-b', 2000, 2000),
      ('3', 'carla@acme.test', 'carla', 'hash-c', 3000, 3000);
    insert into user (id, email, username, password, created_at, updated_at, deleted_at) values
      ('4', 'deleted@acme.test', 'deleted', 'hash-d', 4000, 4000, 4000);
  `)
  handle = { db: drizzle(db) }
})

describe('database/query · filtering', () => {
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
    expect(codeOf(() => parseQuery(lite.user, { 'createdAt:between': '2026-01-01:2026-12-31' }, options))).toBe(
      'QUERY_INVALID_RANGE'
    )
  })

  it('hides soft-deleted rows unless the route allows asking for them', async () => {
    expect((await find({})).records.length).toBe(3)
    expect((await find({ _withDeleted: 'true' }, { allowWithDeleted: true })).records.length).toBe(4)
    expect(codeOf(() => parseQuery(lite.user, { _withDeleted: 'true' }, options))).toBe('QUERY_WITH_DELETED_NOT_ALLOWED')
  })

  it('counts what the filter matches, ignoring the page', async () => {
    expect(await executeCount(handle, lite.user, { 'email:contains': 'acme' }, options)).toBe(3)
  })
})

describe('database/query · reserved parameters', () => {
  it('sorts with a leading minus and refuses a field that does not exist', async () => {
    const down = await find({ _sort: '-createdAt' })
    expect(down.records.map((r: any) => r.id)).toEqual(['3', '2', '1'])
    // v4 logged a warning and returned an unsorted list.
    expect(codeOf(() => parseQuery(lite.user, { _sort: '-nope' }, options))).toBe('QUERY_UNKNOWN_FIELD')
  })

  it('pages from 1 and reports what it applied', async () => {
    const page = await find({ _page: '2', _pageSize: '2', _sort: 'createdAt' })
    expect(page.records.map((r: any) => r.id)).toEqual(['3'])
    expect(page.headers).toEqual({ 'v-count': 1, 'v-total': 3, 'v-page': 2, 'v-pageSize': 2, 'v-pageCount': 2 })
  })

  it('clamps an oversized page instead of trusting it', () => {
    const parsed = parseQuery(lite.user, { _pageSize: '10000' }, { ...options, maxPageSize: 100 })
    expect(parsed.pageSize).toBe(100)
  })

  it('refuses a page number below one', () => {
    expect(codeOf(() => parseQuery(lite.user, { _page: '0' }, options))).toBe('QUERY_INVALID_PAGE')
  })
})

describe('database/query · _logic', () => {
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
    expect(codeOf(() => parseQuery(lite.user, { ...base, _logic: 'a AND' }, options))).toBe('QUERY_LOGIC_INVALID')
    expect(codeOf(() => parseQuery(lite.user, { ...base, _logic: 'a AND (b' }, options))).toBe('QUERY_LOGIC_INVALID')
    expect(codeOf(() => parseQuery(lite.user, { ...base, _logic: 'a AND zzz' }, options))).toBe('QUERY_LOGIC_UNKNOWN_ALIAS')
    expect(codeOf(() => parseQuery(lite.user, { ...base, _logic: 'a' }, options))).toBe('QUERY_LOGIC_UNUSED_ALIAS')
    expect(codeOf(() => parseQuery(lite.user, { 'username:eq': 'anna', _logic: 'a' }, options))).toBe(
      'QUERY_LOGIC_MISSING_ALIAS'
    )
  })

  it('stops on an expression built to exhaust the parser', () => {
    const deep = '('.repeat(50) + 'a' + ')'.repeat(50)
    expect(codeOf(() => parseQuery(lite.user, { 'username:eq[a]': 'anna', _logic: deep }, options))).toBe(
      'QUERY_LOGIC_TOO_COMPLEX'
    )
    const long = 'a OR '.repeat(200) + 'a'
    expect(codeOf(() => parseQuery(lite.user, { 'username:eq[a]': 'anna', _logic: long }, options))).toBe(
      'QUERY_LOGIC_TOO_COMPLEX'
    )
  })
})

describe('database/query · refusals', () => {
  it('never lets a sensitive field into a query', () => {
    // v4 allowed filtering on the password hash, which is an oracle.
    expect(codeOf(() => parseQuery(lite.user, { 'password:contains': 'hash' }, options))).toBe('QUERY_SENSITIVE_FIELD')
    expect(codeOf(() => parseQuery(lite.user, { _sort: 'password' }, options))).toBe('QUERY_SENSITIVE_FIELD')
    expect(codeOf(() => parseQuery(lite.user, { _fields: 'password' }, options))).toBe('QUERY_SENSITIVE_FIELD')
  })

  it('refuses an unknown field, an unknown operator and a wrongly cased one', () => {
    expect(codeOf(() => parseQuery(lite.user, { 'nope:eq': 'x' }, options))).toBe('QUERY_UNKNOWN_FIELD')
    expect(codeOf(() => parseQuery(lite.user, { 'email:nope': 'x' }, options))).toBe('QUERY_UNKNOWN_OPERATOR')
    // Operator names are lowercase and matched exactly: v4 accepted :ISEMPTY.
    expect(codeOf(() => parseQuery(lite.user, { 'email:CONTAINS': 'x' }, options))).toBe('QUERY_UNKNOWN_OPERATOR')
  })

  it('refuses an empty value and a repeated condition', () => {
    expect(codeOf(() => parseQuery(lite.user, { 'email:contains': '' }, options))).toBe('QUERY_EMPTY_VALUE')
    expect(codeOf(() => parseQuery(lite.user, { 'roles:in': 'a,,b' }, options))).toBe('QUERY_EMPTY_VALUE')
  })

  it('refuses a relation the route does not join', () => {
    expect(codeOf(() => parseQuery(lite.user, { _relations: 'client' }, options))).toBe('QUERY_RELATION_NOT_ALLOWED')
    expect(codeOf(() => parseQuery(lite.user, { 'client.name:eq': 'acme' }, options))).toBe('QUERY_RELATION_NOT_ALLOWED')
  })
})

describe('database/query · engines', () => {
  it('uses ILIKE on postgres and folded LIKE on sqlite for the same operator', () => {
    const onPg = parseQuery(pg.user, { 'email:containsi': 'acme' }, { dialect: 'postgres' })
    const onLite = parseQuery(lite.user, { 'email:containsi': 'acme' }, options)
    expect(new PgDialect().sqlToQuery(onPg.where!).sql).toContain('ilike')
    expect(new SQLiteSyncDialect().sqlToQuery(onLite.where!).sql).toContain('lower')
  })

  it('offers array and json operators on postgres', () => {
    expect(codeOf(() => parseQuery(pg.user, { 'roles:arrayContains': 'admin' }, { dialect: 'postgres' }))).toBe('NO_ERROR')
  })

  it('refuses them on sqlite by name, instead of emulating them differently', () => {
    for (const operator of ['arrayContains', 'arrayContainedBy', 'arrayOverlaps', 'jsonHasKey', 'jsonHasAllKeys', 'jsonHasAnyKey']) {
      expect(codeOf(() => parseQuery(lite.user, { [`roles:${operator}`]: 'admin' }, options))).toBe(
        'QUERY_OPERATOR_NOT_SUPPORTED_BY_ENGINE'
      )
    }
  })

  it('does not carry :raw over from v4', () => {
    expect(codeOf(() => parseQuery(lite.user, { 'email:raw': "= 'x' or 1=1" }, options))).toBe('QUERY_UNKNOWN_OPERATOR')
  })
})
