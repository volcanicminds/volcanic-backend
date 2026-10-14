/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Against a real Postgres. Skipped when DATABASE_URL is absent, so `npm test` stays
// runnable without docker; the CI job that owns a database runs it.
//
// What is worth testing here is not "drizzle works" but the property the framework rests on:
// after reading a tenant's container, the connection is not left pointing at it. PGlite hands
// out a single connection, so the leak needs a pool to be seen.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { PostgresProvider, escapeIdentifier } from '../../lib/database/adapters/postgres/index.js'

const URL = process.env.DATABASE_URL
const suite = URL ? describe : describe.skip

describe('database/adapters/postgres · identifiers', () => {
  it('refuses an identifier that could carry SQL', () => {
    expect(() => escapeIdentifier('tenant_acme')).not.toThrow()
    expect(() => escapeIdentifier('public; drop schema public cascade')).toThrow()
    expect(() => escapeIdentifier('"quoted"')).toThrow()
    expect(escapeIdentifier('tenant_acme')).toBe('"tenant_acme"')
  })
})

suite('database/adapters/postgres · against a real database', function () {
  this.timeout(30000)

  let provider: PostgresProvider
  const ACME = 'test_tenant_acme'
  const GLOBEX = 'test_tenant_globex'

  before(async () => {
    provider = new PostgresProvider({ url: URL, schema: 'public', poolMax: 1 })
    const control: any = provider.control()

    for (const schema of [ACME, GLOBEX]) {
      await provider.dropSchema(schema)
      await provider.createSchema(schema)
    }
    await control.execute(sql`drop table if exists widget`)
    await control.execute(sql`create table widget (tag text)`)
    await control.execute(sql`insert into widget (tag) values ('CONTROL PLANE')`)
    for (const [schema, tag] of [[ACME, 'ACME'], [GLOBEX, 'GLOBEX']]) {
      await control.execute(sql.raw(`create table ${schema}.widget (tag text)`))
      await control.execute(sql.raw(`insert into ${schema}.widget (tag) values ('${tag}')`))
    }
  })

  after(async () => {
    await provider.dropSchema(ACME)
    await provider.dropSchema(GLOBEX)
    await provider.shutdown()
  })

  it('builds tables that carry their own schema into the SQL', async () => {
    const acme: any = await provider.forLocator(ACME, 'acme-id')
    const globex: any = await provider.forLocator(GLOBEX, 'globex-id')

    const query = acme.db.select().from(acme.tables.user).toSQL()
    expect(query.sql).toContain(`"${ACME}"."user"`)
    expect(globex.db.select().from(globex.tables.user).toSQL().sql).toContain(`"${GLOBEX}"."user"`)
    // Same drizzle instance, same pool: only the table objects differ.
    expect(acme.db).toBe(globex.db)
  })

  it('does not leave the connection pointing at a container', async () => {
    // The pool has ONE connection, so a leak would be deterministic rather than occasional.
    const acme: any = await provider.forLocator(ACME, 'acme-id')
    const inside = await acme.execute(sql.raw(`select tag from ${ACME}.widget limit 1`))
    expect(inside.rows[0].tag).toBe('ACME')

    const control: any = provider.control()
    const after = await control.execute(sql`select tag from widget limit 1`)
    expect(after.rows[0].tag).toBe('CONTROL PLANE')

    const path = await control.execute(sql`select current_setting('search_path') as sp`)
    expect(path.rows[0].sp).toBe('public')
  })

  it('confines a SET LOCAL to its transaction', async () => {
    const control: any = provider.control()
    await control.transaction(async (tx: any) => {
      await tx.execute(sql.raw(`set local search_path to ${ACME}`))
      const inside = await tx.execute(sql`select tag from widget limit 1`)
      expect(inside.rows[0].tag).toBe('ACME')
    })

    const after = await control.execute(sql`select tag from widget limit 1`)
    expect(after.rows[0].tag).toBe('CONTROL PLANE')
  })

  it('keeps the registry on the control handle only', async () => {
    const control: any = provider.control()
    const tenant: any = await provider.forLocator(ACME, 'acme-id')
    expect(control.registry).toBeDefined()
    expect(tenant.registry).toBeUndefined()
  })

  it('runs text SQL with bound parameters inside the tenant, and leaves the connection as it found it (T-16.2)', async () => {
    const acme: any = await provider.forLocator(ACME, 'acme-id')
    // Unqualified, as a package that knows no locator writes it: the tenant's table, never the control plane's.
    expect((await acme.raw.query('select tag from widget where tag = $1', ['ACME'])).rows).toEqual([{ tag: 'ACME' }])

    const control: any = provider.control()
    expect((await control.raw.query('select tag from widget')).rows).toEqual([{ tag: 'CONTROL PLANE' }])
    expect((await control.raw.query(`select current_setting('search_path') as sp`)).rows[0].sp).toBe('public')
  })

  it('rolls a text SQL transaction back whole, and commits a whole one (T-16.2)', async () => {
    const acme: any = await provider.forLocator(ACME, 'acme-id')
    await expect(
      acme.raw.transaction(async (query: any) => {
        await query('insert into widget (tag) values ($1)', ['HALF'])
        throw new Error('stopped halfway')
      })
    ).rejects.toThrow('stopped halfway')
    expect((await acme.raw.query('select count(*)::int as n from widget where tag = $1', ['HALF'])).rows[0].n).toBe(0)

    const counted = await acme.raw.transaction(async (query: any) => {
      await query('insert into widget (tag) values ($1)', ['WHOLE'])
      return (await query('select count(*)::int as n from widget')).rows[0].n
    })
    expect(counted).toBe(2)
    await acme.raw.query('delete from widget where tag = $1', ['WHOLE'])
  })
})
