/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-14.4: a prepared statement belongs to one container (F62).
//
// The statements of the hot paths are kept per database and per table object, and under the
// `schema` strategy a tenant IS its table objects: a cache keyed on anything coarser would hand
// one customer's row to another, which is D-01 again. Proved on PGlite always, and on Postgres
// with DATABASE_URL, where the pool spreads the executions over several connections.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { PostgresProvider, openPglite } from '../../lib/database/adapters/postgres/index.js'
import { createMigrationRunner } from '../../lib/database/migrations/runner.js'
import { createUserManager } from '../../lib/database/managers/user.js'
import { migrationSets } from '../../db.js'

process.env.MFA_DB_SECRET = process.env.MFA_DB_SECRET || 'unit-test-secret-please-change-32xyz'

const URL = process.env.DATABASE_URL
const SCHEMAS = ['test_prep_a', 'test_prep_b']
const users = createUserManager()

async function twoContainers(provider: PostgresProvider) {
  const runner = createMigrationRunner(
    async (container) => ({ handle: (await provider.forLocator(container.locator, container.tenantId!)) as never, locator: container.locator }),
    migrationSets()
  )
  const handles: any[] = []
  for (const locator of SCHEMAS) {
    await provider.dropSchema(locator)
    await provider.createSchema(locator)
    await runner.apply({ locator, tenantId: `id-${locator}` })
    handles.push(await provider.forLocator(locator, `id-${locator}`))
  }
  return handles
}

function suite(engine: string, open: () => Promise<PostgresProvider>) {
  describe(`database/prepared · one statement per container, on ${engine} (T-14.4)`, function () {
    this.timeout(60000)
    let provider: PostgresProvider
    let a: any
    let b: any

    before(async () => {
      provider = await open()
      ;[a, b] = await twoContainers(provider)
    })

    after(async () => {
      for (const locator of SCHEMAS) await provider?.dropSchema(locator)
      await provider?.shutdown()
    })

    it("answers a lookup from the container it was asked on, never from the one that prepared first", async () => {
      const anna: any = await users.createUser(a, { email: 'anna@a.test', password: 'Acme-pw-123456' })
      const bruno: any = await users.createUser(b, { email: 'bruno@b.test', password: 'Beta-pw-123456' })

      // Several rounds, alternating, so that on a pool the executions land on more than one
      // connection, each with its own prepared statements.
      for (let round = 0; round < 8; round++) {
        expect((await users.retrieveUserByExternalId(a, anna.externalId))?.email).toBe('anna@a.test')
        expect(await users.retrieveUserByExternalId(b, anna.externalId)).toBeNull()
        expect((await users.retrieveUserByExternalId(b, bruno.externalId))?.email).toBe('bruno@b.test')
        expect(await users.retrieveUserByExternalId(a, bruno.externalId)).toBeNull()
      }
    })
  })
}

suite('PGlite', async () => new PostgresProvider({ pglite: await openPglite() }))

if (URL) {
  suite('Postgres', async () => new PostgresProvider({ url: URL, schema: 'public', poolMax: 4 }))

  // A named statement is session state: the connection would go back to the pool carrying it,
  // which is what T-3.1 forbids, and a PgBouncer in transaction mode before 1.21 would fail on
  // it. PGlite ignores the name, so only a server can tell.
  describe('database/prepared · the connection goes back to the pool as it came out (T-3.1, T-14.4)', function () {
    this.timeout(60000)
    let provider: PostgresProvider
    let a: any

    before(async () => {
      // One connection, so the lookup and the catalogue read below share a session.
      provider = new PostgresProvider({ url: URL, schema: 'public', poolMax: 1 })
      ;[a] = await twoContainers(provider)
    })

    after(async () => {
      for (const locator of SCHEMAS) await provider?.dropSchema(locator)
      await provider?.shutdown()
    })

    it('leaves no named statement on the connection after a prepared lookup', async () => {
      const anna: any = await users.createUser(a, { email: 'anna@a.test', password: 'Acme-pw-123456' })
      expect((await users.retrieveUserByExternalId(a, anna.externalId))?.email).toBe('anna@a.test')

      const result: any = await a.db.execute(sql`select count(*)::int as n from pg_prepared_statements`)
      expect(result.rows[0].n).toBe(0)
    })
  })
}
