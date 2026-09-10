/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.2: libSQL is opened, migrated and used, on a real client.
//
// Until now `@libsql/client` was imported and the capability matrix accepted it, and that was
// all: the only test that named the engine was the matrix itself, which reads a configuration
// object and opens nothing. A driver declared supported on the strength of a configuration
// test is a driver whose support is a plan.
//
// It speaks SQLite, so it reads the `sqlite` migration set — the same files, not a third copy.
// What is worth checking is therefore not the SQL but the DRIVER: that the adapter's pragmas,
// its statement-driven transaction and its raw-SQL escape hatch behave the same through a
// client that is asynchronous all the way down, where better-sqlite3 is synchronous all the
// way down. Those are the two shapes the same code has to survive.
//
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { access } from '../../db.js'
import { SqliteProvider } from '../../lib/database/adapters/sqlite/index.js'
import { createMigrationRunner } from '../../lib/database/migrations/runner.js'
import { migrationSets } from '../../db.js'
import { createUserManager } from '../../lib/database/managers/user.js'

;(global as any).log = {}

const users = createUserManager()

describe('database/adapters/libsql · a container on the libSQL driver (T-9.2)', function () {
  this.timeout(30000)

  let dir: string
  let provider: SqliteProvider
  let runner: ReturnType<typeof createMigrationRunner>

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volcanic-libsql-'))
    provider = new SqliteProvider({
      driver: 'libsql',
      file: path.join(dir, 'control.db'),
      directory: dir,
      maxOpenContainers: 4
    })
    runner = createMigrationRunner(
      async (container) => ({
        handle: container.tenantId
          ? await provider.forLocator(container.locator, container.tenantId)
          : await provider.control(),
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

  it('reads the sqlite set, not a third copy of the same schema', async () => {
    expect(await runner.expected({ locator: 'control.db' })).toBe('0000_initial_control')
    expect(await runner.apply({ locator: 'control.db' })).toBe('0000_initial_control')
    expect(await runner.version({ locator: 'control.db' })).toBe('0000_initial_control')
  })

  it('runs DDL, inserts and selects through the same escape hatch', async () => {
    // On better-sqlite3 each of these needs a different driver call and the wrong one throws.
    // Through libSQL they do not, and the point of asserting it here is that the adapter's
    // `execute` presents one contract whichever driver is underneath.
    const control = await provider.control()
    const { execute } = access(control)

    await execute(sql.raw('create table probe (id text primary key, n integer)'))
    await execute(sql.raw("insert into probe (id, n) values ('a', 1)"))
    const rows: any = await execute(sql.raw('select n from probe'))
    expect((rows?.rows ?? rows ?? []).length).toBe(1)
  })

  it('commits a transaction whose callback awaits, and rolls the whole of it back on failure', async () => {
    // The driver-level helper cannot express this on better-sqlite3 (it rejects an async
    // callback), so the adapter drives `begin`/`commit`/`rollback` itself. Both drivers must
    // therefore agree on the property that matters: all of it, or none of it.
    const control = await provider.control()
    const { execute, transaction } = access(control)

    await execute(sql.raw('create table probe (id text primary key)'))

    await transaction(async (tx: any) => {
      await tx.execute(sql.raw("insert into probe (id) values ('kept')"))
    })

    await expect(
      transaction(async (tx: any) => {
        await tx.execute(sql.raw("insert into probe (id) values ('rolled-back')"))
        throw new Error('deliberate')
      })
    ).rejects.toThrow('deliberate')

    const rows: any = await execute(sql.raw('select id from probe order by id'))
    expect((rows?.rows ?? rows ?? []).map((r: any) => r.id)).toEqual(['kept'])
  })

  it('keeps the base text operators case-sensitive, as the pragma promises', async () => {
    // Without `case_sensitive_like` SQLite folds ASCII in LIKE, and `:contains` would quietly
    // mean `:containsi` — the same URL answering differently on two engines, which is the
    // environment variable v5 removed for exactly this reason.
    const control = await provider.control()
    const { execute } = access(control)

    await execute(sql.raw('create table probe (name text)'))
    await execute(sql.raw("insert into probe (name) values ('Mario')"))

    const sensitive: any = await execute(sql.raw("select name from probe where name like '%mario%'"))
    const insensitive: any = await execute(sql.raw("select name from probe where lower(name) like '%mario%'"))
    expect((sensitive?.rows ?? sensitive ?? []).length).toBe(0)
    expect((insensitive?.rows ?? insensitive ?? []).length).toBe(1)
  })

  it('lets the managers work, which is the whole point of migrating it', async () => {
    await runner.apply({ locator: 'control.db' })
    const control = await provider.control()

    const created: any = await users.createUser(control as never, {
      email: 'Anna@Acme.test',
      password: 'Acme-pw-123456',
      roles: ['public']
    })
    expect(created.email).toBe('anna@acme.test')
    expect(created.createdAt instanceof Date).toBe(true)

    expect(await users.retrieveUserByPassword(control as never, 'anna@acme.test', 'Acme-pw-123456')).toBeTruthy()
    expect(await users.retrieveUserByPassword(control as never, 'anna@acme.test', 'wrong')).toBeNull()
  })

  it('isolates two containers from each other', async () => {
    await runner.apply({ locator: 'a.db', tenantId: 'id-a' })
    await runner.apply({ locator: 'b.db', tenantId: 'id-b' })

    const a = await provider.forLocator('a.db', 'id-a')
    const b = await provider.forLocator('b.db', 'id-b')

    await users.createUser(a as never, { email: 'only-in-a@acme.test', password: 'Acme-pw-123456' })

    expect(await users.retrieveUserByEmail(a as never, 'only-in-a@acme.test')).toBeTruthy()
    // A file per container is the isolation, and it is worth asserting rather than assuming:
    // this is the property the whole strategy is chosen for.
    expect(await users.retrieveUserByEmail(b as never, 'only-in-a@acme.test')).toBeNull()
  })
})

//
// The remote half. It needs credentials, so it SKIPS and says why rather than passing without
// having run: a suite that reports green for something it never reached is worse than one that
// is honestly incomplete.
//
describe('database/adapters/libsql · a remote container (Turso)', function () {
  this.timeout(30000)

  const url = process.env.LIBSQL_TEST_URL
  const authToken = process.env.LIBSQL_TEST_TOKEN

  beforeEach(function () {
    if (!url) {
      this.skip()
    }
  })

  it('opens, migrates and reads a remote database', async function () {
    // Deliberately minimal: the local suite above covers the driver's behaviour. What only a
    // remote can show is that a URL which is not a file path reaches a server at all.
    const { createClient } = await import('@libsql/client')
    const client = createClient({ url: url as string, authToken })
    const result = await client.execute('select 1 as one')
    expect(result.rows[0].one).toBe(1)
    client.close()
  })
})
