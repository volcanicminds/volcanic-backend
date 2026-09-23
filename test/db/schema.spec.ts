/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-2.1. The schema exists twice, once per dialect, so the risk worth testing is drift
// between the two files — and the property T-3.1 depends on: that a Postgres container is
// chosen by qualifying the tables, not by mutating a connection.
//
import { expect } from 'expect'
import { getTableConfig as pgConfig } from 'drizzle-orm/pg-core'
import { getTableConfig as sqliteConfig } from 'drizzle-orm/sqlite-core'
import * as pg from '../../lib/database/schema/pg.js'
import * as sqlite from '../../lib/database/schema/sqlite.js'

const columns = (config: any) => config.columns.map((c: any) => c.name).sort()
const column = (config: any, name: string) => config.columns.find((c: any) => c.name === name)

describe('database/schema · parity between the two dialects', () => {
  const pgApp = pg.appTables('public')
  const liteApp = sqlite.appTables()
  const pgReg = pg.registryTables('public')
  const liteReg = sqlite.registryTables()

  it('declares the same tables on both engines', () => {
    // `migration` joined them in T-5.1: every container carries its own schema version, so
    // the table is part of the set that defines a container.
    // `session` joined them in T-11.1: the registry of live sessions lives in the container of
    // the subject it belongs to, so it is part of what defines a container too.
    // `authFlow`, `externalIdentity` and `accessLog` joined them in T-12.8 for the same reason,
    // `setting` in T-12.46.
    expect(Object.keys(pgApp).sort()).toEqual([
      'accessLog', 'authFlow', 'change', 'externalIdentity', 'migration', 'session', 'setting', 'token', 'user'
    ])
    expect(Object.keys(liteApp).sort()).toEqual(Object.keys(pgApp).sort())
    expect(Object.keys(pgReg).sort()).toEqual([
      'destructionRequest', 'identityProvider', 'impersonation', 'systemUser', 'tenant'
    ])
    expect(Object.keys(liteReg).sort()).toEqual(Object.keys(pgReg).sort())
  })

  it('declares the same columns, table by table', () => {
    for (const name of Object.keys(pgApp)) {
      expect(columns(sqliteConfig((liteApp as any)[name]))).toEqual(columns(pgConfig((pgApp as any)[name])))
    }
    for (const name of Object.keys(pgReg)) {
      expect(columns(sqliteConfig((liteReg as any)[name]))).toEqual(columns(pgConfig((pgReg as any)[name])))
    }
  })

  it('declares the same indexes, with the same names and the same uniqueness (T-12.9)', () => {
    const indexes = (config: any) =>
      config.indexes.map((i: any) => `${i.config.name}${i.config.unique ? ' unique' : ''}${i.config.where ? ' partial' : ''}`).sort()
    for (const name of ['authFlow', 'externalIdentity', 'accessLog', 'session']) {
      expect(indexes(sqliteConfig((liteApp as any)[name]))).toEqual(indexes(pgConfig((pgApp as any)[name])))
    }
    expect(indexes(sqliteConfig(liteReg.identityProvider))).toEqual(indexes(pgConfig(pgReg.identityProvider)))
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

describe('database/schema · sqlite', () => {
  it('stores instants as epoch milliseconds, so no local time reaches the database', () => {
    const user = sqliteConfig(sqlite.appTables().user)
    expect(column(user, 'created_at').getSQLType()).toBe('integer')
    expect(column(user, 'created_at').mapToDriverValue(new Date('2026-09-07T10:00:00Z'))).toBe(1788775200000)
  })

  it('stores booleans as 0/1 and string arrays as JSON', () => {
    const user = sqliteConfig(sqlite.appTables().user)
    expect(column(user, 'confirmed').mapToDriverValue(true)).toBe(1)
    expect(column(user, 'roles').mapToDriverValue(['admin'])).toBe('["admin"]')
  })
})
