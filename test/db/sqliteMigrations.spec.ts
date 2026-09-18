/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.1: a SQLite container is created, migrated, and used.
//
// Before this, SQLite was an engine the framework could open and could not prepare. The
// adapter existed, containers opened and closed under an LRU, Litestream replicated them, and
// the capability matrix declared two serverless combinations supported — while the only
// committed migrations said `timestamp with time zone` and `USING btree`, so applying them to
// SQLite failed on the first statement. Nothing in the suite noticed, because nothing ever
// asked SQLite to have tables.
//
// So the assertion here is deliberately end to end: migrate a real file, then go through the
// MANAGERS rather than through raw SQL. A test that creates the tables by hand and then reads
// them proves that SQLite can hold rows; this one proves the framework can put them there.
//
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import { SqliteProvider } from '../../lib/database/adapters/sqlite/index.js'
import { createMigrationRunner } from '../../lib/database/migrations/runner.js'
import { migrationSets, migrationDialect } from '../../db.js'
import { createUserManager } from '../../lib/database/managers/user.js'
import { createTenantManager } from '../../lib/database/managers/tenant.js'

;(global as any).log = {}

const users = createUserManager()

describe('database/migrations · a SQLite container, migrated (T-9.1)', function () {
  this.timeout(30000)

  let dir: string
  let provider: SqliteProvider
  let runner: ReturnType<typeof createMigrationRunner>

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volcanic-sqlite-mig-'))
    provider = new SqliteProvider({ file: path.join(dir, 'control.db'), directory: dir, maxOpenContainers: 4 })

    // The same wiring `db.ts` builds, with the dialects a SQLite deployment declares.
    runner = createMigrationRunner(
      async (container) => ({
        handle: container.tenantId
          ? await provider.forLocator(container.locator, container.tenantId)
          : await provider.control(),
        // No schema to enter: on this engine the container is the file, and the handle opened it.
        locator: undefined,
        dialect: 'sqlite'
      }),
      migrationSets(),
      { control: 'sqlite', tenant: 'sqlite' }
    )
  })

  afterEach(async () => {
    await provider.shutdown()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('applies the control set and records the version inside the file', async () => {
    expect(await runner.version({ locator: 'control.db' })).toBeNull()

    const applied = await runner.apply({ locator: 'control.db' })
    expect(applied).toBe('0001_sessions_control')

    // The version lives IN the container, never in a central table: when a container is
    // restored from a backup its schema version has to travel back with it.
    expect(await runner.version({ locator: 'control.db' })).toBe('0001_sessions_control')
    expect(await runner.pending({ locator: 'control.db' })).toEqual([])
  })

  it('gives the control plane the registry, and a tenant container none of it', async () => {
    await runner.apply({ locator: 'control.db' })
    await runner.apply({ locator: 'acme.db', tenantId: 'id-acme' })

    const tablesOf = async (handle: any) => {
      const rows: any = await handle.execute("select name from sqlite_master where type = 'table' order by name")
      return (rows?.rows ?? rows ?? []).map((r: any) => r.name).filter((n: string) => !n.startsWith('sqlite_'))
    }

    const control = await tablesOf(await provider.control())
    const tenant = await tablesOf(await provider.forLocator('acme.db', 'id-acme'))

    expect(control).toEqual(expect.arrayContaining(['tenant', 'system_user', 'impersonation', 'destruction_request']))
    // Invariant 7, on this engine too: outside the customer's container goes only what you
    // could publish, and the registry of every other customer is the clearest example of what
    // you could not.
    expect(tenant).toEqual(['change', 'migration', 'session', 'token', 'user'])
  })

  it('lets the managers work through the schema they were given', async () => {
    await runner.apply({ locator: 'control.db' })
    const control = await provider.control()

    const created: any = await users.createUser(control as never, {
      email: 'Anna@Acme.test',
      password: 'Acme-pw-123456',
      roles: ['public']
    })
    expect(created.email).toBe('anna@acme.test')
    expect(created.password.startsWith('$2b$12$')).toBe(true)

    // A timestamp round-trips as a Date and not as the integer it is stored as: the mapping is
    // the adapter's job, and a consumer reading epoch milliseconds would be reading the
    // storage instead of the value.
    expect(created.createdAt instanceof Date).toBe(true)

    expect(await users.retrieveUserByPassword(control as never, 'anna@acme.test', 'Acme-pw-123456')).toBeTruthy()
    expect(await users.retrieveUserByPassword(control as never, 'anna@acme.test', 'wrong')).toBeNull()

    // The registry is readable too, which is what makes this a control plane and not just a file.
    const tenants = createTenantManager({ openContainer: async () => control as never })
    const registered: any = await tenants.createTenant(control as never, {
      name: 'Acme',
      slug: 'acme',
      locator: 'acme.db',
      strategy: 'container',
      engine: 'sqlite'
    })
    expect(registered.slug).toBe('acme')
    expect(await tenants.getTenantBySlug(control as never, 'acme')).toBeTruthy()
  })

  it('refuses a dialect it has no migrations for, instead of applying none and reporting success', async () => {
    // The failure this guards against is not an exception, it is a SUCCESS: before T-9.1 an
    // engine with no set loaded zero files, applied zero of them, and answered "done" to a
    // deployment whose tables were never created. The first query then failed somewhere else,
    // saying something unrelated.
    const orphan = createMigrationRunner(
      async () => ({ handle: await provider.control(), locator: undefined, dialect: 'sqlite' }),
      { 'control:pg': migrationSets()['control:pg'] },
      { control: 'sqlite', tenant: 'sqlite' }
    )

    await expect(orphan.apply({ locator: 'control.db' })).rejects.toThrow(
      /No 'control' migrations exist for dialect 'sqlite'/
    )
  })

  it('maps an engine name to the folder its SQL lives in', () => {
    // libSQL speaks SQLite, so it reads the same set: two folders, not three.
    expect(migrationDialect('sqlite')).toBe('sqlite')
    expect(migrationDialect('libsql')).toBe('sqlite')
    expect(migrationDialect('postgres')).toBe('pg')
    expect(migrationDialect(undefined)).toBe('pg')
  })
})
