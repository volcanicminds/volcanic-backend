/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-14.1: PGlite through the Postgres provider (F60). The matrix said `pglite + none` before
// any code held it; these tests hold it. No DATABASE_URL anywhere: the point of PGlite is a
// Postgres that needs no server.
//
// Each `openPglite()` costs a boot of about a second, so the instances are few and shared.
// The session guard on PGlite is proved in session-state.spec.ts, with the rest of the rule.
//
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { start } from '../../db.js'
import {
  PostgresProvider,
  createPostgresProvider,
  openPglite,
  type PgliteDb
} from '../../lib/database/adapters/postgres/index.js'

const PASSWORD = 'pw-123456789'

const rowsOf = async (handle: any, text: string) => (await handle.execute(sql.raw(text))).rows

describe('database/adapters/postgres · PGlite (T-14.1)', function () {
  this.timeout(60000)

  it('boots the data layer from control.engine and serves the managers', async () => {
    const layer: any = await start({ control: { engine: 'pglite' } } as any)
    try {
      expect(layer.provider.engine).toBe('pglite')

      const reached = await layer.migrations.apply({ locator: 'public' })
      expect(reached).toBe(layer.migrations.expected({ locator: 'public' }))
      expect(await layer.migrations.version({ locator: 'public' })).toBe(reached)

      const { userManager: users } = layer
      const control = layer.provider.control()
      await users.createUser(control, { email: 'Anna@Acme.test', password: PASSWORD, confirmed: true })
      expect((await users.retrieveUserByPassword(control, 'anna@acme.test', PASSWORD))?.email).toBe('anna@acme.test')
      // Drizzle wraps the driver's error and 23505 sits on its cause, on PGlite as on a server:
      // the answer must still be the domain one.
      const taken = users.createUser(control, { email: 'anna@acme.test', password: 'other-pw-1234' })
      await expect(taken).rejects.toThrow('Email already registered')
    } finally {
      await layer.shutdown()
    }
  })

  it('serves schema tenants from the same instance outside production', async () => {
    const tenants = { strategy: 'schema', engine: 'postgres' }
    const layer: any = await start({ control: { engine: 'pglite' }, tenants } as any)
    try {
      const acme = { locator: 'acme', tenantId: 'id-acme' }
      await layer.migrations.apply({ locator: 'public' })
      await layer.provider.createSchema('acme')
      expect(await layer.migrations.apply(acme)).toBe(layer.migrations.expected(acme))

      const { userManager: users } = layer
      const tenant = await layer.provider.forLocator('acme', 'id-acme')
      await users.createUser(tenant, { email: 'anna@acme.test', password: PASSWORD })
      expect(await users.retrieveUserByPassword(tenant, 'anna@acme.test', PASSWORD)).toBeTruthy()
      expect(await users.retrieveUserByPassword(layer.provider.control(), 'anna@acme.test', PASSWORD)).toBeNull()
    } finally {
      await layer.shutdown()
    }
  })

  it('keeps the database in control.dataDir across a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volcanic-pglite-'))
    const boot = () => start({ control: { engine: 'pglite', dataDir: dir } } as any) as Promise<any>
    try {
      const first = await boot()
      const reached = await first.migrations.apply({ locator: 'public' })
      await first.userManager.createUser(first.provider.control(), { email: 'kept@acme.test', password: PASSWORD })
      await first.shutdown()

      const second = await boot()
      try {
        expect(await second.migrations.version({ locator: 'public' })).toBe(reached)
        expect(await second.migrations.pending({ locator: 'public' })).toEqual([])
        const control = second.provider.control()
        expect(await second.userManager.retrieveUserByPassword(control, 'kept@acme.test', PASSWORD)).toBeTruthy()
      } finally {
        await second.shutdown()
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('pins the control schema at start, as the pool pins it at connect', async () => {
    const provider = new PostgresProvider({ schema: 'platform', pglite: await openPglite({ schema: 'platform' }) })
    try {
      await provider.createSchema('platform')
      const control: any = provider.control()
      await control.execute(sql.raw('create table widget (tag text)'))
      const where = `select table_schema from information_schema.tables where table_name = 'widget'`
      expect(await rowsOf(control, where)).toEqual([{ table_schema: 'platform' }])
    } finally {
      await provider.shutdown()
    }
  })

  describe('one shared instance', () => {
    let db: PgliteDb
    let provider: PostgresProvider

    before(async () => {
      db = await openPglite()
      provider = new PostgresProvider({ pglite: db })
      const control: any = provider.control()
      await provider.createSchema('acme')
      await control.execute(sql.raw('create table widget (tag text)'))
      await control.execute(sql.raw(`insert into widget (tag) values ('CONTROL PLANE')`))
      await control.execute(sql.raw('create table acme.widget (tag text)'))
      await control.execute(sql.raw(`insert into acme.widget (tag) values ('ACME')`))
    })

    after(async () => {
      await provider.shutdown()
    })

    it("keeps a tenant's raw SQL inside its schema, and leaves the session as it was", async () => {
      const acme: any = await provider.forLocator('acme', 'id-acme')
      expect(await rowsOf(acme, 'select tag from widget')).toEqual([{ tag: 'ACME' }])

      const control: any = provider.control()
      expect(await rowsOf(control, 'select tag from widget')).toEqual([{ tag: 'CONTROL PLANE' }])
      expect(await rowsOf(control, 'show search_path')).toEqual([{ search_path: 'public' }])
    })

    it('takes a container lock once per process, and gives it back', async () => {
      const lock = (fn: () => Promise<unknown>) => provider.withContainerLock('acme', fn)
      let second: unknown = 'not asked'
      const first = await lock(async () => {
        second = await lock(async () => 'second')
        return 'first'
      })
      expect(first).toBe('first')
      expect(second).toBeNull()
      expect(await lock(async () => 'again')).toBe('again')
      // A failing holder gives the lock back too.
      await expect(lock(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
      expect(await lock(async () => 'after a failure')).toBe('after a failure')
    })

    it('refuses by name what needs a server', async () => {
      const acme = { id: 'id-acme', slug: 'acme', locator: 'acme' } as any
      await expect(provider.exportContainer(acme, { schemaVersion: null })).rejects.toThrow(
        'Export (pg_dump) needs a Postgres server'
      )
      const noContainers = 'PGlite cannot run the container strategy'
      expect(() => new PostgresProvider({ pglite: db, strategy: 'container' })).toThrow(noContainers)
      const containers = { control: { engine: 'pglite' }, tenants: { strategy: 'container', engine: 'postgres' } }
      await expect(createPostgresProvider(containers as any)).rejects.toThrow(noContainers)
    })
  })

  it('closes the instance at shutdown', async () => {
    const db = await openPglite()
    const provider = new PostgresProvider({ pglite: db })
    await provider.shutdown()
    expect(db.$client.closed).toBe(true)
  })
})
