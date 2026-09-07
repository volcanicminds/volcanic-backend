/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-3.1: the tenant context leaves nothing on the connection.
//
// The verification the plan asks for, in the form it asks for it: a POOL DOUBLE that
// records every statement the data layer emits, so the claim under test is not "the code
// looks right" but "these are the statements, and none of them writes session state".
// No database is involved, which is why this suite runs everywhere. The real-Postgres
// half of the proof lives in postgres.spec.ts and in the bench of T-0.2.
//
// What made D-01 possible was not a missing reset: it was that a reset was needed at all.
// These tests state the property that removes the need.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { PostgresProvider } from '../../lib/database/adapters/postgres/index.js'
import { assertNoSessionState, guardPool, queryTextOf, SessionStateError } from '../../lib/database/adapters/postgres/guard.js'
import { RequestLeases } from '../../lib/database/leases.js'

const EMPTY = { rows: [], rowCount: 0, command: 'SELECT', fields: [], oid: 0 }

/** Named `...Pool` on purpose: drizzle decides to open a real transaction by that name. */
class RecordingPool {
  readonly statements: string[] = []
  readonly released: boolean[] = []

  async query(config: any, _values?: any) {
    this.statements.push(queryTextOf(config))
    return EMPTY
  }

  /** One client object, handed out again on every checkout: that is what a pool does. */
  private readonly client = {
    query: async (config: any, _values?: any) => {
      this.statements.push(queryTextOf(config))
      return EMPTY
    },
    release: () => {
      this.released.push(true)
    }
  }

  async connect() {
    return this.client
  }

  async end() {}
}

const providerOn = (pool: RecordingPool) => new PostgresProvider({ pool: pool as any, schema: 'public' })
const scopeOf = (id: string) => ({ requestId: id })

/**
 * The guard throws at the driver, and drizzle wraps whatever the driver throws. Walking the
 * cause chain is the difference between "the query failed" and "the framework refused it",
 * which is the only one of the two worth asserting.
 */
async function refused(run: () => Promise<unknown>): Promise<SessionStateError> {
  try {
    await run()
  } catch (e: any) {
    for (let err = e; err; err = err.cause) if (err instanceof SessionStateError) return err
    throw new Error(`expected the statement to be refused by the guard, got: ${e?.message}`)
  }
  throw new Error('expected the statement to be refused, it went through')
}

describe('database · session state (T-3.1)', () => {
  describe('the rule', () => {
    it('refuses a session search_path, in every spelling', () => {
      expect(() => assertNoSessionState('set search_path to tenant_acme', false)).toThrow(SessionStateError)
      expect(() => assertNoSessionState('SET SESSION search_path TO tenant_acme', false)).toThrow(SessionStateError)
      expect(() => assertNoSessionState('select 1; set search_path to public', false)).toThrow(SessionStateError)
      // Outside a transaction Postgres discards SET LOCAL: a statement that does nothing
      // is a belief about the code that is wrong, so it is refused rather than tolerated.
      expect(() => assertNoSessionState('set local search_path to tenant_acme', false)).toThrow(SessionStateError)
    })

    it('allows SET LOCAL inside a transaction, and only that', () => {
      expect(() => assertNoSessionState('set local search_path to tenant_acme', true)).not.toThrow()
      expect(() => assertNoSessionState('set search_path to tenant_acme', true)).toThrow(SessionStateError)
    })

    it('does not fire on a name that merely contains the words', () => {
      expect(() => assertNoSessionState('select * from settings where key = $1', false)).not.toThrow()
      expect(() => assertNoSessionState('insert into search_path_audit (v) values ($1)', false)).not.toThrow()
    })
  })

  describe('what the data layer actually emits', () => {
    it('reads a container without writing anything to the connection', async () => {
      const pool = new RecordingPool()
      const provider = providerOn(pool)
      const acme: any = provider.forLocator('tenant_acme', 'acme-id', scopeOf('r1'))
      const globex: any = provider.forLocator('tenant_globex', 'globex-id', scopeOf('r2'))

      await acme.db.select().from(acme.tables.user)
      await globex.db.select().from(globex.tables.user)
      await (provider.control() as any).db.select().from((provider.control() as any).registry.tenant)

      expect(pool.statements.length).toBe(3)
      // The container is in the SQL, not in the session: this is the whole of T-3.1.
      expect(pool.statements[0]).toContain('"tenant_acme"."user"')
      expect(pool.statements[1]).toContain('"tenant_globex"."user"')
      for (const statement of pool.statements) {
        expect(statement.toLowerCase()).not.toContain('search_path')
      }
    })

    it('refuses raw SQL that would poison the pooled connection', async () => {
      const pool = new RecordingPool()
      const provider = providerOn(pool)
      const acme: any = provider.forLocator('tenant_acme', 'acme-id', scopeOf('r1'))

      const err = await refused(() => acme.execute(sql.raw('set search_path to tenant_globex')))
      expect(err.code).toBe('DB_SESSION_STATE_FORBIDDEN')
      // Refused BEFORE the wire: the pool never saw it.
      expect(pool.statements.length).toBe(0)
    })

    it('lets a transaction use SET LOCAL, and still refuses the session form there', async () => {
      const pool = new RecordingPool()
      const provider = providerOn(pool)
      const control: any = provider.control()

      await control.transaction(async (tx: any) => {
        await tx.execute(sql.raw('set local search_path to tenant_acme'))
      })

      expect(pool.statements[0].toLowerCase()).toContain('begin')
      expect(pool.statements[1].toLowerCase()).toContain('set local search_path')
      expect(pool.statements[2].toLowerCase()).toContain('commit')
      expect(pool.released.length).toBe(1)

      await refused(() =>
        control.transaction(async (tx: any) => {
          await tx.execute(sql.raw('set search_path to tenant_acme'))
        })
      )
    })

    it('does not carry a transaction flag over to the next checkout', async () => {
      const pool = new RecordingPool()
      const guarded: any = guardPool(pool as any)

      const first = await guarded.connect()
      await first.query('begin')
      expect(() => first.query('set local search_path to tenant_acme')).not.toThrow()
      first.release()

      // The same object comes back out: if the depth had survived the checkout, the
      // statement below would be allowed and the next request would inherit a container.
      const second = await guarded.connect()
      expect(second).toBe(first)
      expect(() => second.query('set local search_path to tenant_acme')).toThrow(SessionStateError)
    })
  })

  describe('the single release point', () => {
    it('never evicts a container a live request is holding', async () => {
      const pool = new RecordingPool()
      const provider = new PostgresProvider({ pool: pool as any, schema: 'public', maxOpenContainers: 1 })
      const held = scopeOf('r1')
      const passing: any = scopeOf('r2')

      const acme: any = provider.forLocator('tenant_acme', 'acme-id', held)
      const globex: any = provider.forLocator('tenant_globex', 'globex-id', passing)
      // Over the bound with both in use: nothing is dropped. Staying over a cache bound is
      // the cheap failure; closing a container under a running request is not.
      expect(provider.forLocator('tenant_globex', 'globex-id', passing).tables.user).toBe(globex.tables.user)

      // r2 ends. Now the bound can be honoured, and it is honoured on the free one.
      await provider.releaseRequestScope(passing)
      expect(provider.forLocator('tenant_acme', 'acme-id', held).tables.user).toBe(acme.tables.user)
      expect(provider.forLocator('tenant_globex', 'globex-id', scopeOf('r3')).tables.user).not.toBe(globex.tables.user)
    })

    it('gives a scope back once, whatever calls it', async () => {
      const pool = new RecordingPool()
      const provider = providerOn(pool)
      const scope: any = scopeOf('r1')

      provider.forLocator('tenant_acme', 'acme-id', scope)
      await provider.releaseRequestScope(scope)
      expect(scope.released).toBe(true)
      // The abort listener and the response hook both call it: the second is a no-op.
      await provider.releaseRequestScope(scope, new Error('client aborted'))
      expect(scope.released).toBe(true)
    })

    it('refuses a container name it has not validated, before it becomes a cache key', () => {
      const pool = new RecordingPool()
      const provider = providerOn(pool)
      expect(() => provider.forLocator('public"; drop schema public cascade --', 'x')).toThrow()
      expect(() => provider.forLocator('tenant-acme', 'x')).toThrow()
      expect(() => provider.forLocator('tenant_acme', 'x')).not.toThrow()
    })
  })

  describe('leases', () => {
    it('counts holders per request, not per call', () => {
      const leases = new RequestLeases()
      leases.take({ requestId: 'r1' }, 'acme')
      leases.take({ requestId: 'r1' }, 'acme')
      leases.take({ requestId: 'r2' }, 'acme')
      expect(leases.inUse('acme')).toBe(true)

      leases.release({ requestId: 'r1' })
      expect(leases.inUse('acme')).toBe(true)
      leases.release({ requestId: 'r2' })
      expect(leases.inUse('acme')).toBe(false)
      expect(leases.size).toBe(0)
    })

    it('survives a release that never took anything', () => {
      const leases = new RequestLeases()
      expect(() => leases.release({ requestId: 'ghost' })).not.toThrow()
      expect(() => leases.release(undefined)).not.toThrow()
    })
  })
})
