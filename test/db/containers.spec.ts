/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-7.1: one database per tenant, without running out of connections.
//
// The measured constraint of appendix A.3 is the connection and not the ORM: at
// `max_connections = 100`, a hundred and fifty containers each holding one fail with "sorry,
// too many clients already". So what is asserted here is the arithmetic and the LRU, because
// a design that keeps one pool per tenant works in every test and stops working on the day
// the sales team succeeds.
//
import { expect } from 'expect'
import { PostgresProvider, databaseUrl } from '../../lib/database/adapters/postgres/index.js'

;(global as any).log = {}

// Not named `URL`: that shadows the global constructor this file also uses.
const DB_URL = process.env.DATABASE_URL
const suite = DB_URL ? describe : describe.skip

describe('containers · addressing another database (T-7.1)', () => {
  it('swaps the database and keeps everything else', () => {
    expect(databaseUrl('postgres://u:p@host:5432/control', 'tenant_acme')).toBe('postgres://u:p@host:5432/tenant_acme')
  })

  it('is built with the URL parser, not with string surgery', () => {
    // A password with an encoded slash in it is not a reason to connect somewhere else.
    const url = databaseUrl('postgres://u:p%2Fw@host:5432/control', 'tenant_acme')
    expect(new URL(url).pathname).toBe('/tenant_acme')
    expect(new URL(url).hostname).toBe('host')
  })
})

suite('containers · the connection budget (T-7.1)', function () {
  this.timeout(30000)

  const providers: PostgresProvider[] = []
  const track = (p: PostgresProvider) => {
    providers.push(p)
    return p
  }

  after(async () => {
    for (const p of providers) await p.shutdown()
  })

  it('says nothing under the schema strategy, where a container is not a pool', async () => {
    const provider = track(new PostgresProvider({ url: DB_URL, schema: 'public', strategy: 'schema', maxOpenContainers: 5000 }))
    let fatal: string | null = null
    await provider.assertConnectionBudget((m) => (fatal = m))
    // Under `schema` an open container is a set of table objects. There is nothing to budget.
    expect(fatal).toBe(null)
  })

  it('accepts a sizing that fits', async () => {
    const provider = track(
      new PostgresProvider({ url: DB_URL, schema: 'public', strategy: 'container', maxOpenContainers: 20, containerPoolMax: 2 })
    )
    let fatal: string | null = null
    await provider.assertConnectionBudget((m) => (fatal = m))
    expect(fatal).toBe(null)
  })

  it('refuses to start when the pools do not fit, and does the arithmetic out loud', async () => {
    const provider = track(
      new PostgresProvider({ url: DB_URL, schema: 'public', strategy: 'container', maxOpenContainers: 300, containerPoolMax: 4 })
    )
    let fatal: string | null = null
    await provider.assertConnectionBudget((m) => (fatal = m))

    // Discovering this at the two-hundredth tenant means discovering it in production.
    expect(fatal).toMatch(/do not fit/)
    expect(fatal).toMatch(/300 live containers x 4/)
    expect(fatal).toMatch(/maxOpen/)
  })

  it('leaves room for everything else that talks to the server', async () => {
    // `max_connections` includes superuser slots, replication and the operator's own psql. A
    // framework that plans to use all of it plans to be the reason nobody can log in to fix it.
    const provider = track(
      new PostgresProvider({ url: DB_URL, schema: 'public', strategy: 'container', maxOpenContainers: 40, containerPoolMax: 2 })
    )
    let fatal: string | null = null
    await provider.assertConnectionBudget((m) => (fatal = m))
    // 40 x 2 + 10 = 90 against the default 100: it does not fit once the reserve is counted.
    expect(fatal).toMatch(/do not fit/)
  })
})

suite('containers · one database per tenant (T-7.1)', function () {
  this.timeout(60000)

  let control: PostgresProvider
  let provider: PostgresProvider
  const NAMES = ['test_ctr_a', 'test_ctr_b', 'test_ctr_c']

  before(async () => {
    control = new PostgresProvider({ url: DB_URL, schema: 'public' })
    // `CREATE DATABASE` cannot run inside a transaction, so it goes through a plain client.
    const client: any = await (control as any).pool.connect()
    for (const name of NAMES) {
      await client.query(`drop database if exists "${name}"`)
      await client.query(`create database "${name}"`)
    }
    client.release()

    provider = new PostgresProvider({
      url: DB_URL,
      schema: 'public',
      strategy: 'container',
      maxOpenContainers: 2,
      containerPoolMax: 1,
      containerIdleMs: 0
    })
  })

  after(async () => {
    await provider.shutdown()
    const client: any = await (control as any).pool.connect()
    for (const name of NAMES) await client.query(`drop database if exists "${name}"`)
    client.release()
    await control.shutdown()
  })

  it('gives each tenant its own database, with unqualified tables', async () => {
    const a: any = await provider.forLocator('test_ctr_a', 'id-a')
    await a.execute('create table widget (tag text)')
    await a.execute("insert into widget (tag) values ('A')")

    const b: any = await provider.forLocator('test_ctr_b', 'id-b')
    await b.execute('create table widget (tag text)')
    await b.execute("insert into widget (tag) values ('B')")

    // The container is the database the connection is attached to, so the SQL names no
    // schema: qualifying would name one that does not exist there.
    expect((await a.execute('select tag from widget')).rows[0].tag).toBe('A')
    expect((await b.execute('select tag from widget')).rows[0].tag).toBe('B')
    expect(a.db).not.toBe(b.db)
  })

  it('closes the least recently used container when the bound is reached', async () => {
    const live = () => (provider as any).openContainers.size

    await provider.forLocator('test_ctr_a', 'id-a')
    await provider.forLocator('test_ctr_b', 'id-b')
    expect(live()).toBe(2)

    await provider.forLocator('test_ctr_c', 'id-c')
    // Twenty live containers serving three hundred tenants is the shape. One pool per tenant
    // is the shape that stops working when there are enough tenants to matter.
    expect(live()).toBe(2)
    expect([...(provider as any).openContainers.keys()]).not.toContain('test_ctr_a')
  })

  it('closes a container nobody has touched, without waiting for a new one', async () => {
    const idle = new PostgresProvider({
      url: DB_URL,
      schema: 'public',
      strategy: 'container',
      maxOpenContainers: 10,
      containerPoolMax: 1,
      containerIdleMs: 60_000
    })
    try {
      await idle.forLocator('test_ctr_a', 'id-a')
      await idle.forLocator('test_ctr_b', 'id-b')
      expect((idle as any).openContainers.size).toBe(2)

      // An idle pool is connections held for nothing, and connections are the resource the
      // whole bound exists to protect.
      const closed = await idle.closeIdleContainers(Date.now() + 120_000)
      expect(closed.sort()).toEqual(['test_ctr_a', 'test_ctr_b'])
      expect((idle as any).openContainers.size).toBe(0)
    } finally {
      await idle.shutdown()
    }
  })

  it('never closes a container a request is holding', async () => {
    const held = { requestId: 'r1' }
    await provider.forLocator('test_ctr_a', 'id-a', held)
    await provider.forLocator('test_ctr_b', 'id-b')
    await provider.forLocator('test_ctr_c', 'id-c')

    // Exceeding a cache bound costs memory; closing a pool under a running query costs the
    // request.
    expect([...(provider as any).openContainers.keys()]).toContain('test_ctr_a')
    await provider.releaseRequestScope(held as never)
  })
})
