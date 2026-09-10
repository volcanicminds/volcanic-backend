/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-2.3. On this engine a container is a file, so what is worth testing is the file: where
// it may be created, how many stay open, and that two containers cannot see each other.
//
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { SqliteProvider, resolveContainerFile } from '../../lib/database/adapters/sqlite/index.js'

// `log?.d` still throws when `log` is undeclared: optional chaining guards a property, not an
// identifier. Declared here so this suite stands alone.
;(global as any).log = {}

describe('database/adapters/sqlite · container paths', () => {
  const root = '/srv/volcanic/tenants'

  it('keeps a container inside the configured directory', () => {
    expect(resolveContainerFile(root, 'acme.db')).toBe(path.join(root, 'acme.db'))
    expect(resolveContainerFile(root, 'nested/acme.db')).toBe(path.join(root, 'nested/acme.db'))
  })

  it('refuses a locator that escapes it', () => {
    // The registry is data. Data must never be able to name a path of its own choosing.
    expect(() => resolveContainerFile(root, '../../etc/passwd')).toThrow()
    expect(() => resolveContainerFile(root, '/etc/passwd')).toThrow()
    expect(() => resolveContainerFile(root, '')).toThrow()
  })
})

describe('database/adapters/sqlite · files', function () {
  this.timeout(20000)

  let dir: string
  let provider: SqliteProvider

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volcanic-sqlite-'))
    provider = new SqliteProvider({ file: ':memory:', directory: dir, maxOpenContainers: 2 })
  })

  afterEach(async () => {
    await provider.shutdown()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('creates one file per container, and they cannot see each other', async () => {
    const acme: any = await provider.forLocator('acme.db', 'acme-id')
    const globex: any = await provider.forLocator('globex.db', 'globex-id')

    await acme.db.run(sql`create table widget (tag text)`)
    await acme.db.run(sql`insert into widget (tag) values ('ACME')`)
    await globex.db.run(sql`create table widget (tag text)`)
    await globex.db.run(sql`insert into widget (tag) values ('GLOBEX')`)

    expect((await acme.execute(sql`select tag from widget`))[0].tag).toBe('ACME')
    expect((await globex.execute(sql`select tag from widget`))[0].tag).toBe('GLOBEX')
    expect(fs.existsSync(path.join(dir, 'acme.db'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'globex.db'))).toBe(true)
  })

  it('reuses an open container instead of opening it twice', async () => {
    const first = await provider.forLocator('acme.db', 'acme-id')
    const second = await provider.forLocator('acme.db', 'acme-id')
    expect(second).toBe(first)
  })

  it('closes the least recently used container when the bound is reached', async () => {
    // Every live container is an open descriptor and a WAL: without the bound, a thousand
    // tenants exhaust the process file table.
    const acme: any = await provider.forLocator('acme.db', 'a')
    await acme.db.run(sql`create table widget (tag text)`)
    await provider.forLocator('globex.db', 'g')
    await provider.forLocator('initech.db', 'i') // over the bound of 2: acme is evicted

    const reopened: any = await provider.forLocator('acme.db', 'a')
    expect(reopened).not.toBe(acme)
    // The data is in the file, so reopening finds it: eviction closes a handle, not a container.
    expect(await reopened.execute(sql`select count(*) as n from widget`)).toEqual([{ n: 0 }])
  })

  // T-7.2: the bound only fires when a new container arrives, so a deployment that goes
  // quiet after a busy hour keeps every descriptor it opened until the process ends.
  it('closes a container nobody has touched, without waiting for a new one', async () => {
    const idle = new SqliteProvider({ directory: dir, maxOpenContainers: 10, containerIdleMs: 60_000 })
    try {
      await idle.forLocator('quiet.db', 'q')
      await idle.forLocator('busy.db', 'b')
      expect((idle as any).open.size).toBe(2)

      // The timer is asked for its decision directly rather than waited on: a test that
      // sleeps for the sweep interval is a test nobody runs.
      await idle.forLocator('busy.db', 'b')
      const closed = await idle.closeIdleContainers(Date.now() + 120_000)

      // On this engine an open container is a file handle and a WAL, and the limit that
      // matters is the process file table.
      expect(closed.length).toBe(2)
      expect((idle as any).open.size).toBe(0)
    } finally {
      await idle.shutdown()
    }
  })

  it('never closes a container a request is holding', async () => {
    const held = { requestId: 'r1' }
    const bounded = new SqliteProvider({ directory: dir, maxOpenContainers: 1, containerIdleMs: 0 })
    try {
      await bounded.forLocator('held.db', 'h', held)
      await bounded.forLocator('other.db', 'o')
      // Exceeding a bound costs a descriptor; closing a file under a running query costs the
      // request, and on this engine it costs it loudly.
      expect([...(bounded as any).open.keys()].some((k: string) => k.endsWith('held.db'))).toBe(true)
      await bounded.releaseRequestScope(held as never)
    } finally {
      await bounded.shutdown()
    }
  })

  it('applies the pragmas that make a file survive a crash', async () => {
    const acme: any = await provider.forLocator('acme.db', 'a')
    expect((await acme.execute(sql`pragma journal_mode`))[0].journal_mode).toBe('wal')
    expect((await acme.execute(sql`pragma foreign_keys`))[0].foreign_keys).toBe(1)
  })

  it('keeps the registry on the control handle only', async () => {
    const control: any = await provider.control()
    const tenant: any = await provider.forLocator('acme.db', 'a')
    expect(control.registry).toBeDefined()
    expect(tenant.registry).toBeUndefined()
  })
})
