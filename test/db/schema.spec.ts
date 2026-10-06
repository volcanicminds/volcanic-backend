/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-2.1. The risk worth testing is drift between what the schema file declares and what the
// migrations build, and the property T-3.1 depends on: that a Postgres container is chosen by
// qualifying the tables, not by mutating a connection.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { getTableConfig as pgConfig } from 'drizzle-orm/pg-core'
import * as pg from '../../lib/database/schema/pg.js'
import { migratedPglite, type Migrated } from './fixtures/migrated.js'

const columns = (config: any) => config.columns.map((c: any) => c.name).sort()
const column = (config: any, name: string) => config.columns.find((c: any) => c.name === name)

// One line per column and per index, so a failure prints the difference and nothing else.
const declared = (tables: Record<string, any>) =>
  Object.values(tables)
    .flatMap((table) => {
      const config = pgConfig(table)
      const pk = new Set([
        ...config.columns.filter((c) => c.primary).map((c) => c.name),
        ...config.primaryKeys.flatMap((p) => p.columns.map((c) => c.name))
      ])
      return [
        ...config.columns.map(
          (c) => `${config.name}.${c.name} ${c.getSQLType()}${c.notNull ? ' not null' : ''}${pk.has(c.name) ? ' pk' : ''}`
        ),
        ...config.indexes.map(
          (i) => `${config.name} ${i.config.name}${i.config.unique ? ' unique' : ''}${i.config.where ? ' partial' : ''}`
        )
      ]
    })
    .sort()

const migrated = async (handle: any, schema: string) => {
  const cols = await handle.execute(sql`
    select c.relname as "table", a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
      a.attnotnull as "notNull", coalesce(a.attnum = any(i.indkey), false) as pk
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_index i on i.indrelid = c.oid and i.indisprimary
    where n.nspname = ${schema} and c.relkind = 'r'`)
  const indexes = await handle.execute(sql`
    select t.relname as "table", x.relname as name, i.indisunique as "unique", i.indpred is not null as partial
    from pg_index i
    join pg_class x on x.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = ${schema} and not i.indisprimary`)
  return [
    ...cols.rows.map((c: any) => `${c.table}.${c.name} ${c.type}${c.notNull ? ' not null' : ''}${c.pk ? ' pk' : ''}`),
    ...indexes.rows.map((i: any) => `${i.table} ${i.name}${i.unique ? ' unique' : ''}${i.partial ? ' partial' : ''}`)
  ].sort()
}

describe('database/schema · the tables', () => {
  const pgApp = pg.appTables('public')
  const pgReg = pg.registryTables('public')

  it('declares the tables of a container and of the registry', () => {
    // `migration` joined them in T-5.1: every container carries its own schema version, so
    // the table is part of the set that defines a container.
    // `session` joined them in T-11.1: the registry of live sessions lives in the container of
    // the subject it belongs to, so it is part of what defines a container too.
    // `authFlow`, `externalIdentity` and `accessLog` joined them in T-12.8 for the same reason,
    // `setting` in T-12.46.
    expect(Object.keys(pgApp).sort()).toEqual([
      'accessLog', 'authFlow', 'change', 'externalIdentity', 'migration', 'session', 'setting', 'token', 'user'
    ])
    expect(Object.keys(pgReg).sort()).toEqual([
      'destructionRequest', 'governanceLog', 'identityProvider', 'impersonation', 'systemUser', 'tenant'
    ])
  })

  it('names the unique indexes the flows rely on (T-12.9)', () => {
    const indexes = (config: any) =>
      config.indexes.map((i: any) => `${i.config.name}${i.config.unique ? ' unique' : ''}${i.config.where ? ' partial' : ''}`).sort()
    expect(indexes(pgConfig(pgApp.authFlow))).toContain('auth_flow_subject_uq unique partial')
    expect(indexes(pgConfig(pgApp.externalIdentity))).toContain('external_identity_key_uq unique')
  })

  it('keeps the registry out of a tenant container', () => {
    // v4 synchronised every entity into every tenant schema, so each container carried a
    // copy of the `tenant` table — which is what made a poisoned connection able to list
    // the wrong registry (D-01). A container holds application data and nothing else.
    expect(Object.keys(pgApp)).not.toContain('tenant')
    expect(Object.keys(pgApp)).not.toContain('systemUser')
    // A tenant's IdP secret sits in the control plane, never inside the container it serves (F38).
    expect(Object.keys(pgApp)).not.toContain('identityProvider')
    // The governance log outlives the container it would otherwise be destroyed with (F76).
    expect(Object.keys(pgApp)).not.toContain('governanceLog')
  })

  it('keeps the access log append-only (F44)', () => {
    const log = pgConfig(pgApp.accessLog)
    expect(columns(log)).not.toContain('updated_at')
    expect(columns(log)).not.toContain('deleted_at')
  })
})

describe('database/schema · postgres', () => {
  it('qualifies a container with the schema name, so no session state is needed', () => {
    const acme = pgConfig(pg.appTables('tenant_acme').user)
    const globex = pgConfig(pg.appTables('tenant_globex').user)

    expect(acme.schema).toBe('tenant_acme')
    expect(globex.schema).toBe('tenant_globex')
    expect(acme.name).toBe('user')
  })

  it('stores every instant with its zone', () => {
    const user = pgConfig(pg.appTables('public').user)
    for (const name of ['created_at', 'updated_at', 'deleted_at', 'confirmed_at']) {
      expect(column(user, name).getSQLType()).toBe('timestamp with time zone')
    }
  })

  it('keeps the audit trail append-only', () => {
    const change = pgConfig(pg.appTables('public').change)
    expect(columns(change)).not.toContain('updated_at')
    expect(columns(change)).not.toContain('deleted_at')
    expect(column(change, 'created_at')).toBeDefined()
  })

  it('makes email and external id unique, and username unique only when present', () => {
    const user = pgConfig(pg.appTables('public').user)
    const unique = user.indexes.filter((i: any) => i.config.unique).map((i: any) => i.config.name)
    expect(unique).toEqual(expect.arrayContaining(['user_email_uq', 'user_external_id_uq', 'user_username_uq']))

    const username: any = user.indexes.find((i: any) => i.config.name === 'user_username_uq')
    expect(username?.config?.where).toBeDefined() // partial: many rows may have no username
  })

  it('locates a tenant with one field, not with a pair of engine-specific ones', () => {
    const tenant = pgConfig(pg.registryTables('public').tenant)
    expect(columns(tenant)).toContain('locator')
    expect(columns(tenant)).not.toContain('db_schema') // v4 had dbSchema + dbName, and neither
    expect(columns(tenant)).not.toContain('db_name') //  could describe a file container
  })
})

//
// The schema file declares, drizzle-kit writes the migrations, and the runner applies those: a
// column declared and never generated would pass every test that does not touch it. So what the
// migrations build is held against what the file declares, in both sets.
//
describe('database/schema · what the migrations build', () => {
  let db: Migrated

  before(async () => {
    db = await migratedPglite()
  })

  after(async () => await db?.close())

  it('builds the declared tables, columns and indexes, in the control set and in the tenant set', async () => {
    const { control, tenant } = db.schemas
    expect(await migrated(db.control, control)).toEqual(
      declared({ ...pg.appTables(control), ...pg.registryTables(control) })
    )
    expect(await migrated(db.control, tenant)).toEqual(declared(pg.appTables(tenant)))
  })
})
